jest.mock('expo-crypto', () => require('@/services/auth/__tests__/nativeMocks').cryptoMock());
jest.mock('expo-secure-store', () =>
  require('@/services/auth/__tests__/nativeMocks').secureStoreMock()
);

import { getDb, nowISO } from '@/db/client';
import { setupTestDb, teardownTestDb } from '@/db/repositories/__tests__/testDb';
import { getAccountByEmail, listAccounts as listAccountRows } from '@/db/repositories/accounts';
import {
  __resetAuthState,
  AUTH_LOCKOUT,
  changePassword,
  deleteCurrentAccount,
  getCurrentAccountId,
  getCurrentSession,
  INVALID_CREDENTIALS_MESSAGE,
  listAccounts,
  resetPasswordWithSecurityAnswer,
  restoreSession,
  SESSION_STORAGE_KEY,
  setCurrentSession,
  setSecurityQuestion,
  signIn,
  signOut,
  signUp,
  switchAccount,
  updateProfileAccount,
} from '@/services/auth';
import { __resetSessionStorage } from '@/services/auth/sessionStorage';
import type { SecureStoreMock } from '@/services/auth/__tests__/nativeMocks';

const secureStore = jest.requireMock('expo-secure-store') as SecureStoreMock;

const ADA = {
  email: 'ada@example.com',
  password: 'a very good password',
  displayName: 'Ada',
};

const GRACE = {
  email: 'grace@example.com',
  password: 'another good password',
  displayName: 'Grace',
};

async function run(sql: string, ...params: unknown[]): Promise<void> {
  const db = await getDb();
  await db.runAsync(sql, ...(params as never[]));
}

async function query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDb();
  return (await db.getAllAsync<T>(sql, ...(params as never[]))) ?? [];
}

beforeEach(async () => {
  await setupTestDb();
  __resetAuthState();
  __resetSessionStorage();
  secureStore.__store.clear();
  secureStore.__fail.read = false;
  secureStore.__fail.write = false;
});

afterEach(async () => {
  await teardownTestDb();
});

// ---------------------------------------------------------------------------

