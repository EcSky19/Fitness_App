/**
 * Food entries repository — everything the user logged on a given day.
 *
 * Entries store ABSOLUTE macros for the amount consumed, so editing the amount
 * rescales the stored macros proportionally.
 */
import { newId, nowISO, runInTransaction, todayISO } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS } from '@/db/schema';
import type { FoodEntry, ID, ISODate, MealType } from '@/types';
import {
  currentAccountScope,
  EMPTY_MACROS,
  ensureReady,
  foodEntryToRow,
  invalidateStore,
  placeholdersFor,
  rowToFoodEntry,
  requireCurrentAccountId,
  roundMacro,
  scaleMacros,
  stripUndefined,
  toBindValues,
  type BindValue,
  type FoodEntryRow,
} from './mappers';
import { deleteFoodPhotoFile, namespaceFoodPhotoUri } from './photoFiles';

const ENTRY_COLUMNS = COLUMNS.food_entries.join(', ');
const ENTRY_INSERT_COLUMNS = [...COLUMNS.food_entries, ACCOUNT_ID_COLUMN];
const ENTRY_PLACEHOLDERS = placeholdersFor(ENTRY_INSERT_COLUMNS);
const UPDATABLE_COLUMNS = COLUMNS.food_entries.filter((column) => column !== 'id');
const UPDATE_SET_CLAUSE = UPDATABLE_COLUMNS.map((column) => `${column} = ?`).join(', ');

/**
 * Input for {@link addFoodEntry}. Superset of
 * `Omit<FoodEntry, 'id' | 'createdAt' | 'updatedAt'>`: fields with an obvious
 * default (ids, brand, photo, edit flags, timestamps) may be omitted.
 */
export type NewFoodEntry = Omit<
  FoodEntry,
  'id' | 'createdAt' | 'updatedAt' | OptionalEntryField
> &
  Partial<Pick<FoodEntry, OptionalEntryField>>;

type OptionalEntryField =
  | 'foodId'
  | 'brand'
  | 'servingLabel'
  | 'photoUri'
  | 'source'
  | 'visionConfidence'
  | 'wasEdited'
  | 'loggedAt';

function entryValues(row: FoodEntryRow, accountId: ID): BindValue[] {
  return toBindValues({ ...row, [ACCOUNT_ID_COLUMN]: accountId }, ENTRY_INSERT_COLUMNS);
}

function buildEntry(input: NewFoodEntry, now: string): FoodEntry {
  const gramsTotal = input.gramsTotal ?? 0;
  return {
    ...input,
    date: input.date || todayISO(),
    foodId: input.foodId ?? null,
    brand: input.brand ?? null,
    gramsTotal,
    servingLabel: input.servingLabel || `${gramsTotal} g`,
    macros: input.macros ?? { ...EMPTY_MACROS },
    photoUri: input.photoUri ?? null,
    source: input.source ?? 'custom',
    visionConfidence: input.visionConfidence ?? null,
    wasEdited: input.wasEdited ?? false,
    loggedAt: input.loggedAt || now,
    id: newId(),
    createdAt: now,
    updatedAt: now,
  };
}

async function visibleFoodIdOrNull(
  foodId: ID | null,
  accountId: ID,
  dbArg?: Awaited<ReturnType<typeof ensureReady>>
): Promise<ID | null> {
  if (!foodId) return null;
  const db = dbArg ?? (await ensureReady());
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM foods
     WHERE id = ? AND (account_id = ? OR (account_id IS NULL AND source = 'seed'))
     LIMIT 1;`,
    foodId,
    accountId
  );
  return row ? foodId : null;
}

export async function prepareFoodEntriesForInsert(
  inputs: NewFoodEntry[],
  accountId: ID,
  now: string,
  dbArg?: Awaited<ReturnType<typeof ensureReady>>
): Promise<FoodEntry[]> {
  const db = dbArg ?? (await ensureReady());
  // Every item detected in one scan carries the same source photo. Namespacing
  // copies the file and then removes the source, so the source has to survive
  // until the last copy has been made -- otherwise every entry after the first
  // keeps a URI pointing at a file that has just been deleted.
  const consumedSources = new Set<string>();
  const entries = await Promise.all(inputs.map(async (input) => {
    const entry = buildEntry(input, now);
    entry.foodId = await visibleFoodIdOrNull(entry.foodId, accountId, db);
    const source = entry.photoUri;
    entry.photoUri = namespaceFoodPhotoUri(entry.photoUri, accountId, { keepSource: true });
    // Only when the copy actually moved the file: an unchanged URI means the
    // entry still points at the source, which must therefore be kept.
    if (source && entry.photoUri && entry.photoUri !== source) consumedSources.add(source);
    return entry;
  }));

  for (const source of consumedSources) deleteFoodPhotoFile(source);
  return entries;
}

export async function insertPreparedFoodEntries(
  db: Awaited<ReturnType<typeof ensureReady>>,
  entries: FoodEntry[],
  accountId: ID
): Promise<void> {
  for (const entry of entries) {
    await db.runAsync(
      `INSERT INTO food_entries (${ENTRY_INSERT_COLUMNS.join(', ')}) VALUES (${ENTRY_PLACEHOLDERS});`,
      ...entryValues(foodEntryToRow(entry), accountId)
    );
  }
}

/** All entries logged on `date`, in logging order. */
export async function listEntriesByDate(date: ISODate): Promise<FoodEntry[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const rows = await db.getAllAsync<FoodEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM food_entries
     WHERE account_id = ? AND date = ? ORDER BY logged_at ASC, created_at ASC;`,
    accountId,
    date
  );
  return (rows ?? []).map(rowToFoodEntry);
}

