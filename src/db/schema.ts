/**
 * SQLite schema for MacroTrack.
 *
 * Every migration is an idempotent SQL script (`CREATE TABLE IF NOT EXISTS ...`).
 * `src/db/client.ts` applies pending migrations in order inside a transaction and
 * records the applied version in `_migrations`.
 *
 * IMPORTANT: `Macros` are stored as individual REAL columns (never JSON) so that
 * SQL aggregation (`SUM(calories)`, ...) works directly.
 */

export const DATABASE_NAME = 'macrotrack.db';

export const SCHEMA_VERSION = 1;

/** Canonical table names — use these instead of string literals. */
export const TABLES = {
  profile: 'profile',
  goals: 'goals',
  foods: 'foods',
  foodEntries: 'food_entries',
  exerciseEntries: 'exercise_entries',
  weightLogs: 'weight_logs',
  settings: 'settings',
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
  TABLES.migrations,
];

/** Column names per table — handy for building dynamic SQL in repositories. */
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

export const MIGRATIONS: Migration[] = [{ version: 1, sql: MIGRATION_001 }];
