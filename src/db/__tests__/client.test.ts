import {
  __setDbFactory,
  boolToInt,
  closeDb,
  getDb,
  initDatabase,
  intToBool,
  newId,
  nowISO,
  resetDatabase,
  toISODate,
  todayISO,
  type Database,
} from '@/db/client';
import { MIGRATIONS, SCHEMA_VERSION } from '@/db/schema';

function createFakeDb() {
  const execCalls: string[] = [];
  const runCalls: { sql: string; args: unknown[] }[] = [];
  const appliedVersions: number[] = [];

  const db = {
    execAsync: jest.fn(async (sql: string) => {
      execCalls.push(sql);
    }),
    runAsync: jest.fn(async (sql: string, ...args: unknown[]) => {
      runCalls.push({ sql, args });
      if (sql.includes('_migrations')) appliedVersions.push(args[0] as number);
      return { lastInsertRowId: 0, changes: 1 };
    }),
    getAllAsync: jest.fn(async () => appliedVersions.map((version) => ({ version }))),
    getFirstAsync: jest.fn(async () => null),
    withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => {
      await cb();
    }),
    closeAsync: jest.fn(async () => {}),
  };

  return { db: db as unknown as Database, execCalls, runCalls, appliedVersions };
}

describe('db/client helpers', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    expect(newId()).toHaveLength(21);
  });

  it('formats timestamps and local dates', () => {
    expect(nowISO()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('converts booleans to sqlite integers', () => {
    expect(boolToInt(true)).toBe(1);
    expect(boolToInt(false)).toBe(0);
    expect(intToBool(1)).toBe(true);
    expect(intToBool(0)).toBe(false);
    expect(intToBool(null)).toBe(false);
    expect(intToBool(undefined)).toBe(false);
  });
});

describe('db/client migrations', () => {
  afterEach(async () => {
    await closeDb();
    __setDbFactory(null);
  });

  it('applies pending migrations once and is idempotent', async () => {
    const fake = createFakeDb();
    __setDbFactory(async () => fake.db);

    await initDatabase();
    await initDatabase();

    expect(fake.appliedVersions).toEqual(MIGRATIONS.map((m) => m.version));
    expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(SCHEMA_VERSION);

    const ddl = fake.execCalls.join('\n');
    for (const table of [
      'profile',
      'goals',
      'foods',
      'food_entries',
      'exercise_entries',
      'weight_logs',
      'settings',
      '_migrations',
    ]) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(ddl).toContain('idx_food_entries_date_meal');
  });

  it('reuses a single connection', async () => {
    const fake = createFakeDb();
    const factory = jest.fn(async () => fake.db);
    __setDbFactory(factory);

    await getDb();
    await getDb();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('drops every table on reset and re-runs migrations', async () => {
    const fake = createFakeDb();
    __setDbFactory(async () => fake.db);

    await initDatabase();
    fake.appliedVersions.length = 0;
    await resetDatabase();

    const sql = fake.execCalls.join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS food_entries;');
    expect(sql).toContain('DROP TABLE IF EXISTS profile;');
    expect(fake.appliedVersions).toEqual(MIGRATIONS.map((m) => m.version));
  });
});