/** All entries between `start` and `end` (both inclusive), oldest first. */
export async function listEntriesByDateRange(
  start: ISODate,
  end: ISODate
): Promise<FoodEntry[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rows = await db.getAllAsync<FoodEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM food_entries
     WHERE account_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC, logged_at ASC, created_at ASC;`,
    accountId,
    from,
    to
  );
  return (rows ?? []).map(rowToFoodEntry);
}

/**
 * Distinct dates with at least one logged entry, on or after `since`,
 * descending (most recent first). Powers the logging-streak calculation —
 * a `SELECT DISTINCT` on the indexed `(account_id, date)` columns rather than
 * fetching every row in the range.
 */
export async function listLoggedDates(since: ISODate): Promise<ISODate[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const rows = await db.getAllAsync<{ date: ISODate }>(
    `SELECT DISTINCT date FROM food_entries
     WHERE account_id = ? AND date >= ? ORDER BY date DESC;`,
    accountId,
    since
  );
  return (rows ?? []).map((row) => row.date);
}

/** A single entry by id, or `null`. */
export async function getFoodEntry(id: ID): Promise<FoodEntry | null> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return null;
  const row = await db.getFirstAsync<FoodEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM food_entries WHERE id = ? AND account_id = ? LIMIT 1;`,
    id,
    accountId
  );
  return row ? rowToFoodEntry(row) : null;
}

/** Inserts one entry and returns the stored record. */
export async function addFoodEntry(input: NewFoodEntry): Promise<FoodEntry> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('addFoodEntry');
  const entry = buildEntry(input, nowISO());
  entry.foodId = await visibleFoodIdOrNull(entry.foodId, accountId);
  entry.photoUri = namespaceFoodPhotoUri(entry.photoUri, accountId);

  await db.runAsync(
    `INSERT INTO food_entries (${ENTRY_INSERT_COLUMNS.join(', ')}) VALUES (${ENTRY_PLACEHOLDERS});`,
    ...entryValues(foodEntryToRow(entry), accountId)
  );

  invalidateStore();
  return entry;
}

/** Inserts many entries in a single transaction (vision review, copy meal, ...). */
export async function addFoodEntries(inputs: NewFoodEntry[]): Promise<FoodEntry[]> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('addFoodEntries');
  if (!inputs || inputs.length === 0) return [];

  const now = nowISO();
  const entries = await prepareFoodEntriesForInsert(inputs, accountId, now, db);

  await runInTransaction(db, async () => {
    await insertPreparedFoodEntries(db, entries, accountId);
  });

  invalidateStore();
  return entries;
}

/**
 * Updates an entry.
 *
 * When the amount changes (`gramsTotal`, or `quantity`/`unit`) but no macros are
 * supplied, macros are rescaled from the existing grams -> macros ratio.
 * `wasEdited` is always set and `updatedAt` refreshed.
 */
