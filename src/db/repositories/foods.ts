/**
 * Foods repository — the searchable food database (seed catalogue + user
 * created / scanned foods).
 */
import { newId, nowISO, runInTransaction } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS } from '@/db/schema';
import type { Food, ID, Macros } from '@/types';
import {
  currentAccountScope,
  ensureReady,
  escapeLikePattern,
  foodToRow,
  invalidateStore,
  requireCurrentAccountId,
  rowToFood,
  stripUndefined,
  toBindValues,
  type FoodRow,
} from './mappers';

const FOOD_COLUMNS = COLUMNS.foods.join(', ');
const FOOD_INSERT_COLUMNS = [...COLUMNS.foods, ACCOUNT_ID_COLUMN];
const FOOD_INSERT_PLACEHOLDERS = FOOD_INSERT_COLUMNS.map(() => '?').join(', ');
const FOOD_UPDATE_ASSIGNMENTS = COLUMNS.foods
  .filter((column) => column !== 'id')
  .map((column) => `${column} = excluded.${column}`)
  .join(', ');

const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_RECENT_LIMIT = 20;

export type FoodInput = Partial<Food> & { name: string; per100g: Macros };

function foodValues(row: FoodRow, accountId: ID | null): ReturnType<typeof toBindValues> {
  return toBindValues({ ...row, [ACCOUNT_ID_COLUMN]: accountId }, FOOD_INSERT_COLUMNS);
}

function visibleFoodWhere(accountId: ID | null): { sql: string; params: (string | number | null)[] } {
  return accountId
    ? { sql: `(account_id = ? OR (account_id IS NULL AND source = 'seed'))`, params: [accountId] }
    : { sql: `(account_id IS NULL AND source = 'seed')`, params: [] };
}

