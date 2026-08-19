/**
 * Exercise entries repository — manual workouts plus entries synced from
 * HealthKit / Health Connect (deduplicated on `external_id`).
 */
import { newId, nowISO, todayISO } from '@/db/client';
import { COLUMNS } from '@/db/schema';
import type { ExerciseEntry, ID, ISODate } from '@/types';
import {
  ensureReady,
  exerciseEntryToRow,
  invalidateStore,
  placeholdersFor,
  rowToExerciseEntry,
  stripUndefined,
  toBindValues,
  type BindValue,
  type ExerciseEntryRow,
} from './mappers';

const EXERCISE_COLUMNS = COLUMNS.exercise_entries.join(', ');
const EXERCISE_PLACEHOLDERS = placeholdersFor(COLUMNS.exercise_entries);
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
  await db.runAsync(
    `INSERT OR REPLACE INTO exercise_entries (${EXERCISE_COLUMNS})
     VALUES (${EXERCISE_PLACEHOLDERS});`,
    ...exerciseValues(exerciseEntryToRow(entry))
  );
  return entry;
}

/** All exercise logged on `date`. */
export async function listExercisesByDate(date: ISODate): Promise<ExerciseEntry[]> {
  const db = await ensureReady();
  const rows = await db.getAllAsync<ExerciseEntryRow>(
    `SELECT ${EXERCISE_COLUMNS} FROM exercise_entries
     WHERE date = ? ORDER BY logged_at ASC, created_at ASC;`,
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
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rows = await db.getAllAsync<ExerciseEntryRow>(
    `SELECT ${EXERCISE_COLUMNS} FROM exercise_entries
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC, logged_at ASC, created_at ASC;`,
    from,
    to
  );
  return (rows ?? []).map(rowToExerciseEntry);
}

/** A single exercise entry by id, or `null`. */
export async function getExerciseEntry(id: ID): Promise<ExerciseEntry | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<ExerciseEntryRow>(
    `SELECT ${EXERCISE_COLUMNS} FROM exercise_entries WHERE id = ? LIMIT 1;`,
    id
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
    `UPDATE exercise_entries SET ${UPDATE_SET_CLAUSE} WHERE id = ?;`,
    ...toBindValues(row, UPDATABLE_COLUMNS),
    next.id
  );

  invalidateStore();
  return next;
}

/** Removes an exercise entry. */
export async function deleteExerciseEntry(id: ID): Promise<void> {
  const db = await ensureReady();
  await db.runAsync('DELETE FROM exercise_entries WHERE id = ?;', id);
  invalidateStore();
}

/**
 * Inserts a health-platform workout, or refreshes the existing row with the
 * same `externalId` (so repeated syncs never duplicate entries).
 */
export async function upsertExternalExercise(
  input: NewExerciseEntry
): Promise<ExerciseEntry> {
  const db = await ensureReady();
  const externalId = normalizeExternalId(input.externalId);
  if (!externalId) return addExerciseEntry({ ...input, externalId: null });

  const existing = await db.getFirstAsync<{ id: string; created_at: string }>(
    'SELECT id, created_at FROM exercise_entries WHERE external_id = ? LIMIT 1;',
    externalId
  );

  const entry = buildEntry(
    { ...input, externalId },
    nowISO(),
    existing?.id,
    existing?.created_at
  );

  await insertEntry(entry);
  invalidateStore();
  return entry;
}
