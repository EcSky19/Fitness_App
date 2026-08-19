/**
 * Admin repository — backup / restore-adjacent helpers used by the settings
 * screen (export, wipe, database statistics).
 */
import { nowISO } from '@/db/client';
import { COLUMNS, SCHEMA_VERSION } from '@/db/schema';
import type { ExerciseEntry, Food, FoodEntry, WeightLog } from '@/types';
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
import { getProfile } from './profile';
import { getSettings } from './settings';

/** Tables wiped by {@link clearAllData} (children first, `_migrations` kept). */
const USER_TABLES = [
  'food_entries',
  'exercise_entries',
  'weight_logs',
  'goals',
  'foods',
  'profile',
  'settings',
];

export interface DbStats {
  foods: number;
  foodEntries: number;
  exerciseEntries: number;
  weightLogs: number;
}

/** Full JSON snapshot of every table. */
export async function exportAllData(): Promise<Record<string, unknown>> {
  const db = await ensureReady();

  const profile = await getProfile();
  const goals = await listGoals();
  const settings = await getSettings();

  const foodRows = await db.getAllAsync<FoodRow>(
    `SELECT ${COLUMNS.foods.join(', ')} FROM foods ORDER BY name ASC;`
  );
  const entryRows = await db.getAllAsync<FoodEntryRow>(
    `SELECT ${COLUMNS.food_entries.join(', ')} FROM food_entries
     ORDER BY date ASC, logged_at ASC;`
  );
  const exerciseRows = await db.getAllAsync<ExerciseEntryRow>(
    `SELECT ${COLUMNS.exercise_entries.join(', ')} FROM exercise_entries
     ORDER BY date ASC, logged_at ASC;`
  );
  const weightRows = await db.getAllAsync<WeightLogRow>(
    `SELECT ${COLUMNS.weight_logs.join(', ')} FROM weight_logs ORDER BY date ASC;`
  );

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
    exerciseEntries,
    weightLogs,
    settings,
  };
}

/** Deletes every user row in one transaction. The schema is left intact. */
export async function clearAllData(): Promise<void> {
  const db = await ensureReady();

  await db.withTransactionAsync(async () => {
    for (const table of USER_TABLES) {
      await db.runAsync(`DELETE FROM ${table};`);
    }
  });

  invalidateStore();
}

/** Row counts used by the settings screen. */
export async function getDbStats(): Promise<DbStats> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<DbStats>(
    `SELECT
       (SELECT COUNT(*) FROM foods)             AS foods,
       (SELECT COUNT(*) FROM food_entries)      AS foodEntries,
       (SELECT COUNT(*) FROM exercise_entries)  AS exerciseEntries,
       (SELECT COUNT(*) FROM weight_logs)       AS weightLogs;`
  );

  return {
    foods: row?.foods ?? 0,
    foodEntries: row?.foodEntries ?? 0,
    exerciseEntries: row?.exerciseEntries ?? 0,
    weightLogs: row?.weightLogs ?? 0,
  };
}
