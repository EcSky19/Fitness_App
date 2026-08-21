import { getDb } from '@/db/client';
import { SCHEMA_VERSION } from '@/db/schema';
import {
  addExerciseEntry,
  addFoodEntry,
  addWeightLog,
  clearAllData,
  countFoods,
  exportAllData,
  getDbStats,
  getProfile,
  getSettings,
  saveGoal,
  saveProfile,
  saveRecipe,
  saveSettings,
  upsertFood,
  type NewFoodEntry,
} from '@/db/repositories';
import type { AppSettings } from '@/types';

import { DEFAULT_TEST_ACCOUNT_ID, setupTestDb, teardownTestDb, useTestAccount } from './testDb';

const ENTRY: NewFoodEntry = {
  date: '2026-05-01',
  mealType: 'lunch',
  foodId: null,
  name: 'Chicken bowl',
  brand: null,
  quantity: 1,
  unit: 'serving',
  servingLabel: '1 bowl',
  gramsTotal: 200,
  macros: { calories: 300, protein: 20, carbs: 30, fat: 10 },
  photoUri: null,
  source: 'quick_add',
  visionConfidence: null,
  wasEdited: false,
  loggedAt: '2026-05-01T12:00:00.000Z',
};

async function seedEverything(): Promise<void> {
  await saveProfile({ name: 'Ada', currentWeightKg: 62 });
  await saveGoal({ type: 'cut', rateKgPerWeek: -0.5 });
  await upsertFood({ name: 'Rice', per100g: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 } });
  await addFoodEntry(ENTRY);
  await addExerciseEntry({
    date: '2026-05-01',
    name: 'Run',
    category: 'cardio',
    durationMin: 30,
    caloriesBurned: 300,
    source: 'manual',
    externalId: null,
    notes: null,
    loggedAt: '2026-05-01T07:00:00.000Z',
  });
  await addWeightLog({
    date: '2026-05-01',
    weightKg: 62,
    bodyFatPct: null,
    note: null,
    source: 'manual',
  });
  await saveSettings({ weightUnit: 'kg', healthSyncEnabled: true });
}

describe('settings repository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('returns an empty object before anything is saved', async () => {
    await expect(getSettings()).resolves.toEqual({});
  });

  it('round-trips JSON encoded values of every type', async () => {
    const patch: Partial<AppSettings> = {
      weightUnit: 'kg',
      heightUnit: 'cm',
      energyUnit: 'kJ',
      visionProvider: 'openai',
      healthSyncEnabled: true,
      addExerciseToTarget: false,
      theme: 'dark',
    };
    await saveSettings(patch);

    const loaded = await getSettings();
    expect(loaded).toEqual(patch);
    expect(loaded.healthSyncEnabled).toBe(true);
    expect(loaded.addExerciseToTarget).toBe(false);

    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?;',
      'healthSyncEnabled'
    );
    expect(row?.value).toBe('true');
  });

  it('merges partial writes and ignores unknown or undefined keys', async () => {
    await saveSettings({ weightUnit: 'kg', theme: 'light' });
    await saveSettings({ theme: 'dark', energyUnit: undefined });
    await saveSettings({ nope: 'value' } as unknown as Partial<AppSettings>);
    await saveSettings({});

    await expect(getSettings()).resolves.toEqual({ weightUnit: 'kg', theme: 'dark' });
  });

  it('skips corrupt values instead of throwing', async () => {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO settings (account_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value;`,
      DEFAULT_TEST_ACCOUNT_ID,
      'theme',
      '{'
    );
    await db.runAsync(
      `INSERT INTO settings (account_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value;`,
      DEFAULT_TEST_ACCOUNT_ID,
      'weightUnit',
      '"kg"'
    );

    await expect(getSettings()).resolves.toEqual({ weightUnit: 'kg' });
  });
});

describe('admin repository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('exports a full snapshot', async () => {
    await seedEverything();
    const dump = await exportAllData();

    expect(Object.keys(dump).sort()).toEqual([
      'exerciseEntries',
      'exportedAt',
      'foodEntries',
      'foods',
      'goals',
      'profile',
      'recipes',
      'settings',
      'version',
      'weightLogs',
    ]);
    expect(dump.version).toBe(SCHEMA_VERSION);
    expect(dump.exportedAt).toEqual(expect.any(String));
    expect(dump.profile).toMatchObject({ name: 'Ada' });
    expect(dump.goals).toHaveLength(1);
    expect(dump.foods).toHaveLength(1);
    expect(dump.foodEntries).toHaveLength(1);
    expect(dump.exerciseEntries).toHaveLength(1);
    expect(dump.weightLogs).toHaveLength(1);
    expect(dump.settings).toEqual({ weightUnit: 'kg', healthSyncEnabled: true });
  });

  it('exports every recipe, not just the first page', async () => {
    const total = 51;
    for (let i = 0; i < total; i += 1) {
      await saveRecipe({
        name: `Recipe ${String(i).padStart(3, '0')}`,
        items: [
          {
            foodId: null,
            name: 'Ingredient',
            quantity: 1,
            unit: 'serving',
            gramsTotal: 100,
            macros: { calories: 100, protein: 10, carbs: 10, fat: 2 },
            sortOrder: 0,
          },
        ],
      });
    }

    const dump = await exportAllData();

    expect(dump.recipes).toHaveLength(total);
  });

  it('reports row counts', async () => {
    await expect(getDbStats()).resolves.toEqual({
      foods: 0,
      foodEntries: 0,
      recipes: 0,
      exerciseEntries: 0,
      weightLogs: 0,
    });

    await seedEverything();

    await expect(getDbStats()).resolves.toEqual({
      foods: 1,
      foodEntries: 1,
      recipes: 0,
      exerciseEntries: 1,
      weightLogs: 1,
    });
  });

  it('clears user data but keeps the schema', async () => {
    await seedEverything();
    await clearAllData();

    await expect(getDbStats()).resolves.toEqual({
      foods: 0,
      foodEntries: 0,
      recipes: 0,
      exerciseEntries: 0,
      weightLogs: 0,
    });
    await expect(getProfile()).resolves.toBeNull();
    await expect(getSettings()).resolves.toEqual({});
    await expect(countFoods()).resolves.toBe(0);

    // Schema still there: writes keep working without re-migrating.
    const profile = await saveProfile({ name: 'Fresh start' });
    expect(profile.name).toBe('Fresh start');
  });
});