function scopedFoodUpsertSql(): string {
  return `INSERT INTO foods (${FOOD_INSERT_COLUMNS.join(', ')}) VALUES (${FOOD_INSERT_PLACEHOLDERS})
     ON CONFLICT(id) DO UPDATE SET ${FOOD_UPDATE_ASSIGNMENTS}
     WHERE foods.account_id = excluded.account_id;`;
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
  const scope = visibleFoodWhere(currentAccountScope());
  const row = await db.getFirstAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods WHERE id = ? AND ${scope.sql} LIMIT 1;`,
    id,
    ...scope.params
  );
  return row ? rowToFood(row) : null;
}

/** A single food by barcode, or `null`. */
export async function getFoodByBarcode(barcode: string): Promise<Food | null> {
  const db = await ensureReady();
  const trimmed = (barcode ?? '').trim();
  if (!trimmed) return null;
  const accountId = currentAccountScope();
  const scope = visibleFoodWhere(accountId);
  const row = await db.getFirstAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods WHERE barcode = ? AND ${scope.sql}
     ORDER BY CASE WHEN account_id = ? THEN 0 ELSE 1 END ASC, created_at ASC LIMIT 1;`,
    trimmed,
    ...scope.params,
    accountId
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

  const accountId = currentAccountScope();
  const scope = visibleFoodWhere(accountId);

  if (!needle) {
    const rows = await db.getAllAsync<FoodRow>(
      `SELECT ${FOOD_COLUMNS} FROM foods
       WHERE ${scope.sql}
       ORDER BY is_favorite DESC,
                (last_used_at IS NULL) ASC,
                last_used_at DESC,
                usage_count DESC,
                name ASC
       LIMIT ?;`,
      ...scope.params,
      max
    );
    return (rows ?? []).map(rowToFood);
  }

  const escaped = escapeLikePattern(needle);
  const prefix = `${escaped}%`;
  const contains = `%${escaped}%`;

  const rows = await db.getAllAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods
     WHERE ${scope.sql}
       AND (lower(name) LIKE ? ESCAPE '\\'
        OR lower(IFNULL(brand, '')) LIKE ? ESCAPE '\\')
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
    ...scope.params,
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
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods
     WHERE account_id = ? AND last_used_at IS NOT NULL
     ORDER BY last_used_at DESC, usage_count DESC, name ASC
     LIMIT ?;`,
    accountId,
    positiveLimit(limit, DEFAULT_RECENT_LIMIT)
  );
  return (rows ?? []).map(rowToFood);
}

/** Foods flagged as favourites, alphabetically. */
export async function listFavoriteFoods(): Promise<Food[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const rows = await db.getAllAsync<FoodRow>(
    `SELECT ${FOOD_COLUMNS} FROM foods WHERE account_id = ? AND is_favorite = 1 ORDER BY name ASC;`,
    accountId
  );
  return (rows ?? []).map(rowToFood);
}

/** Creates or updates a food (matched by id, then barcode). */
export async function upsertFood(input: FoodInput): Promise<Food> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('upsertFood');
  const now = nowISO();

  let base: Food | null = null;
  if (input.id) base = await getFood(input.id);
  if (!base && input.barcode) base = await getFoodByBarcode(input.barcode);

  const next = buildFood(input, base, now);
  const row = foodToRow(next);

  const result = await db.runAsync(scopedFoodUpsertSql(), ...foodValues(row, accountId));
  if ((result?.changes ?? 0) === 0) throw new Error(`upsertFood: food not found (${row.id})`);

  invalidateStore();
  return next;
}

/** Removes a food. Existing entries keep their macros (`food_id` is nulled). */
export async function deleteFood(id: ID): Promise<void> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return;
  await db.runAsync('DELETE FROM foods WHERE id = ? AND account_id = ?;', id, accountId);
  invalidateStore();
}

/** Flips the favourite flag and returns the new state. */
export async function toggleFavoriteFood(id: ID): Promise<boolean> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('toggleFavoriteFood');
  const row = await db.getFirstAsync<{ is_favorite: number }>(
    'SELECT is_favorite FROM foods WHERE id = ? AND account_id = ? LIMIT 1;',
    id,
    accountId
  );
  if (!row) throw new Error(`toggleFavoriteFood: food not found (${id})`);

  const next = row.is_favorite === 1 ? 0 : 1;
  await db.runAsync(
    'UPDATE foods SET is_favorite = ?, updated_at = ? WHERE id = ? AND account_id = ?;',
    next,
    nowISO(),
    id,
    accountId
  );

  invalidateStore();
  return next === 1;
}

/** Increments `usage_count` and stamps `last_used_at`. No-op for unknown ids. */
export async function bumpFoodUsage(id: ID): Promise<void> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return;
  const now = nowISO();
  await db.runAsync(
    'UPDATE foods SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ? WHERE id = ? AND account_id = ?;',
    now,
    now,
    id,
    accountId
  );
  invalidateStore();
}

/** Number of foods in the catalogue. */
export async function countFoods(): Promise<number> {
  const db = await ensureReady();
  const scope = visibleFoodWhere(currentAccountScope());
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM foods WHERE ${scope.sql};`,
    ...scope.params
  );
  return row?.count ?? 0;
}

/**
 * Bulk-inserts the seed catalogue in a single transaction, skipping any food
 * whose name already exists (case-insensitive). Returns the number inserted.
 *
 * The existing-name lookup happens INSIDE the transaction so two concurrent
 * seed passes (a double `bootstrap()`) can never insert the catalogue twice.
 */
export async function seedFoods(foods: FoodInput[]): Promise<number> {
  const db = await ensureReady();
  if (!foods || foods.length === 0) return 0;

  const now = nowISO();
  let inserted = 0;

  await runInTransaction(db, async () => {
    const existing = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM foods WHERE account_id IS NULL AND source = 'seed';"
    );
    const seen = new Set((existing ?? []).map((r) => (r.name ?? '').trim().toLowerCase()));

    for (const input of foods) {
      const key = (input.name ?? '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const row = foodToRow(buildFood({ ...input, source: 'seed' }, null, now));
      await db.runAsync(
        `INSERT INTO foods (${FOOD_INSERT_COLUMNS.join(', ')}) VALUES (${FOOD_INSERT_PLACEHOLDERS})
         ON CONFLICT(id) DO UPDATE SET ${FOOD_UPDATE_ASSIGNMENTS}
         WHERE foods.account_id IS NULL AND excluded.account_id IS NULL AND foods.source = 'seed';`,
        ...foodValues(row, null)
      );
      inserted += 1;
    }
  });

  if (inserted > 0) invalidateStore();
  return inserted;
}
