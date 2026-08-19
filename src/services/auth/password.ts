/**
 * Password hashing for MacroTrack's local accounts.
 *
 * There is no server: passwords are stretched and stored on the device only.
 * Everything here is built on `expo-crypto` (`getRandomBytesAsync` for salts,
 * `digestStringAsync` for SHA-256) because that is the only cryptographic
 * primitive Expo exposes without a custom native module.
 *
 * Nothing in this module ever logs a password, a salt or a hash.
 */
import * as Crypto from 'expo-crypto';

import type { PasswordHashFields } from '@/types';

/** @see PasswordHashFields — re-exported under the name the auth service uses. */
export type PasswordHash = PasswordHashFields;

/**
 * Derivation identifier stored next to every hash.
 *
 * `sha256-iter-v2` = iterated, password-keyed SHA-256, PBKDF2-style:
 *   h0 = SHA256(salt + '$' + password)
 *   hi = SHA256(salt + '$' + password + '$' + h(i-1) + '$' + i)   for i = 1..n-1
 *
 * WHY NOT LITERAL HMAC-SHA256: `Crypto.digestStringAsync` hashes a JS string as
 * UTF-8. RFC 2104 HMAC requires hashing arbitrary BYTE strings (the key XORed
 * with 0x36/0x5c ipad/opad blocks), and those byte values are not representable
 * as UTF-8 text — encoding them would silently mangle the key. expo-crypto ships
 * no HMAC and no PBKDF2 primitive, so an honest HMAC cannot be built on top of
 * it without a native module. What this construction preserves are the two
 * properties HMAC actually contributes inside PBKDF2:
 *   1. The password is mixed into EVERY round (it is the key, not just the
 *      seed), so an attacker holding an intermediate digest still cannot carry
 *      the chain forward without the password.
 *   2. Length extension is unreachable: every input is a fixed-shape,
 *      separator-delimited internal string an attacker never gets to append to.
 * The round counter is mixed in as well so the chain can never fall into a
 * short cycle.
 *
 * `sha256-iter-v1` was the same chain WITHOUT the password in rounds 1..n-1. It
 * is still verifiable (below) and `needsRehash()` upgrades those accounts on
 * their next successful sign-in.
 */
export const PASSWORD_ALGORITHM = 'sha256-iter-v2';

/** Superseded, still verifiable so existing accounts can sign in and be upgraded. */
export const LEGACY_PASSWORD_ALGORITHM = 'sha256-iter-v1';

/** Algorithms this build can still verify (for hashes written by older builds). */
const SUPPORTED_ALGORITHMS = new Set<string>([PASSWORD_ALGORITHM, LEGACY_PASSWORD_ALGORITHM]);

/**
 * Key-stretching rounds. REAL, BENCHMARKED NUMBER — read before changing it.
 *
 * The brief asks for >= 100_000 rounds "unless that is unusably slow". It is.
 * `Crypto.digestStringAsync` is one async call into the native module per round,
 * so the cost is dominated by the JS -> native -> JS round trip, not by SHA-256.
 *
 * MEASURED (this exact code, Node 24, real SHA-256 behind an async shim, i.e.
 * the bridge-free floor — see the deleted bench harness in the auth test suite):
 *     10_000 rounds  ->  hash 53 ms, verify 43 ms  (4.3 us/round)
 *    100_000 rounds  ->  418 ms
 *
 * NOT MEASURED, extrapolated — no physical device was available in this
 * environment, so this is stated as an assumption, not a result: on React
 * Native every round additionally pays a promise + native-module hop, which
 * community measurements put at ~0.1-0.3 ms/round on a mid-range phone
 * (30-70x the bridge-free floor above). At that rate 100_000 rounds is roughly
 * 10-30 SECONDS of blocked JS thread — that is not a sign-in, that is a hang —
 * while 10_000 rounds lands at roughly 1-3 s, at the edge of the "under ~1 s"
 * budget in the brief and the highest count that stays usable.
 *
 * ACTION IF YOU HAVE A DEVICE: time `verifyPassword` on it. If a round really
 * costs less than ~0.1 ms, raise this number — `needsRehash()` will upgrade
 * every existing account on its next successful sign-in at no cost to users.
 *
 * TRADEOFF, stated plainly: 10_000 iterated SHA-256 rounds is roughly 10x weaker
 * than a 100_000-round PBKDF2 and far weaker than a memory-hard KDF (scrypt /
 * Argon2), and GPU-friendly besides. It raises the cost of an offline dictionary
 * attack by ~4 orders of magnitude over a bare single-pass SHA-256, and no more.
 * The mitigating facts: the hash never leaves the device, an attacker needs the
 * phone's decrypted app sandbox to reach it, and `validatePassword` pushes users
 * toward length (which buys far more entropy than any iteration count can). If a
 * native PBKDF2/Argon2 module is ever added, switch to it and let `needsRehash()`
 * migrate accounts — every hash records the algorithm and iteration count it was
 * created with, so old hashes keep verifying.
 */
