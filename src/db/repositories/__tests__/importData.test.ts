const mockFileDelete = jest.fn();

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file:///');
      if (!this.uri.endsWith('/')) this.uri += '/';
    }

    create(): void {}
  }

  class MockFile {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file:///');
    }

    copy(): void {}

    delete(): void {
      mockFileDelete(this.uri);
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: new MockDirectory('file:///document') },
  };
});

import { getDb, type Database } from '@/db/client';
import { SCHEMA_VERSION } from '@/db/schema';
import {
  addExerciseEntry,
  addFoodEntry,
  addWeightLog,
  clearAllData,
  exportAllData,
  getDbStats,
  getFoodEntry,
  getLatestWeight,
  getProfile,
  getSettings,
  listEntriesByDate,
  listExercisesByDate,
  listGoals,
  listRecipes,
  listWeightLogs,
  saveGoal,
  saveProfile,
  saveRecipe,
  saveSettings,
  searchFoods,
  seedFoods,
  upsertFood,
} from '@/db/repositories';
import { setCurrentSession } from '@/services/auth/currentAccount';
import type { Food, Macros } from '@/types';

import { importAllData, ImportDataError } from '../importData';
import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';
const MACROS: Macros = { calories: 100, protein: 10, carbs: 10, fat: 2 };

