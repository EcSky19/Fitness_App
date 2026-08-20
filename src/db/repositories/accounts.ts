/**
 * Accounts repository — local, on-device user accounts (schema v3).
 *
 * Two shapes leave this module:
 *   - `Account`       PUBLIC. No credential material. Safe for UI and stores.
 *   - `AccountRecord` INTERNAL. Carries the password / security-answer
 *                     derivations. Only `@/services/auth` should ask for it.
 *
 * Emails are stored normalized (trimmed + lowercase) and every lookup is
 * case-insensitive, backed by `idx_accounts_email_lower` in migration 2.
 *
 * Nothing here logs a password, a hash or a salt.
 */
import { nowISO, runInTransaction } from '@/db/client';
import { LEGACY_CLAIMABLE_TABLES, UNCLAIMED_ACCOUNT_SQL } from '@/db/schema';
import type { Account, AccountRecord, ID, PasswordHashFields } from '@/types';

import { newSecureId } from '@/services/auth/ids';
import { normalizeEmail, parseHash, serializeHash } from '@/services/auth/password';
import { ensureReady, invalidateStore, textOrNull } from './mappers';

/** Raw `accounts` row exactly as SQLite hands it back. */
export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  password_algorithm: string;
  security_question: string | null;
  security_answer_hash: string | null;
  security_answer_salt: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

const ACCOUNT_COLUMNS =
  'id, email, display_name, password_hash, password_salt, password_iterations, ' +
  'password_algorithm, security_question, security_answer_hash, security_answer_salt, ' +
  'created_at, updated_at, last_login_at';

/**
 * Most-recently-used first. `last_login_at IS NULL` (never signed in) sorts
 * last so the account-picker always leads with the account in daily use.
 */
const ACCOUNT_ORDER =
  'ORDER BY (last_login_at IS NULL) ASC, last_login_at DESC, created_at DESC, display_name ASC';

/** Thrown by {@link createAccount} / {@link updateAccount} instead of a raw SQLite error. */
export class AccountEmailTakenError extends Error {
  readonly code = 'email_taken';

  constructor(email: string) {
    super(`An account already exists for ${email}.`);
    this.name = 'AccountEmailTakenError';
  }
}

export interface NewAccount {
  email: string;
  displayName: string;
  password: PasswordHashFields;
  securityQuestion?: string | null;
  securityAnswer?: PasswordHashFields | null;
}

export interface AccountPatch {
  displayName?: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    securityQuestion: textOrNull(row.security_question),
    hasSecurityAnswer: parseHash(row.security_answer_hash, row.security_answer_salt) !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: textOrNull(row.last_login_at),
  };
}

function rowToAccountRecord(row: AccountRow): AccountRecord {
  return {
    ...rowToAccount(row),
    password: {
      hash: row.password_hash,
      salt: row.password_salt,
      iterations: Number(row.password_iterations),
      algorithm: row.password_algorithm,
    },
    securityAnswer: parseHash(row.security_answer_hash, row.security_answer_salt),
  };
}

/** Strips credential material from an internal record. */
export function toPublicAccount(record: AccountRecord | Account): Account {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    securityQuestion: record.securityQuestion,
    hasSecurityAnswer: record.hasSecurityAnswer,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastLoginAt: record.lastLoginAt,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Full record (INCLUDING credential material) by id, or `null`. */
export async function getAccountById(id: ID): Promise<AccountRecord | null> {
  const db = await ensureReady();
  if (!id) return null;
  const row = await db.getFirstAsync<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ? LIMIT 1;`,
    id
  );
  return row ? rowToAccountRecord(row) : null;
}

/**
 * Full record (INCLUDING credential material) by email, or `null`.
 * The lookup is case-insensitive and tolerates un-normalized input.
 */
export async function getAccountByEmail(email: string): Promise<AccountRecord | null> {
  const db = await ensureReady();
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const row = await db.getFirstAsync<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE LOWER(email) = ? LIMIT 1;`,
    normalized
  );
  return row ? rowToAccountRecord(row) : null;
}