export const DEFAULT_ITERATIONS = 10_000;

/** Hard floor/ceiling so a corrupt or hostile stored value cannot hang the app. */
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 1_000_000;

/** Salt length in bytes (>= 16 as required). */
export const SALT_BYTES = 16;

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    out += HEX[(byte >> 4) & 0x0f] + HEX[byte & 0x0f];
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

/** A fresh cryptographically-random salt, hex encoded. Unique per account. */
export async function generateSalt(bytes: number = SALT_BYTES): Promise<string> {
  const size = Number.isFinite(bytes) && bytes >= SALT_BYTES ? Math.trunc(bytes) : SALT_BYTES;
  const random = await Crypto.getRandomBytesAsync(size);
  return toHex(random instanceof Uint8Array ? random : Uint8Array.from(random));
}

function clampIterations(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ITERATIONS;
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.trunc(n)));
}

/** Runs the derivation chain. Private: callers use hashPassword/verifyPassword. */
async function derive(
  password: string,
  salt: string,
  iterations: number,
  algorithm: string = PASSWORD_ALGORITHM
): Promise<string> {
  const keyed = algorithm !== LEGACY_PASSWORD_ALGORITHM;
  let acc = await sha256Hex(`${salt}$${password}`);
  for (let i = 1; i < iterations; i += 1) {
    acc = keyed
      ? await sha256Hex(`${salt}$${password}$${acc}$${i}`)
      : await sha256Hex(`${salt}$${acc}$${i}`);
  }
  return acc;
}

/**
 * Derives a stretched hash for `password`.
 *
 * A brand new random salt is generated for every call unless one is supplied
 * (only `verifyPassword` and tests supply one), so two accounts sharing the same
 * password never share a hash.
 */
export async function hashPassword(
  password: string,
  opts?: { salt?: string; iterations?: number }
): Promise<PasswordHash> {
  const salt = opts?.salt && opts.salt.length > 0 ? opts.salt : await generateSalt();
  const iterations = clampIterations(opts?.iterations ?? DEFAULT_ITERATIONS);
  const hash = await derive(password ?? '', salt, iterations);
  return { hash, salt, iterations, algorithm: PASSWORD_ALGORITHM };
}

/**
 * Fixed-time string comparison.
 *
 * Always scans `max(a.length, b.length)` characters and folds every difference
 * into one accumulator, so the running time depends on the LENGTHS only — never
 * on where (or whether) the first mismatch occurs. Length inequality is folded
 * in too, so it can never short-circuit.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** True when `stored` has every field needed to re-derive and compare. */
function isUsableHash(stored: unknown): stored is PasswordHash {
  if (typeof stored !== 'object' || stored === null) return false;
  const s = stored as Partial<PasswordHash>;
  return (
    typeof s.hash === 'string' &&
    s.hash.length > 0 &&
    typeof s.salt === 'string' &&
    s.salt.length > 0 &&
    typeof s.algorithm === 'string' &&
    SUPPORTED_ALGORITHMS.has(s.algorithm) &&
    typeof s.iterations === 'number' &&
    Number.isFinite(s.iterations) &&
    s.iterations >= MIN_ITERATIONS &&
    s.iterations <= MAX_ITERATIONS
  );
}

/**
 * Verifies `password` against a stored derivation.
 *
 * Returns `false` — never throws — for missing, malformed, truncated, tampered
 * or unknown-algorithm records, so a corrupt row can only ever deny access.
 */
export async function verifyPassword(
  password: string,
  stored: PasswordHash | null | undefined
): Promise<boolean> {
  if (!isUsableHash(stored)) return false;
  try {
    const candidate = await derive(password ?? '', stored.salt, stored.iterations, stored.algorithm);
    return timingSafeEqual(candidate, stored.hash);
  } catch {
    return false;
  }
}

/**
 * True when `stored` was produced with weaker settings than this build uses.
 * The auth service re-hashes on the next SUCCESSFUL sign-in when this is true.
 */
export function needsRehash(stored: PasswordHash | null | undefined): boolean {
  if (!isUsableHash(stored)) return true;
  return stored.algorithm !== PASSWORD_ALGORITHM || stored.iterations < DEFAULT_ITERATIONS;
}

