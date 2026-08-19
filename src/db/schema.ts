/**
 * SQLite schema for MacroTrack.
 *
 * `src/db/client.ts` applies pending migrations in order inside a transaction and
 * records the applied version in `_migrations`, so every script runs exactly
 * once. Scripts still prefer idempotent DDL (`CREATE TABLE IF NOT EXISTS ...`);
 * `ALTER TABLE ADD COLUMN` (migration 2) has no such form and relies on the
 * `_migrations` ledger instead.
 *
 * IMPORTANT: `Macros` are stored as individual REAL columns (never JSON) so that
 * SQL aggregation (`SUM(calories)`, ...) works directly.
 */

export const DATABASE_NAME = 'macrotrack.db';

export const SCHEMA_VERSION = 3;

/** Canonical table names — use these instead of string literals. */
export const TABLES = {
  profile: 'profile',
  goals: 'goals',
  foods: 'foods',
  foodEntries: 'food_entries',
  exerciseEntries: 'exercise_entries',
  weightLogs: 'weight_logs',
  settings: 'settings',
  accounts: 'accounts',
  migrations: '_migrations',
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

/** All app tables in a safe drop order (children before parents). */
export const ALL_TABLES: string[] = [
  TABLES.foodEntries,
  TABLES.exerciseEntries,
  TABLES.weightLogs,
  TABLES.goals,
  TABLES.foods,
  TABLES.profile,
  TABLES.settings,
  TABLES.accounts,
  TABLES.migrations,
];

/** The per-account scoping column added by migration 2. */
export const ACCOUNT_ID_COLUMN = 'account_id';

/**
 * The "nobody owns this yet" marker.
 *
 * Two representations exist and BOTH mean unclaimed, because the two groups of
 * scoped tables were scoped in different ways:
 *   - `''`   on `profile` and `settings`, which migration 3 REBUILT so that
 *            `account_id` could be `NOT NULL` and part of a key.
 *   - `NULL` on `goals`, `food_entries`, `exercise_entries`, `weight_logs` and
 *            `foods`, where migration 2 could only `ALTER TABLE ADD COLUMN`
 *            (SQLite forbids `NOT NULL` there without a constant default).
 *
 * Always test for unclaimed with {@link UNCLAIMED_ACCOUNT_SQL}, never with
 * `IS NULL` alone.
 *
 * `foods` is the one exception to "unclaimed": there, `account_id IS NULL`
 * together with `source = 'seed'` means a SHARED built-in food that every
 * account can see and that nobody may claim.
 */
export const UNCLAIMED_ACCOUNT_ID = '';

/** SQL predicate matching unclaimed rows on any scoped table. */
export const UNCLAIMED_ACCOUNT_SQL = "(account_id IS NULL OR account_id = '')";

/**
 * Tables that received `account_id` in migration 2.
 *
 * `foods` is deliberately last: it is the only table where `account_id IS NULL`
 * means "shared seed catalogue" instead of "legacy pre-auth data".
 */
export const ACCOUNT_SCOPED_TABLES: string[] = [
  TABLES.profile,
  TABLES.goals,
  TABLES.foodEntries,
  TABLES.exerciseEntries,
  TABLES.weightLogs,
  TABLES.settings,
  TABLES.foods,
];

/**
 * Tables whose `account_id IS NULL` rows are legacy pre-auth data that the FIRST
 * account created on the device claims (see `claimLegacyData`). `foods` is NOT
 * in this list — see {@link ACCOUNT_SCOPED_TABLES}.
 */
export const LEGACY_CLAIMABLE_TABLES: string[] = [
  TABLES.profile,
  TABLES.goals,
  TABLES.foodEntries,
  TABLES.exerciseEntries,
  TABLES.weightLogs,
  TABLES.settings,
];

/**
 * Column names per table — handy for building dynamic SQL in repositories.
 *
 * ## `account_id` IS DELIBERATELY NOT IN ANY OF THESE LISTS — READ THIS FIRST
 * Repositories feed these arrays straight into `upsertSql()` / `toBindValues()`
 * to build `INSERT ... ON CONFLICT` statements. If `account_id` were listed
 * here, every existing writer would suddenly have to supply a value for it, and
 * the ones that did not would bind `NULL` (`toBindValues` maps a missing key to
 * `null`) — silently un-scoping the row on every save. Keeping it out means the
 * column list describes the DATA, and scoping is layered on top by the
 * repository that owns each table.
 *
 * WHAT A WRITER MUST DO INSTEAD: build the scoped statement explicitly, e.g.
 *
 *   const COLS = [...COLUMNS.profile, ACCOUNT_ID_COLUMN];
 *   const SQL = upsertSql('profile', COLS, 'id');
 *   await db.runAsync(SQL, ...toBindValues({ ...row, account_id: scope }, COLS));
 *
 * where `scope = getCurrentAccountId() ?? UNCLAIMED_ACCOUNT_ID` from
 * `@/services/auth/currentAccount`. Every scoped `SELECT`, `UPDATE` and `DELETE`
 * likewise needs an explicit `account_id = ?` predicate; a row id alone
 * authorises nothing, because `newId()` is `Math.random()`-backed.
 */
export const COLUMNS = {
  profile: [
    'id',
    'name',
    'sex',
    'birth_date',
    'height_cm',
    'current_weight_kg',
    'goal_weight_kg',
    'activity_level',
    'weight_unit',
    'height_unit',
    'onboarded_at',
    'created_at',
    'updated_at',
  ],
  goals: [
    'id',
    'type',
    'rate_kg_per_week',
    'macro_split',
    'target_calories',
    'target_protein',
    'target_carbs',
    'target_fat',
    'is_manual_override',
    'started_at',
    'is_active',
    'created_at',
    'updated_at',
  ],
  foods: [
    'id',
    'name',
    'brand',
    'calories_per_100g',
    'protein_per_100g',
    'carbs_per_100g',
    'fat_per_100g',
    'fiber_per_100g',
    'sugar_per_100g',
    'sodium_per_100g',
    'serving_size_g',
    'serving_label',
    'barcode',
    'source',
    'is_favorite',
    'usage_count',
    'last_used_at',
    'created_at',
    'updated_at',
  ],
  food_entries: [
    'id',
    'date',
    'meal_type',
    'food_id',
    'name',
    'brand',
    'quantity',
    'unit',
    'serving_label',
    'grams_total',
    'calories',
    'protein',
    'carbs',
    'fat',
    'fiber',
    'sugar',
    'sodium',
    'photo_uri',
    'source',
    'vision_confidence',
    'was_edited',
    'logged_at',
    'created_at',
    'updated_at',
  ],
  exercise_entries: [
    'id',
    'date',
    'name',
    'category',
    'duration_min',
    'calories_burned',
    'source',
    'external_id',
    'notes',
    'logged_at',
    'created_at',
    'updated_at',
  ],
  weight_logs: [
    'id',
    'date',
    'weight_kg',
    'body_fat_pct',
    'note',
    'source',
    'created_at',
    'updated_at',
  ],
  settings: ['key', 'value'],
  /**
   * Added by migration 2. NOTE: `account_id` is deliberately absent from the
   * lists above — see the docblock on {@link COLUMNS}.
   */
  accounts: [
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
  ],
} as const;

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS profile (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  sex               TEXT NOT NULL,
  birth_date        TEXT NOT NULL,
  height_cm         REAL NOT NULL,
  current_weight_kg REAL NOT NULL,
  goal_weight_kg    REAL,
  activity_level    TEXT NOT NULL,
  weight_unit       TEXT NOT NULL,
  height_unit       TEXT NOT NULL,
  onboarded_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id                 TEXT PRIMARY KEY NOT NULL,
  type               TEXT NOT NULL,
  rate_kg_per_week   REAL NOT NULL,
  macro_split        TEXT NOT NULL,
  target_calories    REAL NOT NULL,
  target_protein     REAL NOT NULL,
  target_carbs       REAL NOT NULL,
  target_fat         REAL NOT NULL,
  is_manual_override INTEGER NOT NULL DEFAULT 0,
  started_at         TEXT NOT NULL,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS foods (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  brand             TEXT,
  calories_per_100g REAL NOT NULL,
  protein_per_100g  REAL NOT NULL,
  carbs_per_100g    REAL NOT NULL,
  fat_per_100g      REAL NOT NULL,
  fiber_per_100g    REAL,
  sugar_per_100g    REAL,
  sodium_per_100g   REAL,
  serving_size_g    REAL NOT NULL,
  serving_label     TEXT NOT NULL,
  barcode           TEXT,
  source            TEXT NOT NULL,
  is_favorite       INTEGER NOT NULL DEFAULT 0,
  usage_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS food_entries (
  id                TEXT PRIMARY KEY NOT NULL,
  date              TEXT NOT NULL,
  meal_type         TEXT NOT NULL,
  food_id           TEXT REFERENCES foods(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  brand             TEXT,
  quantity          REAL NOT NULL,
  unit              TEXT NOT NULL,
  serving_label     TEXT NOT NULL,
  grams_total       REAL NOT NULL,
  calories          REAL NOT NULL,
  protein           REAL NOT NULL,
  carbs             REAL NOT NULL,
  fat               REAL NOT NULL,
  fiber             REAL,
  sugar             REAL,
  sodium            REAL,
  photo_uri         TEXT,
  source            TEXT NOT NULL,
  vision_confidence REAL,
  was_edited        INTEGER NOT NULL DEFAULT 0,
  logged_at         TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise_entries (
  id              TEXT PRIMARY KEY NOT NULL,
  date            TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  duration_min    REAL NOT NULL,
  calories_burned REAL NOT NULL,
  source          TEXT NOT NULL,
  external_id     TEXT,
  notes           TEXT,
  logged_at       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weight_logs (
  id           TEXT PRIMARY KEY NOT NULL,
  date         TEXT NOT NULL,
  weight_kg    REAL NOT NULL,
  body_fat_pct REAL,
  note         TEXT,
  source       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _migrations (
  version    INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_food_entries_date ON food_entries(date);
CREATE INDEX IF NOT EXISTS idx_food_entries_date_meal ON food_entries(date, meal_type);
CREATE INDEX IF NOT EXISTS idx_food_entries_food_id ON food_entries(food_id);
CREATE INDEX IF NOT EXISTS idx_exercise_entries_date ON exercise_entries(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_entries_external_id
  ON exercise_entries(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_weight_logs_date ON weight_logs(date);
CREATE INDEX IF NOT EXISTS idx_foods_name ON foods(name);
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode);
`;

export interface Migration {
  version: number;
  sql: string;
}

/**
 * Migration 2 — local, on-device user accounts.
 *
 * Adds the `accounts` table and scopes every user table with a nullable
 * `account_id`.
 *
 * ## Why `account_id` is nullable
 * SQLite's `ALTER TABLE ... ADD COLUMN` refuses a column that is `NOT NULL`
 * without a constant default, and a FK column added to an existing table must
 * default to `NULL`. Rebuilding seven tables on a live database is far riskier
 * than a nullable column plus a backfill, so the column is nullable and the
 * rows are "claimed" at runtime (see `claimLegacyData` in
 * `@/db/repositories/accounts`).
 *
 * ## What `account_id IS NULL` means
 * - `foods`      -> a SHARED row: the built-in seed catalogue, visible to every
 *                   account on the device. Never claimed, never deleted with an
 *                   account. Custom/scanned foods always carry an `account_id`.
 * - every other  -> LEGACY pre-auth data written before accounts existed. The
 *   scoped table    FIRST account created on the device claims it so an existing
 *                   single-user database is never orphaned. Later accounts start
 *                   empty.
 *
 * ## Uniqueness
 * - `accounts.email` is stored lowercase and guarded by both a column-level
 *   `UNIQUE` and a `UNIQUE INDEX ON LOWER(email)` so mixed-case duplicates are
 *   impossible even if a caller forgets to normalize.
 * - `profile` gains a UNIQUE index on `account_id`: at most one profile row per
 *   account (SQLite treats NULLs as distinct, so the legacy row is unaffected).
 * - `settings` gains a UNIQUE index on `(account_id, key)`.
 *   THIS INDEX IS INERT — `settings.key` is still the table's PRIMARY KEY from
 *   migration 1, so `key` is globally unique and two accounts can never hold the
 *   same setting. FIXED BY MIGRATION 3, which rebuilds the table with a
 *   composite primary key. Do not rely on this index.
 *
 * ## Idempotency
 * `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` form in SQLite. Single
 * execution is guaranteed by the `_migrations` ledger in `client.ts`, and the
 * whole script runs inside one transaction, so a partial failure rolls back
 * completely and leaves the database on version 1.
 */
const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS accounts (
  id                   TEXT PRIMARY KEY NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  password_salt        TEXT NOT NULL,
  password_iterations  INTEGER NOT NULL,
  password_algorithm   TEXT NOT NULL,
  security_question    TEXT,
  security_answer_hash TEXT,
  security_answer_salt TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_login_at        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_lower ON accounts(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_accounts_last_login ON accounts(last_login_at DESC);

ALTER TABLE profile          ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE goals            ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE food_entries     ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE exercise_entries ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE weight_logs      ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE settings         ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE foods            ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_food_entries_account_date
  ON food_entries(account_id, date);
CREATE INDEX IF NOT EXISTS idx_exercise_entries_account_date
  ON exercise_entries(account_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_logs_account_date
  ON weight_logs(account_id, date);
CREATE INDEX IF NOT EXISTS idx_goals_account ON goals(account_id);
CREATE INDEX IF NOT EXISTS idx_foods_account_name ON foods(account_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_account ON profile(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_account_key ON settings(account_id, key);
`;

/**
 * Migration 3 — make per-account isolation actually enforceable.
 *
 * Migration 2 scoped the tables it could reach with `ALTER TABLE ADD COLUMN`,
 * but two of its indexes turned out to be INERT and two invariants were still
 * only enforced in JavaScript. This script fixes all four at the DB level.
 *
 * WHY A NEW MIGRATION INSTEAD OF EDITING 2: a device that already ran version 2
 * has it recorded in `_migrations` and would never see an edit to that script.
 * Version 3 is the only form that reaches both fresh installs (1 -> 2 -> 3) and
 * databases already sitting on 2.
 *
 * ## 1. `settings` — rebuilt for a composite primary key
 * `settings.key` was `TEXT PRIMARY KEY`, i.e. globally unique, so migration 2's
 * `idx_settings_account_key(account_id, key)` could never fire: two accounts
 * could not both own a `weightUnit` row. Account B's `saveSettings` overwrote
 * account A's row outright. SQLite cannot alter a primary key in place, so the
 * table is rebuilt with `PRIMARY KEY (account_id, key)`.
 *
 * ## 2. `profile` — rebuilt for one row per account
 * `profile` was a singleton keyed by the literal id `'me'`, so every account
 * shared one row and height / birth date / sex / body fat bled across accounts.
 *
 * CHOICE MADE: keep the surrogate `id` as the PRIMARY KEY and make `account_id`
 * `NOT NULL UNIQUE`. Keeping `id` means `rowToProfile`, `UserProfile.id` and
 * every `ON CONFLICT(id)` upsert keep working unchanged, while `UNIQUE
 * (account_id)` is what actually enforces "at most one profile per account" —
 * and, unlike migration 2's index, it now also constrains the unclaimed row,
 * because `account_id` can no longer be NULL.
 *
 * De-duplication: only ONE row per account survives the rebuild — for the
 * unclaimed bucket that is the row `getProfile()` was actually returning
 * (`id = 'me'` if present, else the oldest). Any other rows were unreachable.
 *
 * ## Why the rebuilt tables use `''` and drop the foreign key
 * `NOT NULL` needs a value for rows that predate accounts, and at migration time
 * no account exists to point at, so unclaimed rows get the empty-string sentinel
 * (see {@link UNCLAIMED_ACCOUNT_ID}). `''` is not a real `accounts.id`, so these
 * two tables cannot carry `REFERENCES accounts(id)` — with `foreign_keys = ON`
 * every unclaimed row would violate it. Nothing is lost: `deleteAccount()` in
 * `@/db/repositories/accounts` already deletes each scoped table explicitly in
 * one transaction rather than relying on cascade.
 *
 * ## 3. `weight_logs` — one log per (account, date), enforced by the DB
 * The invariant was JS-only, which produced duplicate rows under concurrent
 * saves. A plain `UNIQUE(account_id, date)` would NOT do the job: SQLite treats
 * NULLs as distinct in unique indexes, so every legacy row would escape it.
 * The index is therefore on `(COALESCE(account_id, ''), date)`, which constrains
 * unclaimed and owned rows alike. Duplicates are removed first (newest wins,
 * matching `addWeightLog`'s "replace the log for this date") or the index would
 * fail to build on a populated database.
 *
 * ## 4. `foods` — one row per (account, barcode)
 * `idx_foods_barcode` is non-unique, so `getFoodByBarcode(...) LIMIT 1` picked
 * arbitrarily among duplicates. Now unique per account — a barcode may legitimately
 * appear once per account plus once in the shared seed catalogue. Partial
 * (`WHERE barcode IS NOT NULL`) so the many barcode-less foods are unaffected,
 * and de-duplicated first, keeping the OLDEST row (the one entries were most
 * likely created from). `idx_foods_barcode` is kept: this expression index
 * cannot serve a plain `WHERE barcode = ?` lookup.
 */
const MIGRATION_003 = `
CREATE TABLE IF NOT EXISTS settings_v3 (
  account_id TEXT NOT NULL DEFAULT '',
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

INSERT OR REPLACE INTO settings_v3 (account_id, key, value)
  SELECT COALESCE(account_id, ''), key, value FROM settings;

DROP TABLE settings;
ALTER TABLE settings_v3 RENAME TO settings;

CREATE TABLE IF NOT EXISTS profile_v3 (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  sex               TEXT NOT NULL,
  birth_date        TEXT NOT NULL,
  height_cm         REAL NOT NULL,
  current_weight_kg REAL NOT NULL,
  goal_weight_kg    REAL,
  activity_level    TEXT NOT NULL,
  weight_unit       TEXT NOT NULL,
  height_unit       TEXT NOT NULL,
  onboarded_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  account_id        TEXT NOT NULL DEFAULT '',
  UNIQUE (account_id)
);

INSERT INTO profile_v3 (
  id, name, sex, birth_date, height_cm, current_weight_kg, goal_weight_kg,
  activity_level, weight_unit, height_unit, onboarded_at, created_at,
  updated_at, account_id)
SELECT
  id, name, sex, birth_date, height_cm, current_weight_kg, goal_weight_kg,
  activity_level, weight_unit, height_unit, onboarded_at, created_at,
  updated_at, COALESCE(account_id, '')
FROM profile p
WHERE p.rowid = (
  SELECT q.rowid FROM profile q
  WHERE COALESCE(q.account_id, '') = COALESCE(p.account_id, '')
  ORDER BY (q.id <> 'me'), q.created_at ASC, q.rowid ASC
  LIMIT 1
);

DROP TABLE profile;
ALTER TABLE profile_v3 RENAME TO profile;

DELETE FROM weight_logs WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM weight_logs GROUP BY COALESCE(account_id, ''), date
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_logs_account_date_unique
  ON weight_logs(COALESCE(account_id, ''), date);

DELETE FROM foods WHERE barcode IS NOT NULL AND rowid NOT IN (
  SELECT MIN(rowid) FROM foods WHERE barcode IS NOT NULL
  GROUP BY COALESCE(account_id, ''), barcode
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_account_barcode
  ON foods(COALESCE(account_id, ''), barcode) WHERE barcode IS NOT NULL;
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: MIGRATION_001 },
  { version: 2, sql: MIGRATION_002 },
  { version: 3, sql: MIGRATION_003 },
];
