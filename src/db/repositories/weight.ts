/**
 * Weight logs repository. At most one log per calendar date — logging the same
 * date again updates the existing row instead of creating a duplicate.
 */
import { newId, nowISO, runInTransaction, todayISO } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS } from '@/db/schema';
import type { ID, ISODate, WeightLog } from '@/types';
import {
  currentAccountScope,
  ensureReady,
  invalidateStore,
  requireCurrentAccountId,
  rowToWeightLog,
  stripUndefined,
  toBindValues,
  weightLogToRow,
  type BindValue,
  type WeightLogRow,
} from './mappers';

const WEIGHT_COLUMNS = COLUMNS.weight_logs.join(', ');
const WEIGHT_INSERT_COLUMNS = [...COLUMNS.weight_logs, ACCOUNT_ID_COLUMN];
const WEIGHT_INSERT_PLACEHOLDERS = WEIGHT_INSERT_COLUMNS.map(() => '?').join(', ');
const WEIGHT_UPDATE_ASSIGNMENTS = COLUMNS.weight_logs
  .filter((column) => column !== 'id')
  .map((column) => `${column} = excluded.${column}`)
  .join(', ');
const UPDATABLE_COLUMNS = COLUMNS.weight_logs.filter((column) => column !== 'id');
const UPDATE_SET_CLAUSE = UPDATABLE_COLUMNS.map((column) => `${column} = ?`).join(', ');

const DEFAULT_LIMIT = 100;

/**
 * Input for {@link addWeightLog}. Superset of
 * `Omit<WeightLog, 'id' | 'createdAt' | 'updatedAt'>`: `bodyFatPct`, `note` and
 * `source` may be omitted.
 */
export type NewWeightLog = Omit<
  WeightLog,
  'id' | 'createdAt' | 'updatedAt' | 'bodyFatPct' | 'note' | 'source'
> &
  Partial<Pick<WeightLog, 'bodyFatPct' | 'note' | 'source'>>;

function weightValues(row: WeightLogRow): BindValue[] {
  return toBindValues(row, COLUMNS.weight_logs);
}

/**
 * Enforces the one-log-per-date invariant: `weight_logs.date` carries no unique
 * index, so any stale row for the date is removed as part of the same
 * transaction as the write that claims it.
 */
async function removeOtherLogsOnDate(
  db: Awaited<ReturnType<typeof ensureReady>>,
  date: ISODate,
  keepId: ID,
  accountId: ID
): Promise<void> {
  await db.runAsync(
    'DELETE FROM weight_logs WHERE account_id = ? AND date = ? AND id <> ?;',
    accountId,
    date,
    keepId
  );
}

/** Weight logs, newest first. */
export async function listWeightLogs(limit?: number): Promise<WeightLog[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const max =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.trunc(limit)
      : DEFAULT_LIMIT;
  const rows = await db.getAllAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs
     WHERE account_id = ?
     ORDER BY date DESC, created_at DESC LIMIT ?;`,
    accountId,
    max
  );
  return (rows ?? []).map(rowToWeightLog);
}

/** Weight logs in `[start, end]`, OLDEST first (chart order). */
export async function listWeightLogsByRange(
  start: ISODate,
  end: ISODate
): Promise<WeightLog[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rows = await db.getAllAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs
     WHERE account_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC, created_at ASC;`,
    accountId,
    from,
    to
  );
  return (rows ?? []).map(rowToWeightLog);
}

/** The log for a specific date, or `null`. */
export async function getWeightLogByDate(date: ISODate): Promise<WeightLog | null> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return null;
  const row = await db.getFirstAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs WHERE account_id = ? AND date = ?
     ORDER BY created_at DESC LIMIT 1;`,
    accountId,
    date
  );
  return row ? rowToWeightLog(row) : null;
}

/** A single log by id, or `null`. */
export async function getWeightLog(id: ID): Promise<WeightLog | null> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return null;
  const row = await db.getFirstAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs WHERE id = ? AND account_id = ? LIMIT 1;`,
    id,
    accountId
  );
  return row ? rowToWeightLog(row) : null;
}

/** The most recent weight log, or `null`. */
export async function getLatestWeight(): Promise<WeightLog | null> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return null;
  const row = await db.getFirstAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs
     WHERE account_id = ?
     ORDER BY date DESC, created_at DESC LIMIT 1;`,
    accountId
  );
  return row ? rowToWeightLog(row) : null;
}

/**
 * Adds a log, replacing any existing log for the same date.
 *
 * The read and the write share one serialized transaction, so two saves fired
 * at once (a double-tapped Save button) still leave exactly one row for the
 * date instead of two competing ones.
 */
export async function addWeightLog(input: NewWeightLog): Promise<WeightLog> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('addWeightLog');
  const now = nowISO();
  const date = input.date || todayISO();

  const next = await runInTransaction(db, async () => {
    const existingRow = await db.getFirstAsync<WeightLogRow>(
      `SELECT ${WEIGHT_COLUMNS} FROM weight_logs WHERE account_id = ? AND date = ?
       ORDER BY created_at DESC LIMIT 1;`,
      accountId,
      date
    );
    const existing = existingRow ? rowToWeightLog(existingRow) : null;

    const log: WeightLog = {
      ...input,
      date,
      bodyFatPct: input.bodyFatPct ?? null,
      note: input.note ?? null,
      source: input.source ?? 'manual',
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await removeOtherLogsOnDate(db, date, log.id, accountId);
    await db.runAsync(
      `INSERT INTO weight_logs (${WEIGHT_INSERT_COLUMNS.join(', ')}) VALUES (${WEIGHT_INSERT_PLACEHOLDERS})
       ON CONFLICT(id) DO UPDATE SET ${WEIGHT_UPDATE_ASSIGNMENTS}
       WHERE weight_logs.account_id = excluded.account_id;`,
      ...toBindValues({ ...weightLogToRow(log), [ACCOUNT_ID_COLUMN]: accountId }, WEIGHT_INSERT_COLUMNS)
    );
    return log;
  });

  invalidateStore();
  return next;
}

/**
 * Updates a log; throws when the id is unknown.
 *
 * Moving a log onto a date that already has one replaces that log, keeping the
 * "at most one log per calendar date" invariant the whole repository relies on.
 */
export async function updateWeightLog(id: ID, patch: Partial<WeightLog>): Promise<WeightLog> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('updateWeightLog');
  const existing = await getWeightLog(id);
  if (!existing) throw new Error(`updateWeightLog: log not found (${id})`);

  const next: WeightLog = {
    ...existing,
    ...stripUndefined(patch),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowISO(),
  };

  const row = weightLogToRow(next);
  await runInTransaction(db, async () => {
    await removeOtherLogsOnDate(db, next.date, next.id, accountId);
    await db.runAsync(
      `UPDATE weight_logs SET ${UPDATE_SET_CLAUSE} WHERE id = ? AND account_id = ?;`,
      ...toBindValues(row, UPDATABLE_COLUMNS),
      next.id,
      accountId
    );
  });

  invalidateStore();
  return next;
}

/** Removes a log. */
export async function deleteWeightLog(id: ID): Promise<void> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return;
  await db.runAsync('DELETE FROM weight_logs WHERE id = ? AND account_id = ?;', id, accountId);
  invalidateStore();
}