function asBackup(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function seedEverything(): Promise<Record<string, unknown>> {
  await saveProfile({ name: 'Ada', currentWeightKg: 62, heightCm: 165 });
  await saveGoal({ type: 'cut', rateKgPerWeek: -0.5 });
  await seedFoods([
    { id: 'seed-apple', name: 'Seed apple', source: 'seed', barcode: 'seed-apple', per100g: MACROS },
  ]);
  const rice = await upsertFood({
    id: 'food-rice',
    name: 'Rice',
    brand: 'Macro',
    barcode: 'rice-1',
    per100g: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    servingSizeG: 100,
    servingLabel: '100 g',
    source: 'custom',
  });
  await addFoodEntry({
    date: '2026-05-01',
    mealType: 'lunch',
    foodId: rice.id,
    name: 'Rice',
    brand: 'Macro',
    quantity: 1,
    unit: 'serving',
    servingLabel: '100 g',
    gramsTotal: 100,
    macros: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    loggedAt: '2026-05-01T12:00:00.000Z',
  });
  await saveRecipe({
    id: 'recipe-bowl',
    name: 'Rice bowl',
    kind: 'meal',
    servings: 1,
    defaultMealType: 'dinner',
    items: [
      {
        foodId: rice.id,
        name: 'Rice',
        quantity: 1,
        unit: 'serving',
        gramsTotal: 100,
        macros: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
        sortOrder: 0,
      },
    ],
  });
  await addExerciseEntry({
    date: '2026-05-01',
    name: 'Run',
    category: 'cardio',
    durationMin: 30,
    caloriesBurned: 300,
    source: 'manual',
    externalId: null,
    notes: 'easy',
    loggedAt: '2026-05-01T07:00:00.000Z',
  });
  await addWeightLog({
    date: '2026-05-01',
    weightKg: 62,
    bodyFatPct: 20,
    note: 'baseline',
    source: 'manual',
  });
  await saveSettings({ weightUnit: 'kg', healthSyncEnabled: true, theme: 'dark' });
  return asBackup(await exportAllData());
}

describe('importAllData', () => {
  beforeEach(async () => {
    mockFileDelete.mockClear();
    await setupTestDb();
    await useTestAccount(ACCOUNT_A);
  });

  afterEach(async () => {
    setCurrentSession(null);
    await teardownTestDb();
  });

  it('round-trips an export into a clean database', async () => {
    const dump = await seedEverything();
    await teardownTestDb();
    await setupTestDb();
    await useTestAccount(ACCOUNT_A);

    const result = await importAllData(dump, { mode: 'replace' });

    expect(result.warnings).toEqual([]);
    await expect(getProfile()).resolves.toMatchObject({ name: 'Ada', currentWeightKg: 62 });
    await expect(listGoals()).resolves.toMatchObject([{ type: 'cut' }]);
    await expect(searchFoods('Rice')).resolves.toMatchObject([{ name: 'Rice', barcode: 'rice-1' }]);
    await expect(searchFoods('Seed apple')).resolves.toMatchObject([{ source: 'seed' }]);
    await expect(listEntriesByDate('2026-05-01')).resolves.toMatchObject([{ name: 'Rice' }]);
    await expect(listRecipes()).resolves.toMatchObject([
      { name: 'Rice bowl', items: [{ name: 'Rice' }] },
    ]);
    await expect(listExercisesByDate('2026-05-01')).resolves.toMatchObject([{ name: 'Run' }]);
    await expect(listWeightLogs()).resolves.toMatchObject([{ weightKg: 62 }]);
    await expect(getSettings()).resolves.toMatchObject({
      weightUnit: 'kg',
      healthSyncEnabled: true,
      theme: 'dark',
    });
  });

  it.each([
    null,
    'not json',
    {},
    { version: SCHEMA_VERSION, exportedAt: 'now', profile: null, goals: {}, foods: [], foodEntries: [], recipes: [], exerciseEntries: [], weightLogs: [], settings: {} },
    { version: SCHEMA_VERSION, exportedAt: 'now', profile: null, goals: [], foods: [], foodEntries: [], recipes: [], exerciseEntries: [], settings: {} },
  ])('rejects malformed input without changing the database: %#', async (payload) => {
    await saveProfile({ name: 'Still here' });
    const before = await getDbStats();

    await expect(importAllData(payload)).rejects.toBeInstanceOf(ImportDataError);

    await expect(getDbStats()).resolves.toEqual(before);
    await expect(getProfile()).resolves.toMatchObject({ name: 'Still here' });
  });

  it('skips one corrupt row with a warning and imports the rest', async () => {
    const dump = await seedEverything();
    await clearAllData();
    const foods = dump.foods as unknown[];
    foods.push({ id: 'bad-food', name: 'Broken food' });

    const result = await importAllData(dump, { mode: 'replace' });

    expect(result.counts.foods.imported).toBeGreaterThanOrEqual(1);
    expect(result.counts.foods.skipped).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('foods')]));
    await expect(searchFoods('Rice')).resolves.toHaveLength(1);
    await expect(searchFoods('Broken food')).resolves.toHaveLength(0);
  });

  it('refuses newer schema versions', async () => {
    const dump = await seedEverything();
    dump.version = SCHEMA_VERSION + 1;
    await clearAllData();

    await expect(importAllData(dump)).rejects.toThrow(/newer than supported/);
    await expect(getDbStats()).resolves.toMatchObject({ foods: 1, foodEntries: 0 });
  });

  it('does not duplicate rows when the same file is merged twice', async () => {
    const dump = await seedEverything();
    await clearAllData();

    await importAllData(dump);
    const afterFirst = await getDbStats();
    const second = await importAllData(dump);

    await expect(getDbStats()).resolves.toEqual(afterFirst);
    expect(second.counts.foodEntries.imported).toBe(0);
    expect(second.counts.foodEntries.skipped).toBeGreaterThan(0);
  });

  it('replace mode wipes prior account data first', async () => {
    const dump = await seedEverything();
    await clearAllData();
    await saveProfile({ name: 'Old profile' });
    await upsertFood({ name: 'Old food', per100g: MACROS });

    await importAllData(dump, { mode: 'replace' });

    await expect(getProfile()).resolves.toMatchObject({ name: 'Ada' });
    await expect(searchFoods('Old food')).resolves.toHaveLength(0);
    await expect(searchFoods('Rice')).resolves.toHaveLength(1);
  });

  it('ignores embedded accountId values and scopes imported rows to the current account', async () => {
    const dump = await seedEverything();
    for (const key of ['profile', 'goals', 'foods', 'foodEntries', 'exerciseEntries', 'weightLogs']) {
      const value = dump[key];
      if (Array.isArray(value)) {
        for (const row of value) {
          if (typeof row === 'object' && row !== null) (row as Record<string, unknown>).accountId = ACCOUNT_A;
        }
      } else if (typeof value === 'object' && value !== null) {
        (value as Record<string, unknown>).accountId = ACCOUNT_A;
      }
    }

    await useTestAccount(ACCOUNT_B);
    await importAllData(dump);

    const db = await getDb();
    const row = await db.getFirstAsync<{ account_id: string }>(
      "SELECT account_id FROM foods WHERE name = 'Rice' AND account_id = ? LIMIT 1;",
      ACCOUNT_B
    );
    expect(row?.account_id).toBe(ACCOUNT_B);
    await expect(searchFoods('Rice')).resolves.toHaveLength(1);

    await useTestAccount(ACCOUNT_A);
    await expect(searchFoods('Rice')).resolves.toHaveLength(1);
  });

  it('remaps colliding food ids so imported entries do not dangle', async () => {
    const dump = await seedEverything();
    await useTestAccount(ACCOUNT_B);

    await importAllData(dump);

    const entries = await listEntriesByDate('2026-05-01');
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.foodId).toBe('food-rice-imported');
    await expect(getFoodEntry(entry.id)).resolves.toMatchObject({ foodId: 'food-rice-imported' });

    const db = await getDb();
    const dangling = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM food_entries e
       LEFT JOIN foods f ON f.id = e.food_id
       WHERE e.account_id = ? AND e.food_id IS NOT NULL AND f.id IS NULL;`,
      ACCOUNT_B
    );
    expect(dangling?.count).toBe(0);
  });

  it('rolls back the whole import when a mid-import write fails', async () => {
    const dump = await seedEverything();
    await clearAllData();
    const db = await getDb();
    const originalRunAsync: Database['runAsync'] = db.runAsync.bind(db);
    let failFoodEntries = false;
    db.runAsync = (async (...args: Parameters<Database['runAsync']>) => {
      const [sql, ...params] = args;
      if (failFoodEntries && sql.includes('food_entries')) throw new Error('injected failure');
      return originalRunAsync(sql, ...params);
    }) as Database['runAsync'];

    failFoodEntries = true;
    await expect(importAllData(dump, { mode: 'replace' })).rejects.toThrow(/injected failure/);
    db.runAsync = originalRunAsync;

    await expect(getDbStats()).resolves.toMatchObject({
      foods: 1,
      foodEntries: 0,
      recipes: 0,
      exerciseEntries: 0,
      weightLogs: 0,
    });
    const customFoods = (await searchFoods('Rice')).filter((food: Food) => food.source !== 'seed');
    expect(customFoods).toHaveLength(0);
  });

  it('keeps existing photo files when a replace import rolls back', async () => {
    // An existing entry whose photo lives in the account's private folder.
    const entry = await addFoodEntry({
      date: '2026-05-01',
      mealType: 'dinner',
      name: 'Photo meal',
      quantity: 1,
      unit: 'serving',
      gramsTotal: 100,
      macros: MACROS,
      photoUri: 'file:///camera/original.jpg',
    });
    expect(entry.photoUri).toContain('/food-entry-photos/account-a/');

    // A valid dump (contains a food + a food entry) to restore in replace mode.
    const dump = await seedEverything();

    const db = await getDb();
    const originalRunAsync: Database['runAsync'] = db.runAsync.bind(db);
    // Fail on the first re-inserted food entry — AFTER clearAccountData has run.
    db.runAsync = (async (...args: Parameters<Database['runAsync']>) => {
      const [sql, ...params] = args;
      if (sql.includes('INSERT INTO food_entries')) throw new Error('injected failure');
      return originalRunAsync(sql, ...params);
    }) as Database['runAsync'];

    mockFileDelete.mockClear();
    await expect(importAllData(dump, { mode: 'replace' })).rejects.toThrow(/injected failure/);
    db.runAsync = originalRunAsync;

    // The DB rolled back, so the entry — and its photo reference — still exist...
    await expect(getFoodEntry(entry.id)).resolves.toMatchObject({ photoUri: entry.photoUri });
    // ...therefore the photo file must NOT have been deleted by the failed clear.
    expect(mockFileDelete).not.toHaveBeenCalledWith(entry.photoUri);
  });

  it('deletes replaced photo files after a successful replace import', async () => {
    // Build the restore dump FIRST so the photo entry below is NOT part of it.
    const dump = await seedEverything();
    const entry = await addFoodEntry({
      date: '2026-05-02',
      mealType: 'dinner',
      name: 'Orphan photo meal',
      quantity: 1,
      unit: 'serving',
      gramsTotal: 100,
      macros: MACROS,
      photoUri: 'file:///camera/original.jpg',
    });

    mockFileDelete.mockClear();
    await importAllData(dump, { mode: 'replace' });

    // The entry is absent from the dump, so replace wiped it and its now-orphaned
    // photo file was cleaned up (after the transaction committed).
    await expect(getFoodEntry(entry.id)).resolves.toBeNull();
    expect(mockFileDelete).toHaveBeenCalledWith(entry.photoUri);
  });

  it('skips a food entry whose date is not a real calendar day', async () => {
    const dump = await seedEverything();
    await clearAllData();
    const entries = dump.foodEntries as Record<string, unknown>[];
    // Same shape as a real exported entry, but the day bucket carries a full
    // timestamp (wrong width) instead of 'YYYY-MM-DD'. Stored as-is it becomes a
    // ghost: `date = '2026-05-01'` never matches it, so it silently corrupts the
    // day's totals while being invisible on the diary.
    entries.push({ ...entries[0], id: 'ghost-food', date: '2026-05-01T12:00:00.000Z' });

    const result = await importAllData(dump, { mode: 'replace' });

    expect(result.counts.foodEntries.skipped).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('foodEntries')]));
    const db = await getDb();
    const ghost = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM food_entries WHERE date = '2026-05-01T12:00:00.000Z';"
    );
    expect(ghost?.c).toBe(0);
    // The valid entry on the same day is still imported.
    await expect(listEntriesByDate('2026-05-01')).resolves.toMatchObject([{ name: 'Rice' }]);
  });

  it('skips an exercise entry whose date names no real day', async () => {
    const dump = await seedEverything();
    await clearAllData();
    const entries = dump.exerciseEntries as Record<string, unknown>[];
    entries.push({ ...entries[0], id: 'ghost-exercise', externalId: null, date: '2026-02-31' });

    const result = await importAllData(dump, { mode: 'replace' });

    expect(result.counts.exerciseEntries.skipped).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('exerciseEntries')])
    );
    const db = await getDb();
    const ghost = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM exercise_entries WHERE date = '2026-02-31';"
    );
    expect(ghost?.c).toBe(0);
    await expect(listExercisesByDate('2026-05-01')).resolves.toMatchObject([{ name: 'Run' }]);
  });

  it('skips a weight log with a garbage date so it cannot poison the latest weight', async () => {
    const dump = await seedEverything();
    await clearAllData();
    const logs = dump.weightLogs as Record<string, unknown>[];
    // A shape-only-valid date sorts after every real date, so `ORDER BY date
    // DESC` would forever return this bogus 999 kg row as the current weight.
    logs.push({ ...logs[0], id: 'ghost-weight', date: '9999-99-99', weightKg: 999 });

    const result = await importAllData(dump, { mode: 'replace' });

    expect(result.counts.weightLogs.skipped).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('weightLogs')]));
    await expect(getLatestWeight()).resolves.toMatchObject({ weightKg: 62 });
  });
});
