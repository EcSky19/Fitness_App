/**
 * Food entries repository — everything the user logged on a given day.
 *
 * Entries store ABSOLUTE macros for the amount consumed, so editing the amount
 * rescales the stored macros proportionally.
 */
import { newId, nowISO, todayISO } from '@/db/client';
import { COLUMNS } from '@/db/schema';
import type { FoodEntry, ID, ISODate } from '@/types';
import {
  EMPTY_MACROS,
  ensureReady,
  foodEntryToRow,
  invalidateStore,
  placeholdersFor,
  rowToFoodEntry,
  roundMacro,
  scaleMacros,
  stripUndefined,
  toBindValues,
  type BindValue,
  type FoodEntryRow,
} from './mappers';

const ENTRY_COLUMNS = COLUMNS.food_entries.join(', ');
const ENTRY_PLACEHOLDERS = placeholdersFor(COLUMNS.food_entries);
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

function entryValues(row: FoodEntryRow): BindValue[] {
  return toBindValues(row, COLUMNS.food_entries);
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
    macros: input.macros ?? EMPTY_MACROS,
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

/** All entries logged on `date`, in logging order. */
export async function listEntriesByDate(date: ISODate): Promise<FoodEntry[]> {
  const db = await ensureReady();
  const rows = await db.getAllAsync<FoodEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM food_entries
     WHERE date = ? ORDER BY logged_at ASC, created_at ASC;`,
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
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rows = await db.getAllAsync<FoodEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM food_entries
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC, logged_at ASC, created_at ASC;`,
    from,
    to
  );
  return (rows ?? []).map(rowToFoodEntry);
}

/** A single entry by id, or `null`. */
export async function getFoodEntry(id: ID): Promise<FoodEntry | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<FoodEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM food_entries WHERE id = ? LIMIT 1;`,
    id
  );
  return row ? rowToFoodEntry(row) : null;
}

/** Inserts one entry and returns the stored record. */
export async function addFoodEntry(input: NewFoodEntry): Promise<FoodEntry> {
  const db = await ensureReady();
  const entry = buildEntry(input, nowISO());

  await db.runAsync(
    `INSERT INTO food_entries (${ENTRY_COLUMNS}) VALUES (${ENTRY_PLACEHOLDERS});`,
    ...entryValues(foodEntryToRow(entry))
  );

  invalidateStore();
  return entry;
}

/** Inserts many entries in a single transaction (vision review, copy meal, ...). */
export async function addFoodEntries(inputs: NewFoodEntry[]): Promise<FoodEntry[]> {
  const db = await ensureReady();
  if (!inputs || inputs.length === 0) return [];

  const now = nowISO();
  const entries = inputs.map((input) => buildEntry(input, now));

  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      await db.runAsync(
        `INSERT INTO food_entries (${ENTRY_COLUMNS}) VALUES (${ENTRY_PLACEHOLDERS});`,
        ...entryValues(foodEntryToRow(entry))
      );
    }
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

  const row = foodEntryToRow(next);
  await db.runAsync(
    `UPDATE food_entries SET ${UPDATE_SET_CLAUSE} WHERE id = ?;`,
    ...toBindValues(row, UPDATABLE_COLUMNS),
    next.id
  );

  invalidateStore();
  return next;
}

/** Removes an entry. */
export async function deleteFoodEntry(id: ID): Promise<void> {
  const db = await ensureReady();
  await db.runAsync('DELETE FROM food_entries WHERE id = ?;', id);
  invalidateStore();
}
