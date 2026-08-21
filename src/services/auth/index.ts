/**
 * MacroTrack auth service — local, on-device accounts.
 *
 * There is no server, no network call and no token. An "account" is a row in the
 * device's SQLite database; a "session" is a small descriptor kept in memory and
 * mirrored into `expo-secure-store` so the user stays signed in across launches.
 *
 * Contract notes for callers:
 *  - Every operation returns `AuthResult<T>` (`Result<T>` + a stable
 *    `AuthErrorCode`). Expected failures never throw.
 *  - `getCurrentSession()` / `getCurrentAccountId()` are SYNCHRONOUS. The
 *    repository layer calls `getCurrentAccountId()` on every query, so it must
 *    never touch the database or await anything. Repositories should import
 *    them from `@/services/auth/currentAccount` (a leaf module with no runtime
 *    imports) to avoid an import cycle through this file; screens can use
 *    either. Both return `null` when nobody is signed in.
 *  - Nothing here ever logs a password, a hash or a salt.
 */
import type {
  Account,
  AuthErrorCode,
  AuthResult,
  AuthSession,
  ID,
  PasswordHashFields,
} from '@/types';

import {
  AccountEmailTakenError,
  claimLegacyData,
  countAccounts,
  createAccount,
  deleteAccount,
  getAccountByEmail,
  getAccountById,
  listAccounts as listAccountRows,
  touchLastLogin,
  updateAccount,
  updateAccountPassword,
  updateAccountSecurityQuestion,
} from '@/db/repositories/accounts';
import {
  hashPassword,
  needsRehash,
  normalizeEmail,
  normalizeSecurityAnswer,
  validateEmail,
  validatePassword,
  verifyPassword,
  type PasswordHash,
} from './password';
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
  SESSION_STORAGE_KEY,
} from './sessionStorage';
import { getCurrentSession, setCurrentSession } from './currentAccount';

export {
  hashPassword,
  needsRehash,
  normalizeEmail,
  normalizeSecurityAnswer,
  validateEmail,
  validatePassword,
  verifyPassword,
  DEFAULT_ITERATIONS,
  MIN_PASSWORD_LENGTH,
  PASSWORD_ALGORITHM,
  timingSafeEqual,
  type PasswordHash,
  type PasswordScore,
  type PasswordValidation,
} from './password';
export { SESSION_STORAGE_KEY } from './sessionStorage';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * ONE message for "no such email" and "wrong password". Never split them: a
 * different message (or a different response time) turns the sign-in screen into
 * an account-enumeration oracle.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password.';

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_email: 'Enter a valid email address.',
  invalid_display_name: 'Enter your name.',
  weak_password: 'Choose a stronger password.',
  email_taken: 'An account already exists for that email.',
  invalid_credentials: INVALID_CREDENTIALS_MESSAGE,
  too_many_attempts: 'Too many attempts. Try again in a moment.',
  not_signed_in: 'You are not signed in.',
  account_not_found: 'That account no longer exists.',
  no_security_question: 'That account has no security question set.',
  invalid_security_answer: 'That answer is not correct.',
  storage_error: 'Something went wrong. Please try again.',
  unknown: 'Something went wrong. Please try again.',
};

function fail<T>(code: AuthErrorCode, message?: string): AuthResult<T> {
  return { ok: false, code, error: message ?? MESSAGES[code] };
}

