/**
 * Regression tests for concurrency / atomicity bugs in the repository layer.
 *
 * Everything here failed before the fixes:
 *  - overlapping `withTransactionAsync` calls threw
 *    "cannot start a transaction within a transaction";
 *  - `addWeightLog` raced itself into two rows for one date;
 *  - `seedFoods` imported the catalogue twice on a double bootstrap;
 *  - `upsertFood` unlinked every diary entry that referenced the food.
 */
import { getDb } from '@/db/client';
import {
  addFoodEntry,
  addWeightLog,
  clearAllData,
  countFoods,
  getFoodEntry,
  getProfile,
  getWeightLogByDate,
  listExercisesByDate,
  listGoals,
  listWeightLogs,
  saveGoal,
  saveProfile,
  saveSettings,
  seedFoods,
  updateWeightLog,
  upsertExternalExercise,
  upsertFood,
  type FoodInput,
} from '@/db/repositories';
import type { Macros } from '@/types';
import { setCurrentSession } from '@/services/auth/currentAccount';

import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

const MACROS: Macros = { calories: 100, protein: 10, carbs: 10, fat: 2 };

function food(name: string, extra: Partial<FoodInput> = {}): FoodInput {
  return { name, per100g: MACROS, ...extra };
}

describe('repository concurrency', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('serializes overlapping transactions instead of throwing', async () => {
    await expect(
      Promise.all([
        saveGoal({ type: 'cut', isActive: true }),
        saveGoal({ type: 'bulk', isActive: true }),
        saveSettings({ theme: 'dark' }),
        saveSettings({ weightUnit: 'kg' }),
      ])
    ).resolves.toHaveLength(4);

    const goals = await listGoals();
    expect(goals).toHaveLength(2);
    expect(goals.filter((g) => g.isActive)).toHaveLength(1);
  });

  it('keeps clearAllData atomic while other transactions run', async () => {
    await upsertFood(food('Rice'));
    await expect(
      Promise.all([clearAllData(), saveSettings({ theme: 'light' })])
    ).resolves.toHaveLength(2);
    await expect(countFoods()).resolves.toBe(0);
  });

  it('never stores two weight logs for the same date, even concurrently', async () => {
    const [first, second] = await Promise.all([
      addWeightLog({ date: '2026-01-01', weightKg: 80 }),
      addWeightLog({ date: '2026-01-01', weightKg: 81 }),
    ]);

    const logs = await listWeightLogs();
    expect(logs).toHaveLength(1);
    expect([first.weightKg, second.weightKg]).toContain(logs[0].weightKg);

    const stored = await getWeightLogByDate('2026-01-01');
    expect(stored).not.toBeNull();
  });

  it('replaces the log already sitting on a date when a log is moved onto it', async () => {
    const monday = await addWeightLog({ date: '2026-02-02', weightKg: 80 });
    const tuesday = await addWeightLog({ date: '2026-02-03', weightKg: 79 });

    const moved = await updateWeightLog(tuesday.id, { date: '2026-02-02' });

    expect(moved.date).toBe('2026-02-02');
    const logs = await listWeightLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(tuesday.id);
    expect(logs[0].id).not.toBe(monday.id);
    expect(logs[0].weightKg).toBe(79);
  });

  it('seeds the catalogue exactly once when two seed passes overlap', async () => {
    const batch: FoodInput[] = [food('Rice'), food('Beans'), food('Tofu')];

    const [a, b] = await Promise.all([seedFoods(batch), seedFoods(batch)]);

    expect(a + b).toBe(3);
    await expect(countFoods()).resolves.toBe(3);
  });
});

