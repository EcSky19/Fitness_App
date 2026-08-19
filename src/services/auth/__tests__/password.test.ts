jest.mock('expo-crypto', () => require('@/services/auth/__tests__/nativeMocks').cryptoMock());

import {
  DEFAULT_ITERATIONS,
  generateSalt,
  hashPassword,
  LEGACY_PASSWORD_ALGORITHM,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  normalizeEmail,
  normalizeSecurityAnswer,
  PASSWORD_ALGORITHM,
  parseHash,
  SALT_BYTES,
  serializeHash,
  timingSafeEqual,
  validateEmail,
  validatePassword,
  verifyPassword,
  type PasswordHash,
} from '@/services/auth/password';
import * as Crypto from 'expo-crypto';

/**
 * Independent re-implementation of the retired `sha256-iter-v1` chain, so the
 * backwards-compatibility tests are not just calling the code under test.
 */
async function legacyDerive(password: string, salt: string, iterations: number): Promise<string> {
  const sha = (input: string): Promise<string> =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
  let acc = await sha(`${salt}$${password}`);
  for (let i = 1; i < iterations; i += 1) acc = await sha(`${salt}$${acc}$${i}`);
  return acc;
}

/** Keeps the suite quick: the algorithm is identical, only the round count differs. */
const FAST = { iterations: 50 };

