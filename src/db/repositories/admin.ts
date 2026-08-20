/**
 * Admin repository — backup / restore-adjacent helpers used by the settings
 * screen (export, wipe, database statistics).
 */
import { nowISO, runInTransaction } from '@/db/client';
import { COLUMNS, SCHEMA_VERSION } from '@/db/schema';
import { getCurrentAccountId } from '@/services/auth/currentAccount';
import type { ExerciseEntry, Food, FoodEntry, Recipe, WeightLog } from '@/types';
import { listGoals } from './goals';
import {
  ensureReady,
  invalidateStore,
  rowToExerciseEntry,
  rowToFood,
  rowToFoodEntry,
  rowToWeightLog,
  type ExerciseEntryRow,
  type FoodEntryRow,
  type FoodRow,
  type WeightLogRow,
} from './mappers';
import { deleteFoodPhotoFile } from './photoFiles';
import { getProfile } from './profile';
import { listRecipes } from './recipes';
import { getSettings } from './settings';

export interface DbStats {
  foods: number;
  foodEntries: number;
  recipes: number;
  exerciseEntries: number;
  weightLogs: number;
}

/** Full JSON snapshot of every table. */
export async function exportAllData(): Promise<Record<string, unknown>> {
  const db = await ensureReady();
  const accountId = getCurrentAccountId();

  const profile = await getProfile();
  const goals = await listGoals();
  const settings = await getSettings();
  const recipes: Recipe[] = await listRecipes();

  const foodRows = accountId
    ? await db.getAllAsync<FoodRow>(
        `SELECT ${COLUMNS.foods.join(', ')} FROM foods
         WHERE account_id = ? OR (account_id IS NULL AND source = 'seed')
         ORDER BY name ASC;`,
        accountId
      )
    : await db.getAllAsync<FoodRow>(
        `SELECT ${COLUMNS.foods.join(', ')} FROM foods
         WHERE account_id IS NULL AND source = 'seed' ORDER BY name ASC;`
      );
  const entryRows = accountId
    ? await db.getAllAsync<FoodEntryRow>(
        `SELECT ${COLUMNS.food_entries.join(', ')} FROM food_entries
         WHERE account_id = ? ORDER BY date ASC, logged_at ASC;`,
        accountId
      )
    : [];
  const exerciseRows = accountId
    ? await db.getAllAsync<ExerciseEntryRow>(
        `SELECT ${COLUMNS.exercise_entries.join(', ')} FROM exercise_entries
         WHERE account_id = ? ORDER BY date ASC, logged_at ASC;`,
        accountId
      )
    : [];
  const weightRows = accountId
    ? await db.getAllAsync<WeightLogRow>(
        `SELECT ${COLUMNS.weight_logs.join(', ')} FROM weight_logs
         WHERE account_id = ? ORDER BY date ASC;`,
        accountId
      )
    : [];

  const foods: Food[] = (foodRows ?? []).map(rowToFood);
  const foodEntries: FoodEntry[] = (entryRows ?? []).map(rowToFoodEntry);
  const exerciseEntries: ExerciseEntry[] = (exerciseRows ?? []).map(rowToExerciseEntry);
  const weightLogs: WeightLog[] = (weightRows ?? []).map(rowToWeightLog);

  return {
    version: SCHEMA_VERSION,
    exportedAt: nowISO(),
    profile,
    goals,
    foods,
    foodEntries,
    recipes,
    exerciseEntries,
    weightLogs,
    settings,
  };
}

/** Deletes every user row in one transaction. The schema is left intact. */
export async function clearAllData(): Promise<void> {
  const db = await ensureReady();
  const accountId = getCurrentAccountId();
  if (!accountId) return;

  await runInTransaction(db, async () => {
    const photoRows = await db.getAllAsync<{ photo_uri: string | null }>(
      'SELECT photo_uri FROM food_entries WHERE account_id = ? AND photo_uri IS NOT NULL;',
      accountId
    );
    for (const row of photoRows ?? []) deleteFoodPhotoFile(row.photo_uri);

    await db.runAsync('DELETE FROM food_entries WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM recipe_items WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM recipes WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM exercise_entries WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM weight_logs WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM goals WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM foods WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM profile WHERE account_id = ?;', accountId);
    await db.runAsync('DELETE FROM settings WHERE account_id = ?;', accountId);
  });

  invalidateStore();
}

/** Row counts used by the settings screen. */
export async function getDbStats(): Promise<DbStats> {
  const db = await ensureReady();
  const accountId = getCurrentAccountId();
  if (!accountId) {
    const row = await db.getFirstAsync<Pick<DbStats, 'foods'>>(
      "SELECT COUNT(*) AS foods FROM foods WHERE account_id IS NULL AND source = 'seed';"
    );
    return {
      foods: row?.foods ?? 0,
      foodEntries: 0,
      recipes: 0,
      exerciseEntries: 0,
      weightLogs: 0,
    };
  }
  const row = await db.getFirstAsync<DbStats>(
    `SELECT
       (SELECT COUNT(*) FROM foods
        WHERE account_id = ? OR (account_id IS NULL AND source = 'seed')) AS foods,
       (SELECT COUNT(*) FROM food_entries WHERE account_id = ?)           AS foodEntries,
        (SELECT COUNT(*) FROM recipes WHERE account_id = ?)                AS recipes,
        (SELECT COUNT(*) FROM exercise_entries WHERE account_id = ?)       AS exerciseEntries,
        (SELECT COUNT(*) FROM weight_logs WHERE account_id = ?)            AS weightLogs;`,
    accountId,
    accountId,
    accountId,
    accountId,
    accountId
  );

  return {
    foods: row?.foods ?? 0,
    foodEntries: row?.foodEntries ?? 0,
    recipes: row?.recipes ?? 0,
    exerciseEntries: row?.exerciseEntries ?? 0,
    weightLogs: row?.weightLogs ?? 0,
  };
}