describe('upserts preserve columns outside the repository column list', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO accounts (id, email, display_name, password_hash, password_salt,
         password_iterations, password_algorithm, created_at, updated_at)
       VALUES ('acct-1', 'a@b.c', 'Ada', 'h', 's', 1, 'pbkdf2', '2026-01-01T00:00:00.000Z',
         '2026-01-01T00:00:00.000Z');`
    );
    // `profile` and `settings` are scoped explicitly (schema v3 keys them by
    // account), so they write whatever `getCurrentAccountId()` reports. Sign in
    // as the account these rows are stamped with.
    setCurrentSession({
      accountId: 'acct-1',
      email: 'a@b.c',
      displayName: 'Ada',
      signedInAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterEach(async () => {
    setCurrentSession(null);
    await teardownTestDb();
  });

  /**
   * Schema v2 added `account_id` to most tables but deliberately kept it out of
   * `COLUMNS`. `INSERT OR REPLACE` re-inserted the row without it and silently
   * reset it to NULL; `ON CONFLICT ... DO UPDATE` leaves it alone.
   */
  async function stamp(table: string, id: string, column = 'id'): Promise<void> {
    const db = await getDb();
    await db.runAsync(`UPDATE ${table} SET account_id = ? WHERE ${column} = ?;`, 'acct-1', id);
  }

  async function readAccountId(
    table: string,
    id: string,
    column = 'id'
  ): Promise<string | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ account_id: string | null }>(
      `SELECT account_id FROM ${table} WHERE ${column} = ?;`,
      id
    );
    return row?.account_id ?? null;
  }

  it('keeps account_id when a profile is saved again', async () => {
    const profile = await saveProfile({ name: 'Ada' });
    await stamp('profile', profile.id);

    await saveProfile({ name: 'Ada Lovelace' });

    await expect(readAccountId('profile', profile.id)).resolves.toBe('acct-1');
    await expect(getProfile()).resolves.toMatchObject({ name: 'Ada Lovelace' });
  });

  it('keeps account_id when a goal, food, weight log or setting is saved again', async () => {
    const goal = await saveGoal({ type: 'cut' });
    const rice = await upsertFood(food('Rice'));
    const weight = await addWeightLog({ date: '2026-04-01', weightKg: 70 });
    await saveSettings({ theme: 'dark' });

    await stamp('goals', goal.id);
    await stamp('foods', rice.id);
    await stamp('weight_logs', weight.id);
    await stamp('settings', 'theme', 'key');

    await saveGoal({ id: goal.id, type: 'bulk' });
    await upsertFood(food('Rice', { id: rice.id, brand: 'Basmati' }));
    await addWeightLog({ date: '2026-04-01', weightKg: 71 });
    await saveSettings({ theme: 'light' });

    await expect(readAccountId('goals', goal.id)).resolves.toBe('acct-1');
    await expect(readAccountId('foods', rice.id)).resolves.toBe('acct-1');
    await expect(readAccountId('weight_logs', weight.id)).resolves.toBe('acct-1');
    await expect(readAccountId('settings', 'theme', 'key')).resolves.toBe('acct-1');
  });

  it('keeps account_id when a synced workout is refreshed', async () => {
    const workout = await upsertExternalExercise({
      date: '2026-04-01',
      name: 'Run',
      category: 'cardio',
      durationMin: 30,
      caloriesBurned: 300,
      externalId: 'hk-1',
      source: 'healthkit',
    });
    await stamp('exercise_entries', workout.id);

    const refreshed = await upsertExternalExercise({
      date: '2026-04-01',
      name: 'Run',
      category: 'cardio',
      durationMin: 35,
      caloriesBurned: 340,
      externalId: 'hk-1',
      source: 'healthkit',
    });

    expect(refreshed.id).toBe(workout.id);
    expect(refreshed.createdAt).toBe(workout.createdAt);
    await expect(listExercisesByDate('2026-04-01')).resolves.toHaveLength(1);
    await expect(readAccountId('exercise_entries', workout.id)).resolves.toBe('acct-1');
  });
});

describe('upsertFood row identity', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('keeps diary entries linked to the food when the food is edited', async () => {
    const apple = await upsertFood(food('Apple'));
    const entry = await addFoodEntry({
      date: '2026-01-01',
      mealType: 'snack',
      foodId: apple.id,
      name: 'Apple',
      quantity: 1,
      unit: 'g',
      gramsTotal: 150,
      macros: MACROS,
    });

    const updated = await upsertFood({
      id: apple.id,
      name: 'Apple (large)',
      per100g: { ...MACROS, calories: 120 },
    });

    expect(updated.id).toBe(apple.id);
    expect(updated.createdAt).toBe(apple.createdAt);
    await expect(countFoods()).resolves.toBe(1);

    const reloaded = await getFoodEntry(entry.id);
    expect(reloaded?.foodId).toBe(apple.id);
  });

  it('updates in place rather than deleting and re-inserting the row', async () => {
    const cola = await upsertFood(food('Cola', { barcode: '111', usageCount: 4 }));
    const db = await getDb();
    const before = await db.getFirstAsync<{ rowid: number }>(
      'SELECT rowid FROM foods WHERE id = ?;',
      cola.id
    );

    await upsertFood(food('Cola Zero', { id: cola.id }));

    const after = await db.getFirstAsync<{ rowid: number }>(
      'SELECT rowid FROM foods WHERE id = ?;',
      cola.id
    );
    expect(after?.rowid).toBe(before?.rowid);
  });
});
