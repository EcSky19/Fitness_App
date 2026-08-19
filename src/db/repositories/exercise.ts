/**
 * Exercise entries repository — manual workouts plus entries synced from
 * HealthKit / Health Connect (deduplicated on `external_id`).
 */
import { newId, nowISO, runInTransaction, todayISO } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS } from '@/db/schema';
import type { ExerciseEntry, ID, ISODate } from '@/types';
import {
  currentAccountScope,
  ensureReady,
  exerciseEntryToRow,
  invalidateStore,
  requireCurrentAccountId,
  rowToExerciseEntry,
  stripUndefined,
  toBindValues,
  type BindValue,
  type ExerciseEntryRow,
} from './mappers';

const EXERCISE_COLUMNS = COLUMNS.exercise_entries.join(', ');
const EXERCISE_INSERT_COLUMNS = [...COLUMNS.exercise_entries, ACCOUNT_ID_COLUMN];
const EXERCISE_INSERT_PLACEHOLDERS = EXERCISE_INSERT_COLUMNS.map(() => '?').join(', ');
const UPDATABLE_COLUMNS = COLUMNS.exercise_entries.filter((column) => column !== 'id');
const UPDATE_SET_CLAUSE = UPDATABLE_COLUMNS.map((column) => `${column} = ?`).join(', ');

/**
 * Input for {@link addExerciseEntry}. Superset of
 * `Omit<ExerciseEntry, 'id' | 'createdAt' | 'updatedAt'>`: `source`,
 * `externalId`, `notes` and `loggedAt` may be omitted.
 */
export type NewExerciseEntry = Omit<
  ExerciseEntry,
  'id' | 'createdAt' | 'updatedAt' | 'source' | 'externalId' | 'notes' | 'loggedAt'
> &
  Partial<Pick<ExerciseEntry, 'source' | 'externalId' | 'notes' | 'loggedAt'>>;

function exerciseValues(row: ExerciseEntryRow): BindValue[] {
  return toBindValues(row, COLUMNS.exercise_entries);
}

/** Blank ids must become NULL — `external_id` carries a unique partial index. */
function normalizeExternalId(externalId: string | null | undefined): string | null {
  const trimmed = externalId?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function buildEntry(input: NewExerciseEntry, now: string, id?: ID, createdAt?: string): ExerciseEntry {
  return {
    ...input,
    date: input.date || todayISO(),
    source: input.source ?? 'manual',
    externalId: normalizeExternalId(input.externalId),
    notes: input.notes ?? null,
    loggedAt: input.loggedAt || now,
    id: id ?? newId(),
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

async function insertEntry(entry: ExerciseEntry): Promise<ExerciseEntry> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('addExerciseEntry');
  await db.runAsync(
    `INSERT INTO exercise_entries (${EXERCISE_INSERT_COLUMNS.join(', ')}) VALUES (${EXERCISE_INSERT_PLACEHOLDERS});`,
    ...toBindValues({ ...exerciseEntryToRow(entry), [ACCOUNT_ID_COLUMN]: accountId }, EXERCISE_INSERT_COLUMNS)
  );
  return entry;
}

/** All exercise logged on `date`. */
export async function listExercisesByDate(date: ISODate): Promise<ExerciseEntry[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const rows = await db.getAllAsync<ExerciseEntryRow>(
    `SELECT ${EXERCISE_COLUMNS} FROM exercise_entries
     WHERE account_id = ? AND date = ? ORDER BY logged_at ASC, created_at ASC;`,
    accountId,
    date
  );
  return (rows ?? []).map(rowToExerciseEntry);
}

/** All exercise between `start` and `end` (both inclusive), oldest first. */
export async function listExercisesByDateRange(
  start: ISODate,
  end: ISODate
): Promise<ExerciseEntry[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rows = await db.getAllAsync<ExerciseEntryRow>(
    `SELECT ${EXERCISE_COLUMNS} FROM exercise_entries
     WHERE account_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC, logged_at ASC, created_at ASC;`,
    accountId,
    from,
    to
  );
  return (rows ?? []).map(rowToExerciseEntry);
}

/** A single exercise entry by id, or `null`. */
export async function getExerciseEntry(id: ID): Promise<ExerciseEntry | null> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return null;
  const row = await db.getFirstAsync<ExerciseEntryRow>(
    `SELECT ${EXERCISE_COLUMNS} FROM exercise_entries WHERE id = ? AND account_id = ? LIMIT 1;`,
    id,
    accountId
  );
  return row ? rowToExerciseEntry(row) : null;
}

/** Inserts one exercise entry. */
export async function addExerciseEntry(input: NewExerciseEntry): Promise<ExerciseEntry> {
  const entry = await insertEntry(buildEntry(input, nowISO()));
  invalidateStore();
  return entry;
}

/** Updates an exercise entry; throws when the id is unknown. */
export async function updateExerciseEntry(
  id: ID,
  patch: Partial<ExerciseEntry>
): Promise<ExerciseEntry> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('updateExerciseEntry');
  const existing = await getExerciseEntry(id);
  if (!existing) throw new Error(`updateExerciseEntry: entry not found (${id})`);

  const next: ExerciseEntry = {
    ...existing,
    ...stripUndefined(patch),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowISO(),
  };

  const row = exerciseEntryToRow(next);
  await db.runAsync(
    `UPDATE exercise_entries SET ${UPDATE_SET_CLAUSE} WHERE id = ? AND account_id = ?;`,
    ...toBindValues(row, UPDATABLE_COLUMNS),
    next.id,
    accountId
  );

  invalidateStore();
  return next;
}

/** Removes an exercise entry. */
export async function deleteExerciseEntry(id: ID): Promise<void> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return;
  await db.runAsync('DELETE FROM exercise_entries WHERE id = ? AND account_id = ?;', id, accountId);
  invalidateStore();
}

/**
 * Inserts a health-platform workout, or refreshes the existing row with the
 * same `externalId` (so repeated syncs never duplicate entries).
 *
 * The lookup and the write share one serialized transaction: two syncs racing
 * on the same workout used to both miss the existing row and then collide on
 * the `external_id` unique index.
 */
export async function upsertExternalExercise(
  input: NewExerciseEntry
): Promise<ExerciseEntry> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('upsertExternalExercise');
  const externalId = normalizeExternalId(input.externalId);
  if (!externalId) return addExerciseEntry({ ...input, externalId: null });

  const entry = await runInTransaction(db, async () => {
    const existing = await db.getFirstAsync<{ id: string; created_at: string }>(
      'SELECT id, created_at FROM exercise_entries WHERE external_id = ? AND account_id = ? LIMIT 1;',
      externalId,
      accountId
    );

    const next = buildEntry(
      { ...input, externalId },
      nowISO(),
      existing?.id,
      existing?.created_at
    );

    // Any other row still holding this external id would break the unique index.
    await db.runAsync(
      'DELETE FROM exercise_entries WHERE external_id = ? AND account_id = ? AND id <> ?;',
      externalId,
      accountId,
      next.id
    );
    await db.runAsync(
      `INSERT INTO exercise_entries (${EXERCISE_INSERT_COLUMNS.join(', ')}) VALUES (${EXERCISE_INSERT_PLACEHOLDERS})
       ON CONFLICT(id) DO UPDATE SET ${UPDATABLE_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}
       WHERE exercise_entries.account_id = excluded.account_id;`,
      ...toBindValues({ ...exerciseEntryToRow(next), [ACCOUNT_ID_COLUMN]: accountId }, EXERCISE_INSERT_COLUMNS)
    );
    return next;
  });

  invalidateStore();
  return entry;
}
