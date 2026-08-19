/**
 * Goals repository. Exactly one goal is active at a time; activation is
 * performed inside a transaction so the invariant can never be observed broken.
 */
import { newId, nowISO, todayISO } from '@/db/client';
import type { Goal, ID } from '@/types';
import {
  ensureReady,
  goalToRow,
  invalidateStore,
  rowToGoal,
  stripUndefined,
  type GoalRow,
} from './mappers';

const GOAL_COLUMNS =
  'id, type, rate_kg_per_week, macro_split, target_calories, target_protein, target_carbs, ' +
  'target_fat, is_manual_override, started_at, is_active, created_at, updated_at';

function defaultGoal(now: string): Goal {
  return {
    id: newId(),
    type: 'maintain',
    rateKgPerWeek: 0,
    macroSplit: 'balanced',
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 67 },
    isManualOverride: false,
    startedAt: todayISO(),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** The currently active goal, or `null` when none has been created. */
export async function getActiveGoal(): Promise<Goal | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<GoalRow>(
    `SELECT ${GOAL_COLUMNS} FROM goals WHERE is_active = 1
     ORDER BY started_at DESC, created_at DESC LIMIT 1;`
  );
  return row ? rowToGoal(row) : null;
}

/** A single goal by id, or `null` when it does not exist. */
export async function getGoal(id: ID): Promise<Goal | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<GoalRow>(
    `SELECT ${GOAL_COLUMNS} FROM goals WHERE id = ? LIMIT 1;`,
    id
  );
  return row ? rowToGoal(row) : null;
}

/** Every goal, newest first. */
export async function listGoals(): Promise<Goal[]> {
  const db = await ensureReady();
  const rows = await db.getAllAsync<GoalRow>(
    `SELECT ${GOAL_COLUMNS} FROM goals ORDER BY started_at DESC, created_at DESC;`
  );
  return (rows ?? []).map(rowToGoal);
}

/**
 * Creates or updates a goal. When the resulting goal is active every other goal
 * is deactivated in the same transaction.
 */
export async function saveGoal(patch: Partial<Goal>): Promise<Goal> {
  const db = await ensureReady();
  const now = nowISO();
  const existing = patch.id ? await getGoal(patch.id) : null;
  const base = existing ?? defaultGoal(now);

  const next: Goal = {
    ...base,
    ...stripUndefined(patch),
    targets: { ...base.targets, ...stripUndefined(patch.targets ?? {}) },
    id: existing?.id ?? patch.id ?? base.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const row = goalToRow(next);
  await db.withTransactionAsync(async () => {
    if (next.isActive) {
      await db.runAsync('UPDATE goals SET is_active = 0, updated_at = ? WHERE id <> ?;', now, row.id);
    }
    await db.runAsync(
      `INSERT OR REPLACE INTO goals (${GOAL_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      row.id,
      row.type,
      row.rate_kg_per_week,
      row.macro_split,
      row.target_calories,
      row.target_protein,
      row.target_carbs,
      row.target_fat,
      row.is_manual_override,
      row.started_at,
      row.is_active,
      row.created_at,
      row.updated_at
    );
  });

  invalidateStore();
  return next;
}
