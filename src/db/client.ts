/**
 * SQLite connection + migration runner for MacroTrack.
 *
 * Uses the modern async `expo-sqlite` API. Everything in the app should get its
 * database handle from `getDb()`; tests can inject an in-memory database with
 * `setTestDb()` or `__setDbFactory()`.
 */
import * as SQLite from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';

import type { ID, ISODate, ISODateTime } from '@/types';
import { ALL_TABLES, DATABASE_NAME, MIGRATIONS } from './schema';

export type Database = SQLite.SQLiteDatabase;
export type DbFactory = () => Promise<Database>;

let dbPromise: Promise<Database> | null = null;
let initPromise: Promise<void> | null = null;
let dbFactory: DbFactory | null = null;

/** Applies the pragmas every MacroTrack connection relies on. */
export async function configureConnection(db: Database): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
}

async function defaultFactory(): Promise<Database> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await configureConnection(db);
  return db;
}

/**
 * Singleton database handle. Opens `macrotrack.db` on first call with
 * `foreign_keys = ON` and `journal_mode = WAL`.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    const factory = dbFactory ?? defaultFactory;
    dbPromise = factory().catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/**
 * Replaces the factory used to open the database (tests).
 * Pass `null` to restore the default `macrotrack.db` factory.
 */
export function __setDbFactory(fn: DbFactory | null): void {
  dbFactory = fn;
  dbPromise = null;
  initPromise = null;
}

/**
 * Injects an already-opened database (tests). Pass `null` to clear.
 * Example: `setTestDb(await SQLite.openDatabaseAsync(':memory:'))`.
 */
export function setTestDb(db: Database | null): void {
  dbPromise = db ? Promise.resolve(db) : null;
  initPromise = null;
  dbFactory = db ? async () => db : dbFactory;
}

/** Closes and forgets the current handle (tests / logout flows). */
export async function closeDb(): Promise<void> {
  const current = dbPromise;
  dbPromise = null;
  initPromise = null;
  if (!current) return;
  try {
    const db = await current;
    await db.closeAsync();
  } catch {
    // Already closed or never opened — nothing to do.
  }
}

async function runMigrations(): Promise<void> {
  const db = await getDb();

  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);'
  );

  const rows =
    (await db.getAllAsync<{ version: number }>('SELECT version FROM _migrations;')) ?? [];
  const applied = new Set(rows.map((r) => r.version));

  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version
  );
  if (pending.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const migration of pending) {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT OR REPLACE INTO _migrations (version, applied_at) VALUES (?, ?);',
        migration.version,
        nowISO()
      );
    }
  });
}

/** Runs every pending migration. Safe to call repeatedly (idempotent). */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = runMigrations().catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

/** Drops every table and re-applies all migrations. Destructive. */
export async function resetDatabase(): Promise<void> {
  const db = await getDb();
  initPromise = null;

  await db.execAsync('PRAGMA foreign_keys = OFF;');
  await db.execAsync(ALL_TABLES.map((table) => `DROP TABLE IF EXISTS ${table};`).join('\n'));
  await db.execAsync('PRAGMA foreign_keys = ON;');

  await initDatabase();
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** URL-safe 21 character unique id. */
export function newId(): ID {
  return nanoid();
}

/** Current timestamp as full ISO 8601, e.g. '2026-08-19T18:30:00.000Z'. */
export function nowISO(): ISODateTime {
  return new Date().toISOString();
}

/** Local-time calendar date as 'YYYY-MM-DD' (never UTC-shifted). */
export function toISODate(d: Date): ISODate {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today as 'YYYY-MM-DD' in local time. */
export function todayISO(): ISODate {
  return toISODate(new Date());
}

/** SQLite has no boolean type — booleans are stored as 0/1 INTEGER. */
export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export function intToBool(value: number | boolean | null | undefined): boolean {
  return value === 1 || value === true;
}
