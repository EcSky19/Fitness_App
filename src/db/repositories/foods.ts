/**
 * Foods repository — the searchable food database (seed catalogue + user
 * created / scanned foods).
 */
import { newId, nowISO } from '@/db/client';
import { COLUMNS } from '@/db/schema';
import type { Food, ID, Macros } from '@/types';
import {
  ensureReady,
  escapeLikePattern,
  foodToRow,
  invalidateStore,
  placeholdersFor,
  rowToFood,
  stripUndefined,
  toBindValues,
  type FoodRow,
} from './mappers';

const FOOD_COLUMNS = COLUMNS.foods.join(', ');
const FOOD_PLACEHOLDERS = placeholdersFor(COLUMNS.foods);

const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_RECENT_LIMIT = 20;

export type FoodInput = Partial<Food> & { name: string; per100g: Macros };

function foodValues(row: FoodRow): ReturnType<typeof toBindValues> {
  return toBindValues(row, COLUMNS.foods);
}

function positiveLimit(limit: number | undefined, fallback: number): number {
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.trunc(limit)
    : fallback;
}

function buildFood(input: FoodInput, base: Food | null, now: string): Food {
  const servingSizeG = input.servingSizeG ?? base?.servingSizeG ?? 100;
  const barcode = input.barcode === undefined ? undefined : (input.barcode?.trim() || null);
  const fallback: Food = base ?? {
    id: input.id ?? newId(),
    name: input.name,
    brand: null,
    per100g: input.per100g,
    servingSizeG,
    servingLabel: `${servingSizeG} g`,
    barcode: null,
    source: 'custom',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...fallback,
    ...stripUndefined(input),
    per100g: { ...fallback.per100g, ...stripUndefined(input.per100g ?? {}) },
    barcode: barcode === undefined ? fallback.barcode : barcode,
    id: base?.id ?? input.id ?? fallback.id,
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
  };
}

/** A single food by id, or `null`. */
export async function getFood(id: ID): Promise<Food | null> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods WHERE id = ? LIMIT 1;`,
    id
  );
  return row ? rowToFood(row) : null;
}

/** A single food by barcode, or `null`. */
export async function getFoodByBarcode(barcode: string): Promise<Food | null> {
  const db = await ensureReady();
  const trimmed = (barcode ?? '').trim();
  if (!trimmed) return null;
  const row = await db.getFirstAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods WHERE barcode = ? LIMIT 1;`,
    trimmed
  );
  return row ? rowToFood(row) : null;
}

/**
 * Case-insensitive food search ranked exact name > name prefix > name
 * substring > brand match, tie-broken by usage, favourite flag then name.
 * An empty query returns favourites and recently used foods.
 */
export async function searchFoods(query: string, limit?: number): Promise<Food[]> {
  const db = await ensureReady();
  const max = positiveLimit(limit, DEFAULT_SEARCH_LIMIT);
  const needle = (query ?? '').trim().toLowerCase();

  if (!needle) {
    const rows = await db.getAllAsync<FoodRow>(
      `SELECT ${FOOD_COLUMNS} FROM foods
       ORDER BY is_favorite DESC,
                (last_used_at IS NULL) ASC,
                last_used_at DESC,
                usage_count DESC,
                name ASC
       LIMIT ?;`,
      max
    );
    return (rows ?? []).map(rowToFood);
  }

  const escaped = escapeLikePattern(needle);
  const prefix = `${escaped}%`;
  const contains = `%${escaped}%`;

  const rows = await db.getAllAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods
     WHERE lower(name) LIKE ? ESCAPE '\\'
        OR lower(IFNULL(brand, '')) LIKE ? ESCAPE '\\'
     ORDER BY
       CASE
         WHEN lower(name) = ? THEN 0
         WHEN lower(name) LIKE ? ESCAPE '\\' THEN 1
         WHEN lower(name) LIKE ? ESCAPE '\\' THEN 2
         WHEN lower(IFNULL(brand, '')) LIKE ? ESCAPE '\\' THEN 3
         ELSE 4
       END ASC,
       usage_count DESC,
       is_favorite DESC,
       name ASC
     LIMIT ?;`,
    contains,
    contains,
    needle,
    prefix,
    contains,
    contains,
    max
  );
  return (rows ?? []).map(rowToFood);
}

/** Most recently logged foods, newest first. */
export async function listRecentFoods(limit?: number): Promise<Food[]> {
  const db = await ensureReady();
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods
     WHERE last_used_at IS NOT NULL
     ORDER BY last_used_at DESC, usage_count DESC, name ASC
     LIMIT ?;`,
    positiveLimit(limit, DEFAULT_RECENT_LIMIT)
  );
  return (rows ?? []).map(rowToFood);
}