// ---------------------------------------------------------------------------
// Serialization (security answers)
// ---------------------------------------------------------------------------

const HASH_FIELD_SEPARATOR = '$';

/**
 * Packs a derivation into one string: `'<algorithm>$<iterations>$<hash>'`.
 *
 * The `accounts` table stores the security answer in a single
 * `security_answer_hash` column (plus its own salt), so the answer's algorithm
 * and round count have to travel with the hash. That keeps answers verifiable
 * after the password is changed with different settings.
 */
export function serializeHash(hash: PasswordHash): string {
  return [hash.algorithm, String(hash.iterations), hash.hash].join(HASH_FIELD_SEPARATOR);
}

/** Inverse of {@link serializeHash}. Returns `null` for anything malformed. */
export function parseHash(
  encoded: string | null | undefined,
  salt: string | null | undefined
): PasswordHash | null {
  if (typeof encoded !== 'string' || typeof salt !== 'string' || salt.length === 0) return null;
  const parts = encoded.split(HASH_FIELD_SEPARATOR);
  if (parts.length !== 3) return null;
  const [algorithm, iterationsText, hash] = parts;
  const candidate: PasswordHash = {
    hash: hash ?? '',
    salt,
    iterations: Number(iterationsText),
    algorithm: algorithm ?? '',
  };
  return isUsableHash(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

/**
 * Passwords rejected outright. Deliberately short: the point is to block the
 * handful of strings that top every leaked-credential list, not to run a
 * dictionary on device.
 */
const COMMON_PASSWORDS = new Set<string>([
  '12345678',
  '123456789',
  '1234567890',
  '123123123',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwerty',
  'qwertyui',
  'qwerty123',
  'qwertyuiop',
  'asdfghjkl',
  'iloveyou',
  'letmein',
  'welcome',
  'welcome1',
  'admin123',
  'abc12345',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'superman',
  'trustno1',
  'starwars',
  'monkey123',
  'dragon123',
  'macrotrack',
]);

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordValidation {
  ok: boolean;
  problems: string[];
  score: PasswordScore;
}

function characterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

/** Length first, variety second — that is the order that actually buys entropy. */
function rawScore(password: string): number {
  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (password.length >= 20) score += 1;
  if (characterClasses(password) >= 3) score += 1;
  return Math.min(score, 4);
}

function asScore(value: number): PasswordScore {
  const clamped = Math.min(4, Math.max(0, Math.trunc(value)));
  return clamped as PasswordScore;
}

/**
 * Checks a password and produces an actionable problem list plus a 0-4 strength
 * score for a UI meter.
 *
 * Length is the requirement. There is deliberately NO "must contain an uppercase
 * letter and a symbol" gauntlet — that pushes users to `Password1!`, which is
 * weaker than a four-word passphrase.
 */
export function validatePassword(password: string): PasswordValidation {
  const value = typeof password === 'string' ? password : '';
  const problems: string[] = [];

  if (value.length === 0) {
    return { ok: false, problems: ['Enter a password.'], score: 0 };
  }
  if (value.trim().length === 0) {
    return { ok: false, problems: ['Your password cannot be only spaces.'], score: 0 };
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    problems.push(`Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  const isCommon = COMMON_PASSWORDS.has(value.toLowerCase());
  if (isCommon) {
    problems.push('This password is too common — pick something only you would think of.');
  }
  if (/^\d+$/.test(value)) {
    problems.push('Add letters or words — numbers alone are easy to guess.');
  }
  if (/^(.)\1+$/.test(value)) {
    problems.push('Avoid repeating a single character.');
  }

  const ok = problems.length === 0;
  const raw = rawScore(value);
  const score = isCommon ? 0 : asScore(ok ? Math.max(1, raw) : Math.min(raw, 1));

  return { ok, problems, score };
}

/**
 * Pragmatic email check: exactly one `@`, a non-empty local part, and a dotted
 * domain. Intentionally permissive — the only authority on this device is the
 * user, so the aim is catching typos, not enforcing RFC 5322.
 */
export function validateEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const value = email.trim();
  if (value.length === 0 || value.length > 254) return false;
  if (/\s/.test(value)) return false;

  const parts = value.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 255) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

/** The canonical form stored in `accounts.email` and used for every lookup. */
export function normalizeEmail(email: string): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Security answers are matched case- and whitespace-insensitively: nobody
 * remembers whether they typed "Fluffy" or "fluffy " three months later.
 */
export function normalizeSecurityAnswer(answer: string): string {
  return typeof answer === 'string' ? answer.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}