export async function updateFoodEntry(id: ID, patch: Partial<FoodEntry>): Promise<FoodEntry> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('updateFoodEntry');
  const existing = await getFoodEntry(id);
  if (!existing) throw new Error(`updateFoodEntry: entry not found (${id})`);

  const now = nowISO();
  const clean = stripUndefined(patch);

  const nextQuantity = clean.quantity ?? existing.quantity;
  const quantityChanged = nextQuantity !== existing.quantity;
  const unitChanged = clean.unit !== undefined && clean.unit !== existing.unit;

  let gramsTotal = clean.gramsTotal ?? existing.gramsTotal;
  if (clean.gramsTotal === undefined && quantityChanged && existing.quantity > 0) {
    // Only the serving count changed — grams scale with it.
    gramsTotal = roundMacro(existing.gramsTotal * (nextQuantity / existing.quantity));
  }

  let macros = clean.macros ?? existing.macros;
  const amountChanged = gramsTotal !== existing.gramsTotal || quantityChanged || unitChanged;
  if (clean.macros === undefined && amountChanged) {
    if (existing.gramsTotal > 0 && gramsTotal !== existing.gramsTotal) {
      macros = scaleMacros(existing.macros, gramsTotal / existing.gramsTotal);
    }
    // gramsTotal === 0 (or unchanged): no ratio available, keep macros as-is.
  }

  const next: FoodEntry = {
    ...existing,
    ...clean,
    id: existing.id,
    gramsTotal,
    macros,
    wasEdited: true,
    createdAt: existing.createdAt,
    updatedAt: now,
  };

  if (clean.foodId !== undefined) {
    next.foodId = await visibleFoodIdOrNull(next.foodId, accountId);
  }
  next.photoUri = namespaceFoodPhotoUri(next.photoUri, accountId);

  const row = foodEntryToRow(next);
  await db.runAsync(
    `UPDATE food_entries SET ${UPDATE_SET_CLAUSE} WHERE id = ? AND account_id = ?;`,
    ...toBindValues(row, UPDATABLE_COLUMNS),
    next.id,
    accountId
  );

  invalidateStore();
  return next;
}

/** Removes an entry. */
export async function deleteFoodEntry(id: ID): Promise<void> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return;
  const row = await db.getFirstAsync<{ photo_uri: string | null }>(
    'SELECT photo_uri FROM food_entries WHERE id = ? AND account_id = ? LIMIT 1;',
    id,
    accountId
  );
  await db.runAsync('DELETE FROM food_entries WHERE id = ? AND account_id = ?;', id, accountId);
  // Only after the row is gone. The file system is not transactional, so
  // deleting the photo first would leave the entry pointing at a missing image
  // if the DELETE failed (locked database, full disk).
  await deleteUnreferencedPhoto(db, row?.photo_uri);
  invalidateStore();
}

/**
 * Removes a photo file only once no entry still points at it. Repeating a meal
 * reuses the original photo URI rather than duplicating the file, so several
 * entries can share one image and deleting any single one of them must leave
 * the others intact.
 */
async function deleteUnreferencedPhoto(
  db: Awaited<ReturnType<typeof ensureReady>>,
  photoUri: string | null | undefined
): Promise<void> {
  if (!photoUri) return;
  const stillUsed = await db.getFirstAsync<{ id: ID }>(
    'SELECT id FROM food_entries WHERE photo_uri = ? LIMIT 1;',
    photoUri
  );
  if (stillUsed) return;
  deleteFoodPhotoFile(photoUri);
}

export async function repeatEntries(input: {
  entryIds: ID[];
  date: ISODate;
  mealType?: MealType;
}): Promise<FoodEntry[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const ids = Array.isArray(input.entryIds) ? input.entryIds.filter(Boolean) : [];
  if (ids.length === 0) return [];

  let created: FoodEntry[] = [];
  await runInTransaction(db, async () => {
    const copies: NewFoodEntry[] = [];
    for (const id of ids) {
      const row = await db.getFirstAsync<FoodEntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM food_entries WHERE id = ? AND account_id = ? LIMIT 1;`,
        id,
        accountId
      );
      if (!row) continue;
      const entry = rowToFoodEntry(row);
      copies.push({
        date: input.date,
        mealType: input.mealType ?? entry.mealType,
        foodId: entry.foodId,
        name: entry.name,
        brand: entry.brand,
        quantity: entry.quantity,
        unit: entry.unit,
        servingLabel: entry.servingLabel,
        gramsTotal: entry.gramsTotal,
        macros: entry.macros,
        photoUri: entry.photoUri,
        source: entry.source,
        visionConfidence: entry.visionConfidence,
        wasEdited: entry.wasEdited,
      });
    }
    created = await prepareFoodEntriesForInsert(copies, accountId, nowISO(), db);
    await insertPreparedFoodEntries(db, created, accountId);
  });

  if (created.length > 0) invalidateStore();
  return created;
}