/** Foods flagged as favourites, alphabetically. */
export async function listFavoriteFoods(): Promise<Food[]> {
  const db = await ensureReady();
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods WHERE is_favorite = 1 ORDER BY name ASC;`
  );
  return (rows ?? []).map(rowToFood);
}

/** Creates or updates a food (matched by id, then barcode). */
export async function upsertFood(input: FoodInput): Promise<Food> {
  const db = await ensureReady();
  const now = nowISO();

  let base: Food | null = null;
  if (input.id) base = await getFood(input.id);
  if (!base && input.barcode) base = await getFoodByBarcode(input.barcode);

  const next = buildFood(input, base, now);
  const row = foodToRow(next);

  await db.runAsync(
    `INSERT OR REPLACE INTO foods (${FOOD_COLUMNS}) VALUES (${FOOD_PLACEHOLDERS});`,
    ...foodValues(row)
  );

  invalidateStore();
  return next;
}

/** Removes a food. Existing entries keep their macros (`food_id` is nulled). */
export async function deleteFood(id: ID): Promise<void> {
  const db = await ensureReady();
  await db.runAsync('DELETE FROM foods WHERE id = ?;', id);
  invalidateStore();
}

/** Flips the favourite flag and returns the new state. */
export async function toggleFavoriteFood(id: ID): Promise<boolean> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<{ is_favorite: number }>(
    'SELECT is_favorite FROM foods WHERE id = ? LIMIT 1;',
    id
  );
  if (!row) throw new Error(`toggleFavoriteFood: food not found (${id})`);

  const next = row.is_favorite === 1 ? 0 : 1;
  await db.runAsync(
    'UPDATE foods SET is_favorite = ?, updated_at = ? WHERE id = ?;',
    next,
    nowISO(),
    id
  );

  invalidateStore();
  return next === 1;
}

/** Increments `usage_count` and stamps `last_used_at`. No-op for unknown ids. */
export async function bumpFoodUsage(id: ID): Promise<void> {
  const db = await ensureReady();
  const now = nowISO();
  await db.runAsync(
    'UPDATE foods SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?;',
    now,
    now,
    id
  );
  invalidateStore();
}

/** Number of foods in the catalogue. */
export async function countFoods(): Promise<number> {
  const db = await ensureReady();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM foods;');
  return row?.count ?? 0;
}

/**
 * Bulk-inserts the seed catalogue in a single transaction, skipping any food
 * whose name already exists (case-insensitive). Returns the number inserted.
 */
export async function seedFoods(foods: FoodInput[]): Promise<number> {
  const db = await ensureReady();
  if (!foods || foods.length === 0) return 0;

  const existing = await db.getAllAsync<{ name: string }>('SELECT name FROM foods;');
  const seen = new Set((existing ?? []).map((r) => r.name.trim().toLowerCase()));

  const now = nowISO();
  const pending: FoodRow[] = [];
  for (const input of foods) {
    const key = (input.name ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pending.push(foodToRow(buildFood({ ...input, source: input.source ?? 'seed' }, null, now)));
  }
  if (pending.length === 0) return 0;

  await db.withTransactionAsync(async () => {
    for (const row of pending) {
      await db.runAsync(
        `INSERT OR REPLACE INTO foods (${FOOD_COLUMNS}) VALUES (${FOOD_PLACEHOLDERS});`,
        ...foodValues(row)
      );
    }
  });

  invalidateStore();
  return pending.length;
}
