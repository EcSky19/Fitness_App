jest.mock('expo-crypto', () => require('@/services/auth/__tests__/nativeMocks').cryptoMock());

import { DatabaseSync } from 'node:sqlite';

import {
  __setDbFactory,
  closeDb,
  configureConnection,
  getDb,
  initDatabase,
  newId,
  nowISO,
  runInTransaction,
  type Database,
} from '@/db/client';
import {
  AccountEmailTakenError,
  claimLegacyData,
  countAccounts,
  createAccount,
  deleteAccount,
  getAccountByEmail,
  getAccountById,
  listAccounts,
  toPublicAccount,
  touchLastLogin,
  updateAccount,
  updateAccountPassword,
  updateAccountSecurityQuestion,
  type NewAccount,
} from '@/db/repositories/accounts';
import { MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';
import { hashPassword } from '@/services/auth/password';
import type { PasswordHashFields } from '@/types';

import { setupTestDb, teardownTestDb } from './testDb';

const FAST = { iterations: 20 };

async function pw(password: string): Promise<PasswordHashFields> {
  return hashPassword(password, FAST);
}

function account(overrides: Partial<NewAccount> & { password: PasswordHashFields }): NewAccount {
  return {
    email: 'ada@example.com',
    displayName: 'Ada',
    ...overrides,
  };
}

async function query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDb();
  return (await db.getAllAsync<T>(sql, ...(params as never[]))) ?? [];
}

async function run(sql: string, ...params: unknown[]): Promise<void> {
  const db = await getDb();
  await db.runAsync(sql, ...(params as never[]));
}

// ---------------------------------------------------------------------------