function succeed<T>(data: T): AuthResult<T> {
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Rate limiting / lockout
//
// Failed attempts are counted per normalized email, in memory only (a process
// restart clears them). This is a usability guard against someone tapping at a
// stranger's phone, not a defence against an attacker with the sqlite file — for
// that, the only thing that matters is the key stretching in `password.ts`.
// ---------------------------------------------------------------------------

export const AUTH_LOCKOUT = {
  /** Failures allowed before the first lock. */
  maxAttempts: 5,
  /** First lock duration; doubles with each further failure. */
  baseLockMs: 30_000,
  /** Ceiling so an account can never be locked out permanently. */
  maxLockMs: 15 * 60_000,
} as const;

interface AttemptState {
  failures: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptState>();

function lockDurationMs(failures: number): number {
  const overflow = Math.max(0, failures - AUTH_LOCKOUT.maxAttempts);
  return Math.min(AUTH_LOCKOUT.maxLockMs, AUTH_LOCKOUT.baseLockMs * 2 ** overflow);
}

/** Milliseconds remaining on the lock for `email`, or 0 when it may proceed. */
export function lockRemainingMs(email: string): number {
  const state = attempts.get(normalizeEmail(email));
  if (!state) return 0;
  return Math.max(0, state.lockedUntil - Date.now());
}

function registerFailure(email: string): void {
  const key = normalizeEmail(email);
  const state = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
  state.failures += 1;
  if (state.failures >= AUTH_LOCKOUT.maxAttempts) {
    state.lockedUntil = Date.now() + lockDurationMs(state.failures);
  }
  attempts.set(key, state);
}

function clearFailures(email: string): void {
  attempts.delete(normalizeEmail(email));
}

function lockoutError<T>(remainingMs: number): AuthResult<T> {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return fail<T>(
    'too_many_attempts',
    `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
  );
}

// ---------------------------------------------------------------------------
// In-memory session
// ---------------------------------------------------------------------------

/**
 * The session itself lives in `./currentAccount`, a leaf module with no runtime
 * imports. Repositories — including `@/db/repositories/admin` — import
 * `getCurrentAccountId` from THERE, not from here, because this module pulls in
 * `@/db/repositories/accounts` and would otherwise close an import cycle.
 * Re-exported below so the auth contract stays one import for screens.
 */
export { getCurrentAccountId, getCurrentSession, setCurrentSession } from './currentAccount';

function sessionFor(account: Account, signedInAt: string): AuthSession {
  return {
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    signedInAt,
  };
}

/** Sets the session in memory and mirrors it to SecureStore. Never throws. */
async function establishSession(account: Account): Promise<AuthSession> {
  const session = sessionFor(account, new Date().toISOString());
  setCurrentSession(session);
  await saveStoredSession(session);
  return session;
}

/** Test hook: forgets the session and every recorded failed attempt. */
export function __resetAuthState(): void {
  setCurrentSession(null);
  attempts.clear();
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  securityQuestion?: string;
  securityAnswer?: string;
}

/**
 * Adopts the pre-auth diary for `accountId`, but ONLY while this is the sole
 * account on the device — see the LEGACY-CLAIM RULE on {@link signUp}.
 *
 * Re-checking "exactly one account exists" at claim time is what makes the claim
 * RECOVERABLE instead of one-shot: the first sign-up runs it, and if it fails
 * there (the account row is already committed) the very next sign-in runs it
 * again, and keeps retrying on every sign-in until the rows are adopted — for as
 * long as theirs stays the only account. The instant a second account exists the
 * guard refuses, because ownership of the orphaned rows is then ambiguous.
 *
 * Best effort by design: a failure is swallowed so it can never block sign-up or
 * sign-in, and the underlying claim is idempotent (it matches nothing once the
 * rows are adopted), so re-running it on every sign-in is safe.
 *
 * Known, accepted residual: if the first claim fails, a second account is then
 * created, and that first account is later deleted, the remaining sole account
 * adopts rows it may not have created. This is narrow (it needs all three steps)
 * and bounded — `deleteAccount` hard-deletes every child row rather than nulling
 * `account_id`, so the only `account_id IS NULL` rows on the device are the
 * pre-auth ones from migration 2. Closing it entirely would need a persisted
 * "was the first account" flag, i.e. a schema change; permanently losing the
 * upgrading user's whole diary is the worse trade.
 */
async function claimLegacyDataIfSoleAccount(accountId: ID): Promise<void> {
  try {
    if ((await countAccounts()) === 1) {
      await claimLegacyData(accountId);
    }
  } catch {
    // Swallowed on purpose: the next sign-in retries while this stays the only
    // account. A failed claim must never turn a committed account into a failed
    // sign-up/sign-in.
  }
}

/**
 * Stamps last-login without ever failing the caller. The account is already
 * committed, so a failed bookkeeping UPDATE must not strand the user on a
 * `storage_error` that a retry would report as `email_taken`.
 */
async function touchLastLoginSafely(accountId: ID): Promise<void> {
  try {
    await touchLastLogin(accountId);
  } catch {
    // Bookkeeping only — never block auth on it.
  }
}

/**
 * Creates an account and signs it in.
 *
 * LEGACY-CLAIM RULE — read before changing:
 * The pre-auth diary that migration 2 left with `account_id IS NULL` is adopted
 * only while the device has EXACTLY ONE account (see
 * {@link claimLegacyDataIfSoleAccount}). A sole account is unambiguously the
 * owner, so an upgrading single user keeps their history; the moment a SECOND
 * account exists ownership is ambiguous and the rows must NEVER be claimed by
 * anyone — silently handing one person's food diary to the next person who signs
 * up would be a privacy breach, not a convenience.
 *
 * The claim is RECOVERABLE, not one-shot. The account row is committed BEFORE the
 * claim runs, so a failed claim (or last-login stamp) still signs the user in
 * rather than returning a `storage_error` that the next attempt reports as
 * `email_taken` while the diary stays orphaned forever. Because the
 * exactly-one-account guard is re-checked on every sign-in, a claim that failed
 * here is retried on the user's next sign-in — for as long as theirs remains the
 * only account.
 */
export async function signUp(input: SignUpInput): Promise<AuthResult<AuthSession>> {
  const email = normalizeEmail(input?.email ?? '');
  if (!validateEmail(email)) return fail('invalid_email');

  const displayName = (input?.displayName ?? '').trim();
  if (!displayName) return fail('invalid_display_name');

  const passwordCheck = validatePassword(input?.password ?? '');
  if (!passwordCheck.ok) {
    return fail('weak_password', passwordCheck.problems[0] ?? MESSAGES.weak_password);
  }

  try {
    const existing = await getAccountByEmail(email);
    if (existing) return fail('email_taken');

    const password = await hashPassword(input.password);
    const security = await hashSecurityAnswer(input?.securityQuestion, input?.securityAnswer);

    const account = await createAccount({
      email,
      displayName,
      password,
      securityQuestion: security?.question ?? null,
      securityAnswer: security?.answer ?? null,
    });

    // The account row is now committed, so sign-up has succeeded. Everything
    // below is best-effort: it must sign the user in, never strand them on a
    // storage_error that a retry reports as email_taken (see LEGACY-CLAIM RULE).
    await claimLegacyDataIfSoleAccount(account.id);
    await touchLastLoginSafely(account.id);
    clearFailures(email);
    const session = await establishSession(account);
    return succeed(session);
  } catch (error: unknown) {
    if (error instanceof AccountEmailTakenError) return fail('email_taken');
    return fail('storage_error');
  }
}

/** Both parts are required; a question without an answer is not stored. */
async function hashSecurityAnswer(
  question: string | undefined,
  answer: string | undefined
): Promise<{ question: string; answer: PasswordHash } | null> {
  const trimmedQuestion = (question ?? '').trim();
  const normalizedAnswer = normalizeSecurityAnswer(answer ?? '');
  if (!trimmedQuestion || !normalizedAnswer) return null;
  return { question: trimmedQuestion, answer: await hashPassword(normalizedAnswer) };
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export interface SignInInput {
  email: string;
  password: string;
}

/**
 * A stable dummy salt used to burn the same work on an unknown email as a real
 * verification would, so response time cannot be used to enumerate accounts.
 */
const DUMMY_SALT = '00000000000000000000000000000000';

async function burnVerificationTime(password: string): Promise<void> {
  try {
    await hashPassword(password ?? '', { salt: DUMMY_SALT });
  } catch {
    // Never let the decoy affect the outcome.
  }
}

export async function signIn(input: SignInInput): Promise<AuthResult<AuthSession>> {
  const email = normalizeEmail(input?.email ?? '');
  const password = input?.password ?? '';

  const locked = lockRemainingMs(email);
  if (locked > 0) return lockoutError<AuthSession>(locked);

  try {
    const record = await getAccountByEmail(email);

    if (!record) {
      // Same work, same message as a wrong password: no enumeration oracle.
      await burnVerificationTime(password);
      registerFailure(email);
      return fail('invalid_credentials');
    }

    const valid = await verifyPassword(password, record.password);
    if (!valid) {
      registerFailure(email);
      return fail('invalid_credentials');
    }

    // Opportunistic upgrade: the plaintext is only ever available here.
    if (needsRehash(record.password)) {
      try {
        await updateAccountPassword(record.id, await hashPassword(password));
      } catch {
        // A failed upgrade must never block an otherwise valid sign-in.
      }
    }

    clearFailures(email);
    // Recover an orphaned pre-auth diary if the first sign-up's claim failed.
    // Guarded to a sole account, so it never adopts rows when ownership is
    // ambiguous (see LEGACY-CLAIM RULE on signUp).
    await claimLegacyDataIfSoleAccount(record.id);
    await touchLastLogin(record.id);
    const session = await establishSession(record);
    return succeed(session);
  } catch {
    return fail('storage_error');
  }
}

// ---------------------------------------------------------------------------
// Sign out / restore
// ---------------------------------------------------------------------------

/** Clears the in-memory session and the persisted descriptor. Never throws. */
export async function signOut(): Promise<void> {
  setCurrentSession(null);
  await clearStoredSession();
}

/**
 * Re-establishes the session persisted by a previous launch.
 *
 * The stored descriptor is only a hint: the account is re-read from SQLite, and
 * a session pointing at a deleted account is discarded. The display name and
 * email are refreshed from the row so a rename made elsewhere is picked up.
 */
export async function restoreSession(): Promise<AuthSession | null> {
  const stored = await loadStoredSession();
  if (!stored) {
    setCurrentSession(null);
    return null;
  }

  try {
    const record = await getAccountById(stored.accountId);
    if (!record) {
      setCurrentSession(null);
      await clearStoredSession();
      return null;
    }

    const session: AuthSession = {
      accountId: record.id,
      email: record.email,
      displayName: record.displayName,
      signedInAt: stored.signedInAt,
    };
    setCurrentSession(session);
    return session;
  } catch {
    // Database unavailable: trust the descriptor rather than logging the user
    // out of an app that simply failed to open its database this launch.
    setCurrentSession(stored);
    return stored;
  }
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(input: ChangePasswordInput): Promise<AuthResult<void>> {
  const session = getCurrentSession();
  if (!session) return fail('not_signed_in');

  const locked = lockRemainingMs(session.email);
  if (locked > 0) return lockoutError<void>(locked);

  const check = validatePassword(input?.newPassword ?? '');
  if (!check.ok) return fail('weak_password', check.problems[0] ?? MESSAGES.weak_password);

  try {
    const record = await getAccountById(session.accountId);
    if (!record) return fail('account_not_found');

    const valid = await verifyPassword(input?.currentPassword ?? '', record.password);
    if (!valid) {
      registerFailure(session.email);
      return fail('invalid_credentials');
    }

    await updateAccountPassword(record.id, await hashPassword(input.newPassword));
    clearFailures(session.email);
    return succeed(undefined as void);
  } catch {
    return fail('storage_error');
  }
}

export interface ResetPasswordInput {
  email: string;
  securityAnswer: string;
  newPassword: string;
}

/**
 * The only offline recovery path: answer the security question, set a new
 * password.
 *
 * An unknown email returns `invalid_security_answer` (not `account_not_found`)
 * so this cannot be used to enumerate accounts. `no_security_question` is
 * returned only for a real account that never set one, which the recovery screen
 * needs in order to explain that recovery is impossible.
 */
export async function resetPasswordWithSecurityAnswer(
  input: ResetPasswordInput
): Promise<AuthResult<void>> {
  const email = normalizeEmail(input?.email ?? '');

  const locked = lockRemainingMs(email);
  if (locked > 0) return lockoutError<void>(locked);

  const check = validatePassword(input?.newPassword ?? '');
  if (!check.ok) return fail('weak_password', check.problems[0] ?? MESSAGES.weak_password);

  try {
    const record = await getAccountByEmail(email);
    if (!record) {
      await burnVerificationTime(input?.securityAnswer ?? '');
      registerFailure(email);
      return fail('invalid_security_answer');
    }
    if (!record.securityAnswer) return fail('no_security_question');

    const valid = await verifyPassword(
      normalizeSecurityAnswer(input?.securityAnswer ?? ''),
      record.securityAnswer
    );
    if (!valid) {
      registerFailure(email);
      return fail('invalid_security_answer');
    }

    await updateAccountPassword(record.id, await hashPassword(input.newPassword));
    clearFailures(email);
    return succeed(undefined as void);
  } catch {
    return fail('storage_error');
  }
}

/** Deletes the signed-in account and everything scoped to it, then signs out. */
export async function deleteCurrentAccount(password: string): Promise<AuthResult<void>> {
  const session = getCurrentSession();
  if (!session) return fail('not_signed_in');

  const locked = lockRemainingMs(session.email);
  if (locked > 0) return lockoutError<void>(locked);

  try {
    const record = await getAccountById(session.accountId);
    if (!record) {
      await signOut();
      return fail('account_not_found');
    }

    const valid = await verifyPassword(password ?? '', record.password);
    if (!valid) {
      registerFailure(session.email);
      return fail('invalid_credentials');
    }

    await deleteAccount(record.id);
    clearFailures(session.email);
    await signOut();
    return succeed(undefined as void);
  } catch {
    return fail('storage_error');
  }
}

export interface AccountProfilePatch {
  displayName?: string;
  email?: string;
}

/** Renames the signed-in account and/or changes its email. */
export async function updateProfileAccount(
  patch: AccountProfilePatch
): Promise<AuthResult<Account>> {
  const session = getCurrentSession();
  if (!session) return fail('not_signed_in');

  if (patch?.displayName !== undefined && patch.displayName.trim().length === 0) {
    return fail('invalid_display_name');
  }
  if (patch?.email !== undefined && !validateEmail(patch.email)) {
    return fail('invalid_email');
  }

  try {
    const account = await updateAccount(session.accountId, {
      ...(patch?.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch?.email === undefined ? {} : { email: patch.email }),
    });

    const previousEmail = session.email;
    const updated: AuthSession = {
      ...session,
      email: account.email,
      displayName: account.displayName,
    };
    setCurrentSession(updated);
    await saveStoredSession(updated);
    if (previousEmail !== account.email) clearFailures(previousEmail);

    return succeed(account);
  } catch (error: unknown) {
    if (error instanceof AccountEmailTakenError) return fail('email_taken');
    return fail('storage_error');
  }
}

/** Sets or clears the security question. Pass `null` to remove recovery. */
export async function setSecurityQuestion(input: {
  question: string | null;
  answer: string | null;
}): Promise<AuthResult<void>> {
  const session = getCurrentSession();
  if (!session) return fail('not_signed_in');

  try {
    if (!input?.question || !input?.answer) {
      await updateAccountSecurityQuestion(session.accountId, null, null);
      return succeed(undefined as void);
    }

    const security = await hashSecurityAnswer(input.question, input.answer);
    if (!security) return fail('invalid_security_answer');

    await updateAccountSecurityQuestion(session.accountId, security.question, security.answer);
    return succeed(undefined as void);
  } catch {
    return fail('storage_error');
  }
}

/** Every account on the device (public shape). Powers the account picker. */
export async function listAccounts(): Promise<Account[]> {
  try {
    return await listAccountRows();
  } catch {
    return [];
  }
}

/**
 * Signs out of the current account and into `accountId`.
 *
 * The password is always required: switching without it would let anyone holding
 * an unlocked phone read every account's diary.
 */
export async function switchAccount(
  accountId: ID,
  password: string
): Promise<AuthResult<AuthSession>> {
  try {
    const record = await getAccountById(accountId);
    if (!record) return fail('account_not_found');

    const locked = lockRemainingMs(record.email);
    if (locked > 0) return lockoutError<AuthSession>(locked);

    const valid = await verifyPassword(password ?? '', record.password);
    if (!valid) {
      registerFailure(record.email);
      return fail('invalid_credentials');
    }

    clearFailures(record.email);
    await touchLastLogin(record.id);
    const session = await establishSession(record);
    return succeed(session);
  } catch {
    return fail('storage_error');
  }
}

/** Re-exported so callers can key caches off the storage slot. */
export type { AuthErrorCode, AuthResult, AuthSession, Account, PasswordHashFields };
export const AUTH_SESSION_KEY = SESSION_STORAGE_KEY;