/** Every account in the device's picker order. Public shape — no credentials. */
export async function listAccounts(): Promise<Account[]> {
  const db = await ensureReady();
  const rows = await db.getAllAsync<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts ${ACCOUNT_ORDER};`
  );
  return (rows ?? []).map(rowToAccount);
}

/** How many accounts exist on this device. */
export async function countAccounts(): Promise<number> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM accounts;');
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Creates an account.
 *
 * Throws {@link AccountEmailTakenError} for a duplicate email (checked
 * case-insensitively before the insert AND enforced by
 * `idx_accounts_email_lower`, so a race still fails cleanly).
 */
export async function createAccount(input: NewAccount): Promise<Account> {
  const db = await ensureReady();

  const email = normalizeEmail(input.email);
  if (!email) throw new Error('createAccount: email is required');

  const displayName = (input.displayName ?? '').trim();
  if (!displayName) throw new Error('createAccount: displayName is required');

  const existing = await getAccountByEmail(email);
  if (existing) throw new AccountEmailTakenError(email);

  const now = nowISO();
  const row: AccountRow = {
    // CSPRNG, not `newId()`: the account id travels in the session descriptor,
    // so it must never come from a `Math.random()`-backed generator.
    id: await newSecureId(),
    email,
    display_name: displayName,
    password_hash: input.password.hash,
    password_salt: input.password.salt,
    password_iterations: input.password.iterations,
    password_algorithm: input.password.algorithm,
    security_question: textOrNull(input.securityQuestion),
    security_answer_hash: input.securityAnswer ? serializeHash(input.securityAnswer) : null,
    security_answer_salt: input.securityAnswer ? input.securityAnswer.salt : null,
    created_at: now,
    updated_at: now,
    last_login_at: null,
  };

  try {
    await db.runAsync(
      `INSERT INTO accounts (${ACCOUNT_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      row.id,
      row.email,
      row.display_name,
      row.password_hash,
      row.password_salt,
      row.password_iterations,
      row.password_algorithm,
      row.security_question,
      row.security_answer_hash,
      row.security_answer_salt,
      row.created_at,
      row.updated_at,
      row.last_login_at
    );
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new AccountEmailTakenError(email);
    throw error;
  }

  invalidateStore();
  return rowToAccount(row);
}

/** Renames an account and/or moves it to a new email. */
export async function updateAccount(id: ID, patch: AccountPatch): Promise<Account> {
  const db = await ensureReady();

  const current = await getAccountById(id);
  if (!current) throw new Error(`updateAccount: account not found (${id})`);

  const displayName =
    patch.displayName === undefined ? current.displayName : patch.displayName.trim();
  if (!displayName) throw new Error('updateAccount: displayName cannot be empty');

  const email = patch.email === undefined ? current.email : normalizeEmail(patch.email);
  if (!email) throw new Error('updateAccount: email cannot be empty');

  if (email !== current.email) {
    const clash = await getAccountByEmail(email);
    if (clash && clash.id !== id) throw new AccountEmailTakenError(email);
  }

  const updatedAt = nowISO();
  try {
    await db.runAsync(
      'UPDATE accounts SET display_name = ?, email = ?, updated_at = ? WHERE id = ?;',
      displayName,
      email,
      updatedAt,
      id
    );
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new AccountEmailTakenError(email);
    throw error;
  }

  invalidateStore();
  return { ...toPublicAccount(current), displayName, email, updatedAt };
}

/** Replaces the stored password derivation. */
export async function updateAccountPassword(id: ID, password: PasswordHashFields): Promise<void> {
  const db = await ensureReady();

  const result = await db.runAsync(
    `UPDATE accounts
     SET password_hash = ?, password_salt = ?, password_iterations = ?,
         password_algorithm = ?, updated_at = ?
     WHERE id = ?;`,
    password.hash,
    password.salt,
    password.iterations,
    password.algorithm,
    nowISO(),
    id
  );

  if ((result?.changes ?? 0) === 0) {
    throw new Error(`updateAccountPassword: account not found (${id})`);
  }
}