describe('auth service — signUp', () => {
  it('creates an account, signs it in and persists the session', async () => {
    const result = await signUp(ADA);

    expect(result.ok).toBe(true);
    expect(result.code).toBeUndefined();
    expect(result.data?.email).toBe('ada@example.com');
    expect(result.data?.displayName).toBe('Ada');
    expect(result.data?.signedInAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(getCurrentSession()).toEqual(result.data);
    expect(getCurrentAccountId()).toBe(result.data?.accountId);

    const stored = secureStore.__store.get(SESSION_STORAGE_KEY);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored as string)).toEqual(result.data);
  });

  it('persists the descriptor only — never the password, hash or salt', async () => {
    await signUp(ADA);
    const stored = secureStore.__store.get(SESSION_STORAGE_KEY) as string;
    const record = await getAccountByEmail(ADA.email);

    expect(stored).not.toContain(ADA.password);
    expect(stored).not.toContain(record?.password.hash);
    expect(stored).not.toContain(record?.password.salt);
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual([
      'accountId',
      'displayName',
      'email',
      'signedInAt',
    ]);
  });

  it('normalizes the email and rejects duplicates case-insensitively', async () => {
    await signUp({ ...ADA, email: '  Ada@Example.COM  ' });
    expect(getCurrentSession()?.email).toBe('ada@example.com');

    const duplicate = await signUp({ ...ADA, email: 'ADA@EXAMPLE.COM', displayName: 'Impostor' });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.code).toBe('email_taken');

    await expect(listAccountRows()).resolves.toHaveLength(1);
  });

  it('rejects an invalid email', async () => {
    const result = await signUp({ ...ADA, email: 'not-an-email' });
    expect(result).toMatchObject({ ok: false, code: 'invalid_email' });
    expect(getCurrentSession()).toBeNull();
  });

  it('rejects a missing display name', async () => {
    const result = await signUp({ ...ADA, displayName: '   ' });
    expect(result).toMatchObject({ ok: false, code: 'invalid_display_name' });
  });

  it('rejects a weak password and surfaces the first actionable problem', async () => {
    const short = await signUp({ ...ADA, password: 'short' });
    expect(short).toMatchObject({ ok: false, code: 'weak_password' });
    expect(short.error).toContain('8 characters');

    const common = await signUp({ ...ADA, password: 'password' });
    expect(common).toMatchObject({ ok: false, code: 'weak_password' });
    expect(common.error).toMatch(/too common/i);
  });

  it('stores a security question when both parts are supplied', async () => {
    await signUp({ ...ADA, securityQuestion: 'First pet?', securityAnswer: '  Fluffy ' });

    const record = await getAccountByEmail(ADA.email);
    expect(record?.securityQuestion).toBe('First pet?');
    expect(record?.hasSecurityAnswer).toBe(true);
    expect(JSON.stringify(record?.securityAnswer)).not.toContain('luffy');
  });

  it('ignores a question with no answer', async () => {
    await signUp({ ...ADA, securityQuestion: 'First pet?' });
    const record = await getAccountByEmail(ADA.email);
    expect(record?.hasSecurityAnswer).toBe(false);
    expect(record?.securityQuestion).toBeNull();
  });

  it('stamps last login', async () => {
    await signUp(ADA);
    const [account] = await listAccountRows();
    expect(account.lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------

describe('auth service — legacy claim rule', () => {
  async function seedLegacyDiary(): Promise<void> {
    const now = nowISO();
    await run(
      `INSERT INTO profile (id, name, sex, birth_date, height_cm, current_weight_kg,
         activity_level, weight_unit, height_unit, created_at, updated_at)
       VALUES ('me', 'Legacy', 'female', '1991-02-02', 168, 63, 'moderate', 'kg', 'cm', ?, ?);`,
      now,
      now
    );
    await run(
      `INSERT INTO food_entries (id, date, meal_type, name, quantity, unit, serving_label,
         grams_total, calories, protein, carbs, fat, source, logged_at, created_at, updated_at)
       VALUES ('e1', '2026-01-04', 'lunch', 'Soup', 1, 'serving', '1 bowl', 300, 210, 8, 25, 7,
         'custom', ?, ?, ?);`,
      now,
      now,
      now
    );
    await run(
      `INSERT INTO foods (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
         fat_per_100g, serving_size_g, serving_label, source, created_at, updated_at)
       VALUES ('seed-1', 'Banana', 89, 1.1, 23, 0.3, 118, '1 medium', 'seed', ?, ?);`,
      now,
      now
    );
  }

  it('gives the pre-auth diary to the FIRST account only', async () => {
    await seedLegacyDiary();

    const first = await signUp(ADA);
    const firstId = first.data?.accountId;

    const claimedProfile = await query<{ account_id: string | null }>(
      'SELECT account_id FROM profile;'
    );
    const claimedEntries = await query<{ account_id: string | null }>(
      'SELECT account_id FROM food_entries;'
    );
    expect(claimedProfile).toEqual([{ account_id: firstId }]);
    expect(claimedEntries).toEqual([{ account_id: firstId }]);

    // The shared seed food is never claimed.
    expect(await query('SELECT account_id FROM foods;')).toEqual([{ account_id: null }]);

    const second = await signUp(GRACE);
    const secondId = second.data?.accountId;
    expect(secondId).not.toBe(firstId);

    expect(
      await query('SELECT id FROM food_entries WHERE account_id = ?;', secondId)
    ).toHaveLength(0);
    expect(await query('SELECT id FROM profile WHERE account_id = ?;', secondId)).toHaveLength(0);
    // First account's data is untouched.
    expect(await query('SELECT id FROM food_entries WHERE account_id = ?;', firstId)).toHaveLength(1);
  });

  it('is harmless when there is no legacy data at all', async () => {
    const result = await signUp(ADA);
    expect(result.ok).toBe(true);
    expect(await query('SELECT id FROM food_entries;')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('auth service — signIn', () => {
  it('signs in with the correct credentials, ignoring email case and whitespace', async () => {
    const created = await signUp(ADA);
    await signOut();

    const result = await signIn({ email: '  ADA@Example.com ', password: ADA.password });

    expect(result.ok).toBe(true);
    expect(result.data?.accountId).toBe(created.data?.accountId);
    expect(getCurrentAccountId()).toBe(created.data?.accountId);
  });

  it('returns the SAME generic failure for an unknown email and a wrong password', async () => {
    await signUp(ADA);
    await signOut();

    const unknownEmail = await signIn({ email: 'nobody@example.com', password: ADA.password });
    __resetAuthState();
    const wrongPassword = await signIn({ email: ADA.email, password: 'definitely wrong pw' });

    expect(unknownEmail.ok).toBe(false);
    expect(wrongPassword.ok).toBe(false);
    expect(unknownEmail.code).toBe('invalid_credentials');
    expect(wrongPassword.code).toBe(unknownEmail.code);
    expect(unknownEmail.error).toBe(wrongPassword.error);
    expect(unknownEmail.error).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(getCurrentSession()).toBeNull();
  });

  it('burns the same verification work on an unknown email (no timing oracle)', async () => {
    await signUp(ADA);
    await signOut();

    const crypto = jest.requireMock('expo-crypto') as {
      digestStringAsync: (a: string, d: string) => Promise<string>;
    };
    const spy = jest.spyOn(crypto, 'digestStringAsync');

    await signIn({ email: ADA.email, password: 'definitely wrong pw' });
    const knownEmailDigests = spy.mock.calls.length;

    __resetAuthState();
    spy.mockClear();
    await signIn({ email: 'nobody@example.com', password: 'definitely wrong pw' });
    const unknownEmailDigests = spy.mock.calls.length;

    // Guard against a vacuous 0 === 0 if the spy ever stops intercepting.
    expect(knownEmailDigests).toBeGreaterThan(0);
    expect(unknownEmailDigests).toBe(knownEmailDigests);
    spy.mockRestore();
  });

  it('updates last login and re-persists the session', async () => {
    const created = await signUp(ADA);
    await signOut();
    expect(secureStore.__store.get(SESSION_STORAGE_KEY)).toBeUndefined();

    await signIn({ email: ADA.email, password: ADA.password });

    const stored = JSON.parse(secureStore.__store.get(SESSION_STORAGE_KEY) as string) as {
      accountId: string;
    };
    expect(stored.accountId).toBe(created.data?.accountId);
    const [account] = await listAccountRows();
    expect(account.lastLoginAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('auth service — lockout', () => {
  it(`locks after ${AUTH_LOCKOUT.maxAttempts} failures and reports the wait`, async () => {
    await signUp(ADA);
    await signOut();

    for (let i = 0; i < AUTH_LOCKOUT.maxAttempts; i += 1) {
      const attempt = await signIn({ email: ADA.email, password: 'wrong password here' });
      expect(attempt.code).toBe('invalid_credentials');
    }

    const locked = await signIn({ email: ADA.email, password: ADA.password });
    expect(locked.ok).toBe(false);
    expect(locked.code).toBe('too_many_attempts');
    expect(locked.error).toMatch(/try again in \d+ seconds?/i);
    expect(getCurrentSession()).toBeNull();
  });

  it('locks per email, not globally', async () => {
    await signUp(ADA);
    await signUp(GRACE);
    await signOut();

    for (let i = 0; i < AUTH_LOCKOUT.maxAttempts; i += 1) {
      await signIn({ email: ADA.email, password: 'wrong password here' });
    }

    const other = await signIn({ email: GRACE.email, password: GRACE.password });
    expect(other.ok).toBe(true);
  });

  it('resets the counter after a successful sign-in', async () => {
    await signUp(ADA);
    await signOut();

    for (let i = 0; i < AUTH_LOCKOUT.maxAttempts - 1; i += 1) {
      await signIn({ email: ADA.email, password: 'wrong password here' });
    }
    expect((await signIn({ email: ADA.email, password: ADA.password })).ok).toBe(true);
    await signOut();

    // The counter is back to zero: four more failures still do not lock.
    for (let i = 0; i < AUTH_LOCKOUT.maxAttempts - 1; i += 1) {
      const attempt = await signIn({ email: ADA.email, password: 'wrong password here' });
      expect(attempt.code).toBe('invalid_credentials');
    }
  });

  it('clears the lock when the process state is reset', async () => {
    await signUp(ADA);
    await signOut();
    for (let i = 0; i < AUTH_LOCKOUT.maxAttempts; i += 1) {
      await signIn({ email: ADA.email, password: 'wrong password here' });
    }
    expect((await signIn({ email: ADA.email, password: ADA.password })).code).toBe(
      'too_many_attempts'
    );

    __resetAuthState();
    expect((await signIn({ email: ADA.email, password: ADA.password })).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('auth service — signOut / restoreSession', () => {
  it('runs the full sign-up -> sign-in -> sign-out -> restore cycle', async () => {
    const created = await signUp(ADA);
    expect(getCurrentAccountId()).toBe(created.data?.accountId);

    await signOut();
    expect(getCurrentSession()).toBeNull();
    expect(getCurrentAccountId()).toBeNull();
    await expect(restoreSession()).resolves.toBeNull();

    const signedIn = await signIn({ email: ADA.email, password: ADA.password });
    expect(signedIn.ok).toBe(true);

    // Simulate a fresh launch: memory is empty, SecureStore still holds the slip.
    setCurrentSession(null);
    const restored = await restoreSession();

    expect(restored?.accountId).toBe(created.data?.accountId);
    expect(restored?.email).toBe('ada@example.com');
    expect(getCurrentSession()).toEqual(restored);
  });

  it('refreshes the display name and email from the database on restore', async () => {
    await signUp(ADA);
    await updateProfileAccount({ displayName: 'Ada Lovelace', email: 'ada@newdomain.io' });

    setCurrentSession(null);
    const restored = await restoreSession();

    expect(restored?.displayName).toBe('Ada Lovelace');
    expect(restored?.email).toBe('ada@newdomain.io');
  });

  it('discards a session pointing at a deleted account', async () => {
    await signUp(ADA);
    await run('DELETE FROM accounts;');

    setCurrentSession(null);
    await expect(restoreSession()).resolves.toBeNull();
    expect(secureStore.__store.get(SESSION_STORAGE_KEY)).toBeUndefined();
  });

  it('ignores a corrupt stored descriptor', async () => {
    secureStore.__store.set(SESSION_STORAGE_KEY, '{not json');
    await expect(restoreSession()).resolves.toBeNull();

    secureStore.__store.set(SESSION_STORAGE_KEY, JSON.stringify({ nope: true }));
    await expect(restoreSession()).resolves.toBeNull();
  });

  it('falls back to memory when SecureStore is unavailable, and never throws', async () => {
    secureStore.__fail.write = true;
    secureStore.__fail.read = true;

    const created = await signUp(ADA);
    expect(created.ok).toBe(true);
    expect(secureStore.__store.size).toBe(0);

    setCurrentSession(null);
    const restored = await restoreSession();
    expect(restored?.accountId).toBe(created.data?.accountId);

    await expect(signOut()).resolves.toBeUndefined();
    expect(getCurrentSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('auth service — changePassword', () => {
  it('requires the correct current password', async () => {
    await signUp(ADA);

    const wrong = await changePassword({
      currentPassword: 'not my password',
      newPassword: 'a brand new password',
    });
    expect(wrong).toMatchObject({ ok: false, code: 'invalid_credentials' });
    expect(wrong.error).toBe(INVALID_CREDENTIALS_MESSAGE);

    // The old password still works.
    await signOut();
    expect((await signIn({ email: ADA.email, password: ADA.password })).ok).toBe(true);
  });

  it('changes the password and invalidates the old one', async () => {
    await signUp(ADA);

    const changed = await changePassword({
      currentPassword: ADA.password,
      newPassword: 'a brand new password',
    });
    expect(changed.ok).toBe(true);

    await signOut();
    expect((await signIn({ email: ADA.email, password: ADA.password })).code).toBe(
      'invalid_credentials'
    );
    __resetAuthState();
    expect((await signIn({ email: ADA.email, password: 'a brand new password' })).ok).toBe(true);
  });

  it('rejects a weak new password', async () => {
    await signUp(ADA);
    const result = await changePassword({ currentPassword: ADA.password, newPassword: '1234' });
    expect(result).toMatchObject({ ok: false, code: 'weak_password' });
  });

  it('requires a session', async () => {
    await expect(
      changePassword({ currentPassword: 'x', newPassword: 'a brand new password' })
    ).resolves.toMatchObject({ ok: false, code: 'not_signed_in' });
  });
});

// ---------------------------------------------------------------------------

describe('auth service — password recovery', () => {
  const WITH_QUESTION = {
    ...ADA,
    securityQuestion: 'First pet?',
    securityAnswer: 'Fluffy',
  };

  it('resets the password when the answer matches (case-insensitively)', async () => {
    await signUp(WITH_QUESTION);
    await signOut();

    const result = await resetPasswordWithSecurityAnswer({
      email: '  ADA@example.com ',
      securityAnswer: '  fluffy  ',
      newPassword: 'a recovered password',
    });
    expect(result.ok).toBe(true);

    expect((await signIn({ email: ADA.email, password: 'a recovered password' })).ok).toBe(true);
  });

  it('rejects a wrong answer', async () => {
    await signUp(WITH_QUESTION);
    const result = await resetPasswordWithSecurityAnswer({
      email: ADA.email,
      securityAnswer: 'Rex',
      newPassword: 'a recovered password',
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_security_answer' });
  });

  it('does not reveal whether an email exists', async () => {
    await signUp(WITH_QUESTION);
    await signOut();

    const wrongAnswer = await resetPasswordWithSecurityAnswer({
      email: ADA.email,
      securityAnswer: 'Rex',
      newPassword: 'a recovered password',
    });
    __resetAuthState();
    const unknownEmail = await resetPasswordWithSecurityAnswer({
      email: 'nobody@example.com',
      securityAnswer: 'Rex',
      newPassword: 'a recovered password',
    });

    expect(unknownEmail.code).toBe(wrongAnswer.code);
    expect(unknownEmail.error).toBe(wrongAnswer.error);
  });

  it('reports when an account has no security question', async () => {
    await signUp(ADA);
    await signOut();

    const result = await resetPasswordWithSecurityAnswer({
      email: ADA.email,
      securityAnswer: 'anything',
      newPassword: 'a recovered password',
    });
    expect(result).toMatchObject({ ok: false, code: 'no_security_question' });
  });

  it('can add or remove the question after sign-up', async () => {
    await signUp(ADA);

    expect((await setSecurityQuestion({ question: 'City of birth?', answer: 'Lyon' })).ok).toBe(true);
    expect((await getAccountByEmail(ADA.email))?.hasSecurityAnswer).toBe(true);

    expect((await setSecurityQuestion({ question: null, answer: null })).ok).toBe(true);
    expect((await getAccountByEmail(ADA.email))?.hasSecurityAnswer).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('auth service — account management', () => {
  it('lists accounts without credential material', async () => {
    await signUp(ADA);
    await signUp(GRACE);

    const accounts = await listAccounts();
    expect(accounts.map((a) => a.email).sort()).toEqual(['ada@example.com', 'grace@example.com']);
    for (const acc of accounts) {
      expect(acc).not.toHaveProperty('password');
      expect(acc).not.toHaveProperty('securityAnswer');
    }
  });

  it('renames the signed-in account and refreshes the session', async () => {
    await signUp(ADA);

    const result = await updateProfileAccount({ displayName: 'Ada L.', email: 'ada@lovelace.dev' });

    expect(result.ok).toBe(true);
    expect(result.data?.displayName).toBe('Ada L.');
    expect(getCurrentSession()?.email).toBe('ada@lovelace.dev');
    expect(getCurrentSession()?.displayName).toBe('Ada L.');

    const stored = JSON.parse(secureStore.__store.get(SESSION_STORAGE_KEY) as string) as {
      email: string;
    };
    expect(stored.email).toBe('ada@lovelace.dev');
  });

  it('refuses an email already taken by another account', async () => {
    await signUp(GRACE);
    await signUp(ADA);

    const result = await updateProfileAccount({ email: GRACE.email });
    expect(result).toMatchObject({ ok: false, code: 'email_taken' });
  });

  it('validates the patch', async () => {
    await signUp(ADA);
    await expect(updateProfileAccount({ email: 'nope' })).resolves.toMatchObject({
      code: 'invalid_email',
    });
    await expect(updateProfileAccount({ displayName: '  ' })).resolves.toMatchObject({
      code: 'invalid_display_name',
    });
  });

  it('requires a session', async () => {
    await expect(updateProfileAccount({ displayName: 'X' })).resolves.toMatchObject({
      code: 'not_signed_in',
    });
  });
});

// ---------------------------------------------------------------------------

describe('auth service — switchAccount', () => {
  it('switches to another account with its password', async () => {
    const ada = await signUp(ADA);
    const grace = await signUp(GRACE); // signUp leaves Grace signed in
    expect(getCurrentAccountId()).toBe(grace.data?.accountId);

    const result = await switchAccount(ada.data!.accountId, ADA.password);

    expect(result.ok).toBe(true);
    expect(result.data?.accountId).toBe(ada.data?.accountId);
    expect(getCurrentAccountId()).toBe(ada.data?.accountId);
    expect(JSON.parse(secureStore.__store.get(SESSION_STORAGE_KEY) as string)).toEqual(result.data);
  });

  it('refuses the wrong password and keeps the current session', async () => {
    const ada = await signUp(ADA);
    const grace = await signUp(GRACE);

    const result = await switchAccount(ada.data!.accountId, 'not adas password');

    expect(result).toMatchObject({ ok: false, code: 'invalid_credentials' });
    expect(result.error).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(getCurrentAccountId()).toBe(grace.data?.accountId);
  });

  it('reports an unknown account', async () => {
    await signUp(ADA);
    await expect(switchAccount('missing', ADA.password)).resolves.toMatchObject({
      ok: false,
      code: 'account_not_found',
    });
  });
});

// ---------------------------------------------------------------------------

describe('auth service — deleteCurrentAccount', () => {
  it('requires the password, then removes the account and signs out', async () => {
    const ada = await signUp(ADA);
    const now = nowISO();
    await run(
      `INSERT INTO weight_logs (id, date, weight_kg, source, created_at, updated_at, account_id)
       VALUES ('w1', '2026-02-02', 61, 'manual', ?, ?, ?);`,
      now,
      now,
      ada.data!.accountId
    );

    const wrong = await deleteCurrentAccount('not my password');
    expect(wrong).toMatchObject({ ok: false, code: 'invalid_credentials' });
    expect(getCurrentAccountId()).toBe(ada.data?.accountId);

    const deleted = await deleteCurrentAccount(ADA.password);
    expect(deleted.ok).toBe(true);
    expect(getCurrentSession()).toBeNull();
    expect(secureStore.__store.get(SESSION_STORAGE_KEY)).toBeUndefined();
    await expect(listAccountRows()).resolves.toHaveLength(0);
    expect(await query('SELECT id FROM weight_logs;')).toHaveLength(0);
  });

  it('requires a session', async () => {
    await expect(deleteCurrentAccount('x')).resolves.toMatchObject({
      ok: false,
      code: 'not_signed_in',
    });
  });
});

// ---------------------------------------------------------------------------

describe('auth service — synchronous accessors', () => {
  it('exposes the account id without awaiting anything', async () => {
    expect(getCurrentAccountId()).toBeNull();
    const created = await signUp(ADA);

    // Called the way repositories will call it: no await, no database access.
    const id = getCurrentAccountId();
    expect(id).toBe(created.data?.accountId);

    setCurrentSession(null);
    expect(getCurrentAccountId()).toBeNull();
    expect(getCurrentSession()).toBeNull();
  });
});
