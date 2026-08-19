/**
 * Test database harness.
 *
 * `jest.setup.js` stubs `expo-sqlite` with a no-op mock, so repository tests run
 * against a REAL SQLite engine instead: Node 22+ ships `node:sqlite`, which we
 * wrap in a tiny adapter exposing the same async surface expo-sqlite provides
 * (`execAsync` / `runAsync` / `getAllAsync` / `getFirstAsync` /
 * `withTransactionAsync` / `closeAsync`) and inject through the `__setDbFactory`
 * escape hatch in `@/db/client`. `client.ts` itself is never modified.
 */
import { DatabaseSync } from 'node:sqlite';

import {
  __setDbFactory,
  closeDb,
  configureConnection,
  getDb,
  initDatabase,
  type Database,
} from '@/db/client';

type BindValue = string | number | bigint | null | Uint8Array;

function normalize(value: unknown): BindValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  throw new TypeError(`Unsupported SQLite bind value: ${JSON.stringify(value)}`);
}

/** expo-sqlite accepts both `(sql, ...params)` and `(sql, params[])`. */
function bindParams(params: unknown[]): BindValue[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return flat.map(normalize);
}

function createAdapter(): { db: Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');

  const adapter = {
    execAsync: async (sql: string): Promise<void> => {
      raw.exec(sql);
    },
    runAsync: async (
      sql: string,
      ...params: unknown[]
    ): Promise<{ lastInsertRowId: number; changes: number }> => {
      const result = raw.prepare(sql).run(...bindParams(params));
      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      };
    },
    getAllAsync: async <T>(sql: string, ...params: unknown[]): Promise<T[]> =>
      raw.prepare(sql).all(...bindParams(params)) as T[],
    getFirstAsync: async <T>(sql: string, ...params: unknown[]): Promise<T | null> =>
      (raw.prepare(sql).get(...bindParams(params)) as T | undefined) ?? null,
    withTransactionAsync: async (task: () => Promise<unknown>): Promise<void> => {
      raw.exec('BEGIN;');
      try {
        await task();
        raw.exec('COMMIT;');
      } catch (error) {
        raw.exec('ROLLBACK;');
        throw error;
      }
    },
    closeAsync: async (): Promise<void> => {
      raw.close();
    },
  };

  return { db: adapter as unknown as Database, raw };
}

/** Opens a fresh in-memory database, injects it and runs every migration. */
export async function setupTestDb(): Promise<Database> {
  __setDbFactory(async () => {
    const { db } = createAdapter();
    await configureConnection(db);
    return db;
  });
  await initDatabase();
  return getDb();
}

/** Closes the injected database and restores the default factory. */
export async function teardownTestDb(): Promise<void> {
  await closeDb();
  __setDbFactory(null);
}
