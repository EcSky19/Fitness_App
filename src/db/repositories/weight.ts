/**
 * Weight logs repository. At most one log per calendar date — logging the same
 * date again updates the existing row instead of creating a duplicate.
 */
import { newId, nowISO, todayISO } from '@/db/client';
import { COLUMNS } from '@/db/schema';
import type { ID, ISODate, WeightLog } from '@/types';
import {
  ensureReady,
  invalidateStore,
  placeholdersFor,
  rowToWeightLog,
  stripUndefined,
  toBindValues,
  weightLogToRow,
  type BindValue,
  type WeightLogRow,
} from './mappers';

const WEIGHT_COLUMNS = COLUMNS.weight_logs.join(', ');
const WEIGHT_PLACEHOLDERS = placeholdersFor(COLUMNS.weight_logs);
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

/** Weight logs, newest first. */
export async function listWeightLogs(limit?: number): Promise<WeightLog[]> {
  const db = await ensureReady();
  const max =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.trunc(limit)
      : DEFAULT_LIMIT;
  const rows = await db.getAllAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs
     ORDER BY date DESC, created_at DESC LIMIT ?;`,
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
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rows = await db.getAllAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC, created_at ASC;`,
    from,
    to
  );
  return (rows ?? []).map(rowToWeightLog);
}

/** The log for a specific date, or `null`. */
export async function getWeightLogByDate(date: ISODate): Promise<WeightLog | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs WHERE date = ?
     ORDER BY created_at DESC LIMIT 1;`,
    date
  );
  return row ? rowToWeightLog(row) : null;
}

/** A single log by id, or `null`. */
export async function getWeightLog(id: ID): Promise<WeightLog | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs WHERE id = ? LIMIT 1;`,
    id
  );
  return row ? rowToWeightLog(row) : null;
}

/** The most recent weight log, or `null`. */
export async function getLatestWeight(): Promise<WeightLog | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<WeightLogRow>(
    `SELECT ${WEIGHT_COLUMNS} FROM weight_logs
     ORDER BY date DESC, created_at DESC LIMIT 1;`
  );
  return row ? rowToWeightLog(row) : null;
}

/** Adds a log, replacing any existing log for the same date. */
export async function addWeightLog(input: NewWeightLog): Promise<WeightLog> {
  const db = await ensureReady();
  const now = nowISO();
  const date = input.date || todayISO();
  const existing = await getWeightLogByDate(date);

  const next: WeightLog = {
    ...input,
    date,
    bodyFatPct: input.bodyFatPct ?? null,
    note: input.note ?? null,
    source: input.source ?? 'manual',
    id: existing?.id ?? newId(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db.runAsync(
    `INSERT OR REPLACE INTO weight_logs (${WEIGHT_COLUMNS}) VALUES (${WEIGHT_PLACEHOLDERS});`,
    ...weightValues(weightLogToRow(next))
  );

  invalidateStore();
  return next;
}

/** Updates a log; throws when the id is unknown. */
export async function updateWeightLog(id: ID, patch: Partial<WeightLog>): Promise<WeightLog> {
  const db = await ensureReady();
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
  await db.runAsync(
    `UPDATE weight_logs SET ${UPDATE_SET_CLAUSE} WHERE id = ?;`,
    ...toBindValues(row, UPDATABLE_COLUMNS),
    next.id
  );

  invalidateStore();
  return next;
}

/** Removes a log. */
export async function deleteWeightLog(id: ID): Promise<void> {
  const db = await ensureReady();
  await db.runAsync('DELETE FROM weight_logs WHERE id = ?;', id);
  invalidateStore();
}