describe('accounts repository', () => {
  beforeEach(async () => {
    await setupTestDb({ withAccount: false });
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('creates an account and returns the PUBLIC shape only', async () => {
    const created = await createAccount(account({ password: await pw('a good password') }));

    expect(created.id).toHaveLength(32);
    expect(created.id).toMatch(/^[0-9a-f]{32}$/);
    expect(created.email).toBe('ada@example.com');
    expect(created.displayName).toBe('Ada');
    expect(created.securityQuestion).toBeNull();
    expect(created.hasSecurityAnswer).toBe(false);
    expect(created.lastLoginAt).toBeNull();
    expect(created.createdAt).toEqual(created.updatedAt);

    expect(Object.keys(created).sort()).toEqual([
      'createdAt',
      'displayName',
      'email',
      'hasSecurityAnswer',
      'id',
      'lastLoginAt',
      'securityQuestion',
      'updatedAt',
    ]);
    expect(JSON.stringify(created)).not.toContain('a good password');
  });

  it('mints the account id from the CSPRNG, never from Math.random', async () => {
    const crypto = jest.requireMock('expo-crypto') as typeof import('expo-crypto');
    const spy = jest.spyOn(crypto, 'getRandomBytesAsync');
    const randomSpy = jest.spyOn(Math, 'random');

    const created = await createAccount(account({ password: await pw('a good password') }));

    // `newId()` (nanoid/non-secure) is Math.random-backed; the account id must not be.
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.some(([bytes]) => bytes >= 16)).toBe(true);
    expect(randomSpy).not.toHaveBeenCalled();
    expect(created.id).toMatch(/^[0-9a-f]{32}$/);

    spy.mockRestore();
    randomSpy.mockRestore();
  });

  it('gives every account a distinct id', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const created = await createAccount(
        account({ email: `user${i}@example.com`, password: await pw('a good password') })
      );
      ids.add(created.id);
    }
    expect(ids.size).toBe(25);
  });

  it('normalizes the stored email', async () => {
    const created = await createAccount(
      account({ email: '  Ada@Example.COM ', password: await pw('a good password') })
    );

    expect(created.email).toBe('ada@example.com');
    const [row] = await query<{ email: string }>('SELECT email FROM accounts;');
    expect(row.email).toBe('ada@example.com');
  });

  it('rejects a duplicate email case-insensitively with a clean error', async () => {
    await createAccount(account({ password: await pw('a good password') }));

    await expect(
      createAccount(account({ email: 'ADA@EXAMPLE.COM', password: await pw('another password') }))
    ).rejects.toBeInstanceOf(AccountEmailTakenError);

    await expect(
      createAccount(account({ email: ' ada@example.com ', password: await pw('another password') }))
    ).rejects.toThrow(/already exists/i);

    await expect(countAccounts()).resolves.toBe(1);
  });

  it('enforces the case-insensitive unique index at the DB layer too', async () => {
    await createAccount(account({ password: await pw('a good password') }));
    const now = nowISO();

    await expect(
      run(
        `INSERT INTO accounts (id, email, display_name, password_hash, password_salt,
           password_iterations, password_algorithm, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        newId(),
        'ADA@example.com',
        'Impostor',
        'x',
        'y',
        1,
        'sha256-iter-v1',
        now,
        now
      )
    ).rejects.toThrow();
  });

  it('requires an email and a display name', async () => {
    const password = await pw('a good password');
    await expect(createAccount(account({ email: '   ', password }))).rejects.toThrow(/email/i);
    await expect(createAccount(account({ displayName: '  ', password }))).rejects.toThrow(
      /displayName/i
    );
  });

  it('reads a record back with its credential material', async () => {
    const password = await pw('a good password');
    const created = await createAccount(account({ password }));

    const byId = await getAccountById(created.id);
    const byEmail = await getAccountByEmail('  ADA@Example.com ');

    expect(byId?.password).toEqual(password);
    expect(byEmail?.id).toBe(created.id);
    expect(byEmail?.password.hash).toBe(password.hash);
    expect(toPublicAccount(byId!)).toEqual(created);
    expect(toPublicAccount(byId!)).not.toHaveProperty('password');
  });

  it('returns null for unknown ids and emails', async () => {
    await expect(getAccountById('nope')).resolves.toBeNull();
    await expect(getAccountById('')).resolves.toBeNull();
    await expect(getAccountByEmail('nobody@example.com')).resolves.toBeNull();
    await expect(getAccountByEmail('')).resolves.toBeNull();
  });

  it('stores a security question and answer without exposing the answer', async () => {
    const answer = await pw('fluffy');
    const created = await createAccount(
      account({
        password: await pw('a good password'),
        securityQuestion: 'First pet?',
        securityAnswer: answer,
      })
    );

    expect(created.securityQuestion).toBe('First pet?');
    expect(created.hasSecurityAnswer).toBe(true);

    const record = await getAccountById(created.id);
    expect(record?.securityAnswer).toEqual(answer);

    const [row] = await query<{ security_answer_hash: string }>(
      'SELECT security_answer_hash FROM accounts;'
    );
    expect(row.security_answer_hash).toBe(`${answer.algorithm}$${answer.iterations}$${answer.hash}`);
  });

  it('updates and clears the security question', async () => {
    const created = await createAccount(account({ password: await pw('a good password') }));

    await updateAccountSecurityQuestion(created.id, 'Street you grew up on?', await pw('mulberry'));
    expect((await getAccountById(created.id))?.hasSecurityAnswer).toBe(true);

    await updateAccountSecurityQuestion(created.id, null, null);
    const cleared = await getAccountById(created.id);
    expect(cleared?.hasSecurityAnswer).toBe(false);
    expect(cleared?.securityQuestion).toBeNull();
    expect(cleared?.securityAnswer).toBeNull();
  });

  it('lists accounts by last login, most recent first, with no password fields', async () => {
    const a = await createAccount(account({ email: 'a@x.com', password: await pw('password aaa') }));
    const b = await createAccount(account({ email: 'b@x.com', password: await pw('password bbb') }));
    await createAccount(account({ email: 'c@x.com', password: await pw('password ccc') }));

    await touchLastLogin(a.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await touchLastLogin(b.id);

    const listed = await listAccounts();
    expect(listed.map((x) => x.email)).toEqual(['b@x.com', 'a@x.com', 'c@x.com']);
    for (const entry of listed) {
      expect(entry).not.toHaveProperty('password');
      expect(entry).not.toHaveProperty('securityAnswer');
    }
  });

  it('counts accounts', async () => {
    await expect(countAccounts()).resolves.toBe(0);
    await createAccount(account({ password: await pw('a good password') }));
    await expect(countAccounts()).resolves.toBe(1);
  });

  it('updates the display name and email', async () => {
    const created = await createAccount(account({ password: await pw('a good password') }));

    const renamed = await updateAccount(created.id, { displayName: '  Ada Lovelace ' });
    expect(renamed.displayName).toBe('Ada Lovelace');
    expect(renamed.email).toBe('ada@example.com');

    const moved = await updateAccount(created.id, { email: '  Ada@NewDomain.IO ' });
    expect(moved.email).toBe('ada@newdomain.io');
    expect(moved.displayName).toBe('Ada Lovelace');
    expect(moved).not.toHaveProperty('password');

    await expect(getAccountByEmail('ada@newdomain.io')).resolves.not.toBeNull();
  });

  it('refuses to move an account onto a taken email', async () => {
    const a = await createAccount(account({ email: 'a@x.com', password: await pw('password aaa') }));
    await createAccount(account({ email: 'b@x.com', password: await pw('password bbb') }));

    await expect(updateAccount(a.id, { email: 'B@X.com' })).rejects.toBeInstanceOf(
      AccountEmailTakenError
    );
    // Re-saving its own email is allowed.
    await expect(updateAccount(a.id, { email: 'A@X.com' })).resolves.toMatchObject({
      email: 'a@x.com',
    });
  });

  it('throws a clear message when updating an unknown id', async () => {
    await expect(updateAccount('missing', { displayName: 'X' })).rejects.toThrow(
      /account not found \(missing\)/
    );
    await expect(updateAccountPassword('missing', await pw('a good password'))).rejects.toThrow(
      /account not found \(missing\)/
    );
    await expect(updateAccountSecurityQuestion('missing', 'q', await pw('a'))).rejects.toThrow(
      /account not found \(missing\)/
    );
  });

  it('rejects blanking the display name or email', async () => {
    const created = await createAccount(account({ password: await pw('a good password') }));
    await expect(updateAccount(created.id, { displayName: '   ' })).rejects.toThrow(/displayName/);
    await expect(updateAccount(created.id, { email: '   ' })).rejects.toThrow(/email/);
  });

  it('replaces the password derivation', async () => {
    const created = await createAccount(account({ password: await pw('a good password') }));
    const next = await pw('an even better password');

    await updateAccountPassword(created.id, next);

    expect((await getAccountById(created.id))?.password).toEqual(next);
  });

  it('stamps last login and never fails for unknown ids', async () => {
    const created = await createAccount(account({ password: await pw('a good password') }));

    await touchLastLogin(created.id);
    expect((await getAccountById(created.id))?.lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await expect(touchLastLogin('missing')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('accounts repository — deleteAccount', () => {
  beforeEach(async () => {
    await setupTestDb({ withAccount: false });
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  async function seedScopedRows(accountId: string, suffix: string): Promise<void> {
    const now = nowISO();
    await run(
      `INSERT INTO profile (id, name, sex, birth_date, height_cm, current_weight_kg,
         activity_level, weight_unit, height_unit, created_at, updated_at, account_id)
       VALUES (?, ?, 'female', '1990-01-01', 170, 65, 'moderate', 'kg', 'cm', ?, ?, ?);`,
      `profile-${suffix}`,
      `Person ${suffix}`,
      now,
      now,
      accountId
    );
    await run(
      `INSERT INTO goals (id, type, rate_kg_per_week, macro_split, target_calories,
         target_protein, target_carbs, target_fat, started_at, created_at, updated_at, account_id)
       VALUES (?, 'cut', -0.5, 'balanced', 2000, 150, 200, 60, '2026-01-01', ?, ?, ?);`,
      `goal-${suffix}`,
      now,
      now,
      accountId
    );
    await run(
      `INSERT INTO foods (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
         fat_per_100g, serving_size_g, serving_label, source, created_at, updated_at, account_id)
       VALUES (?, ?, 100, 5, 10, 2, 100, '100 g', 'custom', ?, ?, ?);`,
      `food-${suffix}`,
      `Custom ${suffix}`,
      now,
      now,
      accountId
    );
    await run(
      `INSERT INTO food_entries (id, date, meal_type, name, quantity, unit, serving_label,
         grams_total, calories, protein, carbs, fat, source, logged_at, created_at, updated_at, account_id)
       VALUES (?, '2026-02-01', 'lunch', ?, 1, 'serving', '1 serving', 100, 100, 5, 10, 2,
         'custom', ?, ?, ?, ?);`,
      `entry-${suffix}`,
      `Lunch ${suffix}`,
      now,
      now,
      now,
      accountId
    );
    await run(
      `INSERT INTO exercise_entries (id, date, name, category, duration_min, calories_burned,
         source, logged_at, created_at, updated_at, account_id)
       VALUES (?, '2026-02-01', 'Run', 'cardio', 30, 300, 'manual', ?, ?, ?, ?);`,
      `ex-${suffix}`,
      now,
      now,
      now,
      accountId
    );
    await run(
      `INSERT INTO weight_logs (id, date, weight_kg, source, created_at, updated_at, account_id)
       VALUES (?, '2026-02-01', 65, 'manual', ?, ?, ?);`,
      `wl-${suffix}`,
      now,
      now,
      accountId
    );
    await run('INSERT INTO settings (key, value, account_id) VALUES (?, ?, ?);', `theme-${suffix}`, '"dark"', accountId);
  }

  it('deletes the account and ALL of its scoped rows, leaving other accounts alone', async () => {
    const a = await createAccount(account({ email: 'a@x.com', password: await pw('password aaa') }));
    const b = await createAccount(account({ email: 'b@x.com', password: await pw('password bbb') }));
    await seedScopedRows(a.id, 'a');
    await seedScopedRows(b.id, 'b');

    // A shared seed food belonging to nobody.
    const now = nowISO();
    await run(
      `INSERT INTO foods (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
         fat_per_100g, serving_size_g, serving_label, source, created_at, updated_at, account_id)
       VALUES ('seed-1', 'Banana', 89, 1.1, 23, 0.3, 118, '1 medium', 'seed', ?, ?, NULL);`,
      now,
      now
    );

    await deleteAccount(a.id);

    for (const table of [
      'profile',
      'goals',
      'foods',
      'food_entries',
      'exercise_entries',
      'weight_logs',
      'settings',
    ]) {
      const rows = await query<{ account_id: string | null }>(
        `SELECT account_id FROM ${table} WHERE account_id = ?;`,
        a.id
      );
      expect({ table, rows: rows.length }).toEqual({ table, rows: 0 });
    }

    await expect(getAccountById(a.id)).resolves.toBeNull();
    await expect(countAccounts()).resolves.toBe(1);

    // Account B is untouched, and the shared seed food survives.
    expect(
      (await query<{ id: string }>('SELECT id FROM food_entries WHERE account_id = ?;', b.id)).length
    ).toBe(1);
    expect((await query<{ id: string }>("SELECT id FROM foods WHERE id = 'seed-1';")).length).toBe(1);
  });

  it('is a no-op for a missing or empty id', async () => {
    await createAccount(account({ password: await pw('a good password') }));
    await expect(deleteAccount('')).resolves.toBeUndefined();
    await expect(deleteAccount('missing')).resolves.toBeUndefined();
    await expect(countAccounts()).resolves.toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('accounts repository — claimLegacyData', () => {
  beforeEach(async () => {
    await setupTestDb({ withAccount: false });
    await seedLegacyDatabase();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  /** A pre-auth database: every row has account_id IS NULL. */
  async function seedLegacyDatabase(): Promise<void> {
    const now = nowISO();
    await run(
      `INSERT INTO profile (id, name, sex, birth_date, height_cm, current_weight_kg,
         activity_level, weight_unit, height_unit, created_at, updated_at)
       VALUES ('me', 'Legacy User', 'male', '1988-03-03', 180, 80, 'active', 'kg', 'cm', ?, ?);`,
      now,
      now
    );
    await run(
      `INSERT INTO goals (id, type, rate_kg_per_week, macro_split, target_calories,
         target_protein, target_carbs, target_fat, started_at, created_at, updated_at)
       VALUES ('g1', 'maintain', 0, 'balanced', 2400, 160, 250, 80, '2026-01-01', ?, ?);`,
      now,
      now
    );
    await run(
      `INSERT INTO food_entries (id, date, meal_type, name, quantity, unit, serving_label,
         grams_total, calories, protein, carbs, fat, source, logged_at, created_at, updated_at)
       VALUES ('e1', '2026-01-05', 'breakfast', 'Oats', 1, 'serving', '1 bowl', 80, 300, 10, 55, 5,
         'custom', ?, ?, ?);`,
      now,
      now,
      now
    );
    await run(
      `INSERT INTO exercise_entries (id, date, name, category, duration_min, calories_burned,
         source, logged_at, created_at, updated_at)
       VALUES ('x1', '2026-01-05', 'Walk', 'cardio', 45, 200, 'manual', ?, ?, ?);`,
      now,
      now,
      now
    );
    await run(
      `INSERT INTO weight_logs (id, date, weight_kg, source, created_at, updated_at)
       VALUES ('w1', '2026-01-05', 80, 'manual', ?, ?);`,
      now,
      now
    );
    await run("INSERT INTO settings (key, value) VALUES ('theme', '\"dark\"');");
    await run(
      `INSERT INTO foods (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
         fat_per_100g, serving_size_g, serving_label, source, created_at, updated_at)
       VALUES ('seed-banana', 'Banana', 89, 1.1, 23, 0.3, 118, '1 medium', 'seed', ?, ?);`,
      now,
      now
    );
    await run(
      `INSERT INTO foods (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
         fat_per_100g, serving_size_g, serving_label, source, created_at, updated_at)
       VALUES ('custom-chili', 'Nan chili', 150, 9, 12, 6, 250, '1 bowl', 'custom', ?, ?);`,
      now,
      now
    );
  }

  it('claims every NULL row for the account, but never a seed food', async () => {
    const first = await createAccount(account({ password: await pw('a good password') }));

    // profile + goals + food_entries + exercise_entries + weight_logs + settings + 1 custom food
    await expect(claimLegacyData(first.id)).resolves.toBe(7);

    for (const table of [
      'profile',
      'goals',
      'food_entries',
      'exercise_entries',
      'weight_logs',
      'settings',
    ]) {
      const rows = await query<{ account_id: string | null }>(`SELECT account_id FROM ${table};`);
      expect({ table, ids: rows.map((r) => r.account_id) }).toEqual({
        table,
        ids: rows.map(() => first.id),
      });
    }

    const foods = await query<{ id: string; account_id: string | null }>(
      'SELECT id, account_id FROM foods ORDER BY id;'
    );
    expect(foods).toEqual([
      { id: 'custom-chili', account_id: first.id },
      { id: 'seed-banana', account_id: null }, // shared catalogue stays shared
    ]);
  });

  it('leaves nothing for a second account to claim', async () => {
    const first = await createAccount(account({ email: 'a@x.com', password: await pw('password aaa') }));
    const second = await createAccount(
      account({ email: 'b@x.com', password: await pw('password bbb') })
    );

    await expect(claimLegacyData(first.id)).resolves.toBe(7);
    await expect(claimLegacyData(second.id)).resolves.toBe(0);

    const rows = await query<{ account_id: string }>('SELECT account_id FROM food_entries;');
    expect(rows.every((r) => r.account_id === first.id)).toBe(true);
  });

  it('never breaks the one-profile-per-account guarantee', async () => {
    const first = await createAccount(account({ password: await pw('a good password') }));
    const now = nowISO();
    await run(
      `INSERT INTO profile (id, name, sex, birth_date, height_cm, current_weight_kg,
         activity_level, weight_unit, height_unit, created_at, updated_at, account_id)
       VALUES ('owned', 'Already Mine', 'male', '1990-01-01', 175, 70, 'light', 'kg', 'cm', ?, ?, ?);`,
      now,
      now,
      first.id
    );

    await expect(claimLegacyData(first.id)).resolves.toBe(6); // profile skipped

    const profiles = await query<{ id: string; account_id: string | null }>(
      'SELECT id, account_id FROM profile ORDER BY id;'
    );
    expect(profiles).toEqual([
      { id: 'me', account_id: '' }, // still unclaimed: profile.account_id is NOT NULL in v3
      { id: 'owned', account_id: first.id },
    ]);
  });

  it('is a no-op without an account id', async () => {
    await expect(claimLegacyData('')).resolves.toBe(0);
  });

  it('adopts the legacy diary even while another transaction is open', async () => {
    const first = await createAccount(account({ password: await pw('a good password') }));
    const db = await getDb();

    // Hold a serialized transaction open so the claim is forced to overlap it.
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const blocker = runInTransaction(db, async () => {
      markEntered();
      await gate;
    });
    await entered; // the blocker's BEGIN has executed and is still open

    // A raw `withTransactionAsync` here throws "cannot start a transaction
    // within a transaction"; a serialized claim queues behind the blocker.
    const claimOutcome = claimLegacyData(first.id).then(
      (claimed) => ({ ok: true as const, claimed }),
      (error) => ({ ok: false as const, error })
    );
    // Give a queue-bypassing implementation time to reach and fail at its BEGIN.
    await new Promise((resolve) => setTimeout(resolve, 25));

    releaseGate();
    await blocker;
    const outcome = await claimOutcome;

    expect(outcome).toMatchObject({ ok: true });
    if (outcome.ok) expect(outcome.claimed).toBe(7);

    // The pre-auth diary was actually adopted rather than lost to a failed claim.
    const profile = await query<{ account_id: string }>(
      'SELECT account_id FROM profile WHERE id = ?;',
      'me'
    );
    expect(profile[0]?.account_id).toBe(first.id);
  });
});

// ---------------------------------------------------------------------------

describe('schema migration 2', () => {
  let raw: DatabaseSync | null = null;

  afterEach(async () => {
    await closeDb();
    __setDbFactory(null);
    raw = null;
  });

  /** Minimal expo-sqlite adapter (mirrors `testDb.ts`) that survives a re-open. */
  function adapterFor(database: DatabaseSync): Database {
    const bind = (params: unknown[]): unknown[] =>
      (params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params).map(
        (v) => (v === undefined ? null : v)
      );

    return {
      execAsync: async (sql: string) => {
        database.exec(sql);
      },
      runAsync: async (sql: string, ...params: unknown[]) => {
        const result = database.prepare(sql).run(...(bind(params) as never[]));
        return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
      },
      getAllAsync: async (sql: string, ...params: unknown[]) =>
        database.prepare(sql).all(...(bind(params) as never[])),
      getFirstAsync: async (sql: string, ...params: unknown[]) =>
        database.prepare(sql).get(...(bind(params) as never[])) ?? null,
      withTransactionAsync: async (task: () => Promise<unknown>) => {
        database.exec('BEGIN;');
        try {
          await task();
          database.exec('COMMIT;');
        } catch (error) {
          database.exec('ROLLBACK;');
          throw error;
        }
      },
      closeAsync: async () => {},
    } as unknown as Database;
  }

  /** Builds a database on schema v1 that already holds real user data. */
  async function openLegacyV1Database(): Promise<Database> {
    raw = new DatabaseSync(':memory:');
    const db = adapterFor(raw);
    await configureConnection(db);

    await db.execAsync(MIGRATIONS[0].sql);
    await db.runAsync(
      'INSERT INTO _migrations (version, applied_at) VALUES (?, ?);',
      1,
      '2026-01-01T00:00:00.000Z'
    );

    const now = '2026-01-02T09:00:00.000Z';
    await db.runAsync(
      `INSERT INTO profile (id, name, sex, birth_date, height_cm, current_weight_kg,
         activity_level, weight_unit, height_unit, created_at, updated_at)
       VALUES ('me', 'Existing User', 'female', '1992-07-07', 166, 61.5, 'moderate', 'lb', 'ft_in', ?, ?);`,
      now,
      now
    );
    await db.runAsync(
      `INSERT INTO food_entries (id, date, meal_type, name, quantity, unit, serving_label,
         grams_total, calories, protein, carbs, fat, source, logged_at, created_at, updated_at)
       VALUES ('e1', '2026-01-02', 'dinner', 'Curry', 1, 'serving', '1 plate', 400, 620, 32, 70, 22,
         'custom', ?, ?, ?);`,
      now,
      now,
      now
    );
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('theme', '\"light\"');");

    __setDbFactory(async () => db);
    return db;
  }

  it('is the latest migration and matches SCHEMA_VERSION', () => {
    expect(SCHEMA_VERSION).toBe(5);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it('upgrades a v1 database that already has data, without losing a row', async () => {
    const db = await openLegacyV1Database();

    await initDatabase();

    const versions = await db.getAllAsync<{ version: number }>(
      'SELECT version FROM _migrations ORDER BY version;'
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);

    // `profile` and `settings` are rebuilt by migration 3 with a NOT NULL
    // scoping column, so their unclaimed marker is '' rather than NULL.
    const profile = await db.getFirstAsync<{ name: string; account_id: string | null }>(
      'SELECT name, account_id FROM profile WHERE id = ?;',
      'me'
    );
    expect(profile).toEqual({ name: 'Existing User', account_id: '' });

    const entry = await db.getFirstAsync<{ name: string; calories: number; account_id: string | null }>(
      'SELECT name, calories, account_id FROM food_entries WHERE id = ?;',
      'e1'
    );
    expect(entry).toEqual({ name: 'Curry', calories: 620, account_id: null });

    const setting = await db.getFirstAsync<{ value: string; account_id: string | null }>(
      "SELECT value, account_id FROM settings WHERE key = 'theme';"
    );
    expect(setting).toEqual({ value: '"light"', account_id: '' });
  });

  it('adds account_id to every scoped table plus the accounts table and its indexes', async () => {
    const db = await openLegacyV1Database();
    await initDatabase();

    for (const table of [
      'profile',
      'goals',
      'foods',
      'food_entries',
      'recipes',
      'recipe_items',
      'exercise_entries',
      'weight_logs',
      'settings',
    ]) {
      const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
      expect({ table, has: columns.some((c) => c.name === 'account_id') }).toEqual({
        table,
        has: true,
      });
    }

    const accountColumns = await db.getAllAsync<{ name: string; notnull: number }>(
      'PRAGMA table_info(accounts);'
    );
    expect(accountColumns.map((c) => c.name)).toEqual([
      'id',
      'email',
      'display_name',
      'password_hash',
      'password_salt',
      'password_iterations',
      'password_algorithm',
      'security_question',
      'security_answer_hash',
      'security_answer_salt',
      'created_at',
      'updated_at',
      'last_login_at',
    ]);

    const indexes = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index';"
    );
    const names = indexes.map((i) => i.name);
    for (const index of [
      'idx_accounts_email_lower',
      'idx_food_entries_account_date',
      'idx_exercise_entries_account_date',
      'idx_weight_logs_account_date',
      'idx_goals_account',
      'idx_foods_account_name',
      // Migration 3 additions.
      'idx_weight_logs_account_date_unique',
      'idx_foods_account_barcode',
      // Migration 4 additions.
      'idx_recipes_account_name',
      'idx_recipe_items_recipe_sort',
      'idx_recipes_account_favorite',
    ]) {
      expect(names).toContain(index);
    }

    // `idx_profile_account` and `idx_settings_account_key` are gone: migration 3
    // rebuilt both tables, replacing them with a real UNIQUE constraint and a
    // composite PRIMARY KEY (see the dedicated tests below).
    expect(names).not.toContain('idx_settings_account_key');
  });

  it('does not re-run once recorded (ALTER TABLE would fail a second time)', async () => {
    await openLegacyV1Database();

    await initDatabase();
    await closeDb();
    await expect(initDatabase()).resolves.toBeUndefined();
    await closeDb();
    await expect(initDatabase()).resolves.toBeUndefined();
  });

  it('keeps at most one profile per account, unclaimed row included', async () => {
    const db = await openLegacyV1Database();
    await initDatabase();

    const now = '2026-01-03T09:00:00.000Z';
    const insertProfile = async (id: string, accountId: string): Promise<void> => {
      await db.runAsync(
        `INSERT INTO profile (id, name, sex, birth_date, height_cm, current_weight_kg,
           activity_level, weight_unit, height_unit, created_at, updated_at, account_id)
         VALUES (?, 'X', 'male', '1990-01-01', 170, 70, 'light', 'kg', 'cm', ?, ?, ?);`,
        id,
        now,
        now,
        accountId
      );
    };

    // Migration 3 makes account_id NOT NULL, so the v2 "many legacy NULLs"
    // escape hatch is closed: the unclaimed bucket is a single '' row and is
    // constrained exactly like a real account.
    await expect(insertProfile('legacy-2', '')).rejects.toThrow(/UNIQUE/i);
    await expect(
      db.runAsync(
        `INSERT INTO profile (id, name, sex, birth_date, height_cm, current_weight_kg,
           activity_level, weight_unit, height_unit, created_at, updated_at, account_id)
         VALUES ('legacy-3', 'X', 'male', '1990-01-01', 170, 70, 'light', 'kg', 'cm', ?, ?, NULL);`,
        now,
        now
      )
    ).rejects.toThrow(/NOT NULL/i);

    await db.runAsync(
      `INSERT INTO accounts (id, email, display_name, password_hash, password_salt,
         password_iterations, password_algorithm, created_at, updated_at)
       VALUES ('acc-1', 'a@x.com', 'A', 'h', 's', 10, 'sha256-iter-v1', ?, ?);`,
      now,
      now
    );
    await expect(insertProfile('p1', 'acc-1')).resolves.toBeUndefined();
    await expect(insertProfile('p2', 'acc-1')).rejects.toThrow(/UNIQUE/i);
  });

  it('lets two accounts hold the same settings key (migration 3 composite PK)', async () => {
    const db = await openLegacyV1Database();
    await initDatabase();

    const now = '2026-01-03T09:00:00.000Z';
    for (const id of ['acc-1', 'acc-2']) {
      await db.runAsync(
        `INSERT INTO accounts (id, email, display_name, password_hash, password_salt,
           password_iterations, password_algorithm, created_at, updated_at)
         VALUES (?, ?, 'A', 'h', 's', 10, 'sha256-iter-v2', ?, ?);`,
        id,
        `${id}@x.com`,
        now,
        now
      );
    }

    // The v2 schema made this impossible: `key` was globally unique.
    await db.runAsync(
      "INSERT INTO settings (account_id, key, value) VALUES ('acc-1', 'weightUnit', '\"lb\"');"
    );
    await db.runAsync(
      "INSERT INTO settings (account_id, key, value) VALUES ('acc-2', 'weightUnit', '\"kg\"');"
    );

    const rows = await db.getAllAsync<{ account_id: string; value: string }>(
      "SELECT account_id, value FROM settings WHERE key = 'weightUnit' ORDER BY account_id;"
    );
    expect(rows).toEqual([
      { account_id: 'acc-1', value: '"lb"' },
      { account_id: 'acc-2', value: '"kg"' },
    ]);

    // ...and one account still cannot hold the key twice.
    await expect(
      db.runAsync(
        "INSERT INTO settings (account_id, key, value) VALUES ('acc-1', 'weightUnit', '\"kg\"');"
      )
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('enforces one weight log per (account, date) at the DB level', async () => {
    const db = await openLegacyV1Database();
    await initDatabase();

    const now = '2026-01-03T09:00:00.000Z';
    const insertLog = async (id: string, accountId: string | null): Promise<void> => {
      await db.runAsync(
        `INSERT INTO weight_logs (id, date, weight_kg, source, created_at, updated_at, account_id)
         VALUES (?, '2026-02-02', 70, 'manual', ?, ?, ?);`,
        id,
        now,
        now,
        accountId
      );
    };

    await expect(insertLog('w1', null)).resolves.toBeUndefined();
    // NULL account_id must NOT escape the index — a plain UNIQUE(account_id, date)
    // would let this through because SQLite treats NULLs as distinct.
    await expect(insertLog('w2', null)).rejects.toThrow(/UNIQUE/i);

    await db.runAsync(
      `INSERT INTO accounts (id, email, display_name, password_hash, password_salt,
         password_iterations, password_algorithm, created_at, updated_at)
       VALUES ('acc-1', 'a@x.com', 'A', 'h', 's', 10, 'sha256-iter-v2', ?, ?);`,
      now,
      now
    );
    // A different account may log the same date.
    await expect(insertLog('w3', 'acc-1')).resolves.toBeUndefined();
    await expect(insertLog('w4', 'acc-1')).rejects.toThrow(/UNIQUE/i);
  });

  it('de-duplicates existing weight logs and foods before building the unique indexes', async () => {
    raw = new DatabaseSync(':memory:');
    const db = adapterFor(raw);
    await configureConnection(db);
    await db.execAsync(MIGRATIONS[0].sql);
    await db.runAsync(
      'INSERT INTO _migrations (version, applied_at) VALUES (?, ?);',
      1,
      '2026-01-01T00:00:00.000Z'
    );

    const now = '2026-01-02T09:00:00.000Z';
    for (const [id, kg] of [
      ['w1', 70],
      ['w2', 71],
    ] as const) {
      await db.runAsync(
        `INSERT INTO weight_logs (id, date, weight_kg, source, created_at, updated_at)
         VALUES (?, '2026-02-02', ?, 'manual', ?, ?);`,
        id,
        kg,
        now,
        now
      );
    }
    for (const id of ['f1', 'f2']) {
      await db.runAsync(
        `INSERT INTO foods (id, name, calories_per_100g, protein_per_100g, carbs_per_100g,
           fat_per_100g, serving_size_g, serving_label, barcode, source, created_at, updated_at)
         VALUES (?, 'Rice', 130, 2, 28, 0.3, 100, '100 g', '0123456789', 'custom', ?, ?);`,
        id,
        now,
        now
      );
    }

    __setDbFactory(async () => db);
    // Would throw "UNIQUE constraint failed" if the migration did not de-dupe.
    await expect(initDatabase()).resolves.toBeUndefined();

    const logs = await db.getAllAsync<{ id: string }>('SELECT id FROM weight_logs;');
    expect(logs.map((l) => l.id)).toEqual(['w2']); // newest wins

    const foods = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM foods WHERE barcode = '0123456789';"
    );
    expect(foods.map((f) => f.id)).toEqual(['f1']); // oldest wins
  });

  it('scopes external_id per account when upgrading a v1 database that already synced workouts', async () => {
    const db = await openLegacyV1Database();
    // A legacy synced workout written before accounts existed.
    await db.runAsync(
      `INSERT INTO exercise_entries (id, date, name, category, duration_min, calories_burned,
         source, external_id, logged_at, created_at, updated_at)
       VALUES ('legacy-hk', '2026-01-02', 'Run', 'cardio', 30, 300, 'healthkit', 'hk-legacy',
         '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z');`
    );

    await initDatabase();

    // The old global unique index is gone; the per-account one replaces it.
    const indexes = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index';"
    );
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_exercise_entries_account_external');
    expect(names).not.toContain('idx_exercise_entries_external_id');

    // The legacy workout survived the upgrade.
    await expect(
      db.getFirstAsync<{ id: string }>(
        "SELECT id FROM exercise_entries WHERE external_id = 'hk-legacy';"
      )
    ).resolves.toMatchObject({ id: 'legacy-hk' });

    const now = '2026-01-03T09:00:00.000Z';
    for (const id of ['acc-1', 'acc-2']) {
      await db.runAsync(
        `INSERT INTO accounts (id, email, display_name, password_hash, password_salt,
           password_iterations, password_algorithm, created_at, updated_at)
         VALUES (?, ?, 'A', 'h', 's', 10, 'sha256-iter-v5', ?, ?);`,
        id,
        `${id}@x.com`,
        now,
        now
      );
    }
    const insertWorkout = async (id: string, accountId: string): Promise<void> => {
      await db.runAsync(
        `INSERT INTO exercise_entries (id, date, name, category, duration_min, calories_burned,
           source, external_id, logged_at, created_at, updated_at, account_id)
         VALUES (?, '2026-03-01', 'Run', 'cardio', 30, 300, 'healthkit', 'hk-shared', ?, ?, ?, ?);`,
        id,
        now,
        now,
        now,
        accountId
      );
    };

    // Two accounts may each hold the same workout uuid...
    await expect(insertWorkout('x1', 'acc-1')).resolves.toBeUndefined();
    await expect(insertWorkout('x2', 'acc-2')).resolves.toBeUndefined();
    // ...but one account still cannot duplicate it.
    await expect(insertWorkout('x3', 'acc-1')).rejects.toThrow(/UNIQUE/i);
  });
});