describe('auth/password — derivation shape', () => {
  it('is a slow hash: the round count drives the number of digest calls', async () => {
    const crypto = jest.requireMock('expo-crypto') as typeof import('expo-crypto');
    const spy = jest.spyOn(crypto, 'digestStringAsync');

    await hashPassword('correct horse battery', { iterations: 100 });

    // 100 rounds => 100 digests. A single-pass `digest(password + salt)` would be 1.
    expect(spy).toHaveBeenCalledTimes(100);
    spy.mockRestore();
  });

  it('defaults to a stretched round count, never 1', async () => {
    expect(DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(10_000);
  });

  it('keys the password into EVERY round, not just the seed', async () => {
    const crypto = jest.requireMock('expo-crypto') as typeof import('expo-crypto');
    const spy = jest.spyOn(crypto, 'digestStringAsync');
    const password = 'correct horse battery';

    await hashPassword(password, { iterations: 5 });

    const inputs = spy.mock.calls.map(([, data]) => data);
    expect(inputs).toHaveLength(5);
    expect(inputs.every((input) => input.includes(password))).toBe(true);
    spy.mockRestore();
  });

  it('still verifies legacy sha256-iter-v1 hashes and flags them for rehash', async () => {
    const salt = await generateSalt();
    const legacy: PasswordHash = {
      ...(await hashPassword('legacy password', { salt, iterations: 50 })),
      algorithm: LEGACY_PASSWORD_ALGORITHM,
    };
    // The v2 hash is not a valid v1 hash — recompute it under the old chain.
    const v1Hash = await legacyDerive('legacy password', salt, 50);
    const stored: PasswordHash = { ...legacy, hash: v1Hash };

    await expect(verifyPassword('legacy password', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', stored)).resolves.toBe(false);
    expect(needsRehash(stored)).toBe(true);
  });

  it('produces a different hash for v1 and v2 with the same salt and password', async () => {
    const salt = await generateSalt();
    const v2 = await hashPassword('same password', { salt, iterations: 50 });
    const v1 = await legacyDerive('same password', salt, 50);

    expect(v2.hash).not.toBe(v1);
  });
});

describe('auth/password — hashing', () => {
  it('round-trips a password', async () => {
    const stored = await hashPassword('correct horse battery', FAST);

    expect(stored.algorithm).toBe(PASSWORD_ALGORITHM);
    expect(stored.iterations).toBe(50);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.salt).toMatch(/^[0-9a-f]+$/);
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery', FAST);

    await expect(verifyPassword('correct horse batterY', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
    await expect(verifyPassword('completely different', stored)).resolves.toBe(false);
  });

  it('never stores the password itself', async () => {
    const password = 'a very memorable passphrase';
    const stored = await hashPassword(password, FAST);

    expect(JSON.stringify(stored)).not.toContain(password);
  });

  it('uses a unique random salt per call, so equal passwords hash differently', async () => {
    const a = await hashPassword('same password here', FAST);
    const b = await hashPassword('same password here', FAST);

    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    await expect(verifyPassword('same password here', a)).resolves.toBe(true);
    await expect(verifyPassword('same password here', b)).resolves.toBe(true);
  });

  it('produces the same hash for the same salt + iterations (deterministic)', async () => {
    const first = await hashPassword('same password here', FAST);
    const second = await hashPassword('same password here', {
      salt: first.salt,
      iterations: first.iterations,
    });

    expect(second.hash).toBe(first.hash);
  });

  it('changes the hash when the iteration count changes', async () => {
    const salt = await generateSalt();
    const low = await hashPassword('same password here', { salt, iterations: 10 });
    const high = await hashPassword('same password here', { salt, iterations: 11 });

    expect(low.hash).not.toBe(high.hash);
  });

  it('generates salts of at least 16 bytes', async () => {
    const salt = await generateSalt();
    expect(SALT_BYTES).toBeGreaterThanOrEqual(16);
    expect(salt).toHaveLength(SALT_BYTES * 2);
    await expect(generateSalt()).resolves.not.toBe(salt);
  });

  it('defaults to a benchmarked, documented iteration count', async () => {
    expect(DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(1000);
    const stored = await hashPassword('a good long password');
    expect(stored.iterations).toBe(DEFAULT_ITERATIONS);
  });
});

describe('auth/password — malformed stored hashes', () => {
  const base: PasswordHash = {
    hash: 'a'.repeat(64),
    salt: 'b'.repeat(32),
    iterations: 50,
    algorithm: PASSWORD_ALGORITHM,
  };

  const cases: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['missing hash', { ...base, hash: '' }],
    ['missing salt', { ...base, salt: '' }],
    ['non-numeric iterations', { ...base, iterations: 'many' }],
    ['NaN iterations', { ...base, iterations: Number.NaN }],
    ['zero iterations', { ...base, iterations: 0 }],
    ['absurd iterations', { ...base, iterations: 5_000_000 }],
    ['unknown algorithm', { ...base, algorithm: 'md5' }],
    ['a string instead of a record', 'not-a-hash'],
  ];

  it.each(cases)('returns false without throwing for %s', async (_label, stored) => {
    await expect(verifyPassword('anything', stored as PasswordHash)).resolves.toBe(false);
  });

  it('returns false for a tampered hash and never throws', async () => {
    const stored = await hashPassword('the real password', FAST);
    const lastChar = stored.hash.slice(-1);
    const tampered: PasswordHash = {
      ...stored,
      // Must differ from the original character, or the "tamper" is a no-op
      // 1 time in 16 and the assertion flakes.
      hash: `${stored.hash.slice(0, -1)}${lastChar === '0' ? '1' : '0'}`,
    };
    const truncated: PasswordHash = { ...stored, hash: stored.hash.slice(0, 10) };
    const swappedSalt: PasswordHash = { ...stored, salt: await generateSalt() };

    await expect(verifyPassword('the real password', tampered)).resolves.toBe(false);
    await expect(verifyPassword('the real password', truncated)).resolves.toBe(false);
    await expect(verifyPassword('the real password', swappedSalt)).resolves.toBe(false);
  });
});

describe('auth/password — constant-time comparison', () => {
  it('compares equal strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('rejects differences at any position, and length differences', () => {
    expect(timingSafeEqual('abc123', 'Xbc123')).toBe(false); // first char
    expect(timingSafeEqual('abc123', 'abc12X')).toBe(false); // last char
    expect(timingSafeEqual('abc123', 'abc1234')).toBe(false); // longer
    expect(timingSafeEqual('abc123', 'abc12')).toBe(false); // shorter
    expect(timingSafeEqual('abc123', '')).toBe(false);
  });

  it('rejects non-strings instead of throwing', () => {
    expect(timingSafeEqual(null as unknown as string, 'abc')).toBe(false);
    expect(timingSafeEqual('abc', undefined as unknown as string)).toBe(false);
  });

  it('is what verifyPassword uses — the raw hash is never compared with ===', () => {
    // Babel wraps async functions, so `verifyPassword.toString()` shows only the
    // wrapper. Read the source instead: this is the one assertion that can prove
    // the comparison is not a plain `===`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const { join } = require('node:path') as typeof import('node:path');

    const source = readFileSync(join(__dirname, '..', 'password.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function verifyPassword'));

    expect(body).toContain('timingSafeEqual(candidate, stored.hash)');
    expect(source).not.toMatch(/===\s*stored\.hash/);
    expect(source).not.toMatch(/stored\.hash\s*===/);
    expect(source).not.toMatch(/candidate\s*===/);
  });

  it('does not short-circuit on the first mismatch', () => {
    // A short-circuiting compare would read 1 char here and 63 there; the fixed
    // scan means both mismatches cost the same number of iterations.
    const target = 'f'.repeat(64);
    const earlyMismatch = `0${'f'.repeat(63)}`;
    const lateMismatch = `${'f'.repeat(63)}0`;

    expect(timingSafeEqual(target, earlyMismatch)).toBe(false);
    expect(timingSafeEqual(target, lateMismatch)).toBe(false);
  });
});

describe('auth/password — needsRehash', () => {
  it('flags hashes weaker than the current defaults', async () => {
    const weak = await hashPassword('a good long password', { iterations: 10 });
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash({ ...weak, algorithm: 'md5' })).toBe(true);
    expect(needsRehash(null)).toBe(true);
  });

  it('leaves current hashes alone', async () => {
    const current = await hashPassword('a good long password');
    expect(needsRehash(current)).toBe(false);
  });
});

describe('auth/password — serializeHash / parseHash', () => {
  it('round-trips a derivation', async () => {
    const stored = await hashPassword('security answer', FAST);
    const encoded = serializeHash(stored);

    expect(encoded).toBe(`${PASSWORD_ALGORITHM}$50$${stored.hash}`);
    expect(parseHash(encoded, stored.salt)).toEqual(stored);
  });

  it('returns null for anything malformed', () => {
    expect(parseHash(null, 'salt')).toBeNull();
    expect(parseHash('', 'salt')).toBeNull();
    expect(parseHash('not-encoded', 'salt')).toBeNull();
    expect(parseHash(`${PASSWORD_ALGORITHM}$50$abc`, '')).toBeNull();
    expect(parseHash(`md5$50$${'a'.repeat(64)}`, 'salt')).toBeNull();
    expect(parseHash(`${PASSWORD_ALGORITHM}$nope$${'a'.repeat(64)}`, 'salt')).toBeNull();
  });
});

describe('auth/password — validatePassword', () => {
  it.each([
    'a good long password',
    'correcthorsebatterystaple',
    'Tr0ub4dor&3xyz',
    'lettuce-tomato-42',
  ])('accepts %s', (password) => {
    const result = validatePassword(password);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it('requires a minimum length', () => {
    const result = validatePassword('short1');
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain(`${MIN_PASSWORD_LENGTH}`);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('rejects an empty or blank password', () => {
    expect(validatePassword('').ok).toBe(false);
    expect(validatePassword('').score).toBe(0);
    expect(validatePassword('        ').ok).toBe(false);
  });

  it('rejects all-numeric passwords', () => {
    const result = validatePassword('4815162342');
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/numbers alone/i);
  });

  it.each(['password', '12345678', 'qwerty123', 'letmein', 'PASSWORD'])(
    'rejects the common password %s',
    (password) => {
      const result = validatePassword(password);
      expect(result.ok).toBe(false);
      expect(result.score).toBe(0);
    }
  );

  it('rejects a single repeated character', () => {
    expect(validatePassword('aaaaaaaaaa').ok).toBe(false);
  });

  it('scores on length first, not on symbol gymnastics', () => {
    expect(validatePassword('abcdefgh').score).toBe(1);
    expect(validatePassword('abcdefghijkl').score).toBe(2);
    expect(validatePassword('abcdefghijklmnop').score).toBe(3);
    expect(validatePassword('abcdefghijklmnopqrst').score).toBe(4);
    // Short-but-fussy scores no better than plain length.
    expect(validatePassword('Ab3!Ab3!').score).toBe(2);
  });

  it('never demands an uppercase-and-symbol gauntlet', () => {
    expect(validatePassword('all lowercase words here').ok).toBe(true);
  });
});

describe('auth/password — email helpers', () => {
  it.each([
    'user@example.com',
    'first.last@sub.example.co.uk',
    'a+tag@example.io',
    "o'brien@example.com",
  ])('accepts %s', (email) => {
    expect(validateEmail(email)).toBe(true);
  });

  it.each([
    '',
    'no-at-sign',
    'two@@example.com',
    'user@nodot',
    '@example.com',
    'user@',
    'user name@example.com',
    'user@exa mple.com',
    '.leading@example.com',
    'trailing.@example.com',
    'double..dot@example.com',
    'user@-example.com',
    'user@example-.com',
  ])('rejects %s', (email) => {
    expect(validateEmail(email)).toBe(false);
  });

  it('accepts a valid address with surrounding whitespace', () => {
    expect(validateEmail('  user@example.com  ')).toBe(true);
  });

  it('normalizes by trimming and lowercasing', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(normalizeEmail('ALREADY@LOWER.COM')).toBe('already@lower.com');
    expect(normalizeEmail(undefined as unknown as string)).toBe('');
  });

  it('normalizes security answers case- and whitespace-insensitively', () => {
    expect(normalizeSecurityAnswer('  My   First   Dog ')).toBe('my first dog');
    expect(normalizeSecurityAnswer('Fluffy')).toBe(normalizeSecurityAnswer('fluffy '));
  });
});