/** Replaces (or clears, with `null`) the security question and answer. */
export async function updateAccountSecurityQuestion(
  id: ID,
  question: string | null,
  answer: PasswordHashFields | null
): Promise<void> {
  const db = await ensureReady();

  const store = question && answer ? { question: question.trim(), answer } : null;
  const result = await db.runAsync(
    `UPDATE accounts
     SET security_question = ?, security_answer_hash = ?, security_answer_salt = ?, updated_at = ?
     WHERE id = ?;`,
    store ? store.question : null,
    store ? serializeHash(store.answer) : null,
    store ? store.answer.salt : null,
    nowISO(),
    id
  );

  if ((result?.changes ?? 0) === 0) {
    throw new Error(`updateAccountSecurityQuestion: account not found (${id})`);
  }
}

/** Stamps `last_login_at`. No-op for unknown ids (a sign-in must never fail here). */
export async function touchLastLogin(id: ID): Promise<void> {
  const db = await ensureReady();
  const now = nowISO();
  await db.runAsync(
    'UPDATE accounts SET last_login_at = ?, updated_at = ? WHERE id = ?;',
    now,
    now,
    id
  );
}

/**
 * Deletes an account AND every row scoped to it, in one transaction.
 *
 * Shared seed foods (`foods.account_id IS NULL`) and any remaining unclaimed
 * legacy rows are deliberately left alone — they do not belong to this account.
 */
export async function deleteAccount(id: ID): Promise<void> {
  const db = await ensureReady();
  if (!id) return;

  await runInTransaction(db, async () => {
    // Children first; `foods` before `accounts` so `food_entries.food_id` is
    // already gone and cannot trip the ON DELETE SET NULL path.
    await db.runAsync('DELETE FROM food_entries WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM recipe_items WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM recipes WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM exercise_entries WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM weight_logs WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM goals WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM foods WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM profile WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM settings WHERE account_id = ?;', id);
    await db.runAsync('DELETE FROM accounts WHERE id = ?;', id);
  });

  invalidateStore();
}

/**
 * Adopts the pre-auth data of a single-user database.
 *
 * Migrations 2 and 3 left every existing row unclaimed — `account_id IS NULL` on
 * the tables that were `ALTER`ed, `account_id = ''` on `profile` and `settings`,
 * which were rebuilt with a `NOT NULL` scoping column. `UNCLAIMED_ACCOUNT_SQL`
 * matches both. The FIRST account created on the device claims those rows so an
 * upgrading user does not open the app to an empty diary. Every later account
 * starts empty — the service layer is what enforces "first account only" (see
 * `@/services/auth`).
 *
 * Custom foods are claimed; SEED foods are NOT. `foods.account_id IS NULL` with
 * `source = 'seed'` means "shared catalogue, visible to everyone", so claiming
 * them would hide the built-in food database from every other account.
 *
 * Returns the number of rows claimed. Runs in one transaction.
 */
export async function claimLegacyData(accountId: ID): Promise<number> {
  const db = await ensureReady();
  if (!accountId) return 0;

  let claimed = 0;

  await db.withTransactionAsync(async () => {
    // At most one profile row per account (profile.account_id is UNIQUE), so
    // claim the oldest orphan and only when this account has none yet.
    const profileResult = await db.runAsync(
      `UPDATE profile SET account_id = ?
       WHERE id IN (
         SELECT id FROM profile WHERE ${UNCLAIMED_ACCOUNT_SQL} ORDER BY created_at ASC LIMIT 1
       )
         AND NOT EXISTS (SELECT 1 FROM profile WHERE account_id = ?);`,
      accountId,
      accountId
    );
    claimed += profileResult?.changes ?? 0;

    for (const table of LEGACY_CLAIMABLE_TABLES) {
      if (table === 'profile') continue;
      const result = await db.runAsync(
        `UPDATE ${table} SET account_id = ? WHERE ${UNCLAIMED_ACCOUNT_SQL};`,
        accountId
      );
      claimed += result?.changes ?? 0;
    }

    // Custom / scanned / vision foods only — `source = 'seed'` stays shared.
    const foodsResult = await db.runAsync(
      `UPDATE foods SET account_id = ? WHERE ${UNCLAIMED_ACCOUNT_SQL} AND source <> 'seed';`,
      accountId
    );
    claimed += foodsResult?.changes ?? 0;
  });

  if (claimed > 0) invalidateStore();
  return claimed;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** SQLite reports both the column UNIQUE and the LOWER(email) index this way. */
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /UNIQUE constraint failed/i.test(message) || /SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}
