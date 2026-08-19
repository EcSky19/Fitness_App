/**
 * Goals repository. Exactly one goal is active at a time; activation is
 * performed inside a transaction so the invariant can never be observed broken.
 */
import { newId, nowISO, runInTransaction, todayISO } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS } from '@/db/schema';
import type { Goal, ID } from '@/types';
import {
  currentAccountScope,
  ensureReady,
  goalToRow,
  invalidateStore,
  requireCurrentAccountId,
  rowToGoal,
  stripUndefined,
  toBindValues,
  type GoalRow,
} from './mappers';

const GOAL_COLUMNS = COLUMNS.goals.join(', ');
const GOAL_INSERT_COLUMNS = [...COLUMNS.goals, ACCOUNT_ID_COLUMN];

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
  const accountId = currentAccountScope();
  if (!accountId) return null;
  const row = await db.getFirstAsync<GoalRow>(
    `SELECT ${GOAL_COLUMNS} FROM goals WHERE account_id = ? AND is_active = 1
     ORDER BY started_at DESC, created_at DESC LIMIT 1;`,
    accountId
  );
  return row ? rowToGoal(row) : null;
}

/** A single goal by id, or `null` when it does not exist. */
export async function getGoal(id: ID): Promise<Goal | null> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return null;
  const row = await db.getFirstAsync<GoalRow>(
    `SELECT ${GOAL_COLUMNS} FROM goals WHERE id = ? AND account_id = ? LIMIT 1;`,
    id,
    accountId
  );
  return row ? rowToGoal(row) : null;
}

/** Every goal, newest first. */
export async function listGoals(): Promise<Goal[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const rows = await db.getAllAsync<GoalRow>(
    `SELECT ${GOAL_COLUMNS} FROM goals WHERE account_id = ? ORDER BY started_at DESC, created_at DESC;`,
    accountId
  );
  return (rows ?? []).map(rowToGoal);
}

/**
 * Creates or updates a goal. When the resulting goal is active every other goal
 * is deactivated in the same transaction.
 */
export async function saveGoal(patch: Partial<Goal>): Promise<Goal> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('saveGoal');
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
  await runInTransaction(db, async () => {
    if (next.isActive) {
      await db.runAsync(
        'UPDATE goals SET is_active = 0, updated_at = ? WHERE account_id = ? AND id <> ?;',
        now,
        accountId,
        row.id
      );
    }
    const result = await db.runAsync(
      `INSERT INTO goals (${GOAL_INSERT_COLUMNS.join(', ')}) VALUES (${GOAL_INSERT_COLUMNS.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${COLUMNS.goals
         .filter((column) => column !== 'id')
         .map((column) => `${column} = excluded.${column}`)
         .join(', ')}
       WHERE goals.account_id = excluded.account_id;`,
      ...toBindValues({ ...row, [ACCOUNT_ID_COLUMN]: accountId }, GOAL_INSERT_COLUMNS)
    );
    if ((result?.changes ?? 0) === 0) throw new Error(`saveGoal: goal not found (${row.id})`);
  });

  invalidateStore();
  return next;
}
