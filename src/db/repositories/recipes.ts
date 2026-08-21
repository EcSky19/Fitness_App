import { boolToInt, intToBool, newId, nowISO, runInTransaction } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS, TABLES } from '@/db/schema';
import { recipeTotals, scaleRecipeItems } from '@/domain/recipes';
import type { FoodEntry, ID, ISODate, MealType, Recipe, RecipeItem, RecipeKind } from '@/types';
import { MEAL_TYPES } from '@/types/constants';
import {
  currentAccountScope,
  ensureReady,
  escapeLikePattern,
  invalidateStore,
  macrosToColumns,
  placeholdersFor,
  requireCurrentAccountId,
  rowToFoodEntry,
  rowToMacros,
  roundMacro,
  textOrNull,
  toBindValues,
  upsertSql,
  type BindValue,
  type FoodEntryRow,
} from './mappers';
import {
  insertPreparedFoodEntries,
  prepareFoodEntriesForInsert,
  type NewFoodEntry,
} from './foodEntries';
import { deleteFoodPhotoFile, namespaceFoodPhotoUri } from './photoFiles';

interface RecipeRow {
  id: string;
  name: string;
  kind: string;
  servings: number;
  default_meal_type: string | null;
  notes: string | null;
  photo_uri: string | null;
  is_favorite: number;
  times_logged: number;
  last_logged_at: string | null;
  total_grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
  created_at: string;
  updated_at: string;
}

interface RecipeItemRow {
  id: string;
  recipe_id: string;
  food_id: string | null;
  name: string;
  quantity: number;
  unit: string;
  grams_total: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
  sort_order: number;
}

type Db = Awaited<ReturnType<typeof ensureReady>>;

const RECIPE_COLUMNS = COLUMNS.recipes.join(', ');
const RECIPE_ITEM_COLUMNS = COLUMNS.recipe_items.join(', ');
const RECIPE_INSERT_COLUMNS = [...COLUMNS.recipes, ACCOUNT_ID_COLUMN];
const RECIPE_ITEM_INSERT_COLUMNS = [...COLUMNS.recipe_items, ACCOUNT_ID_COLUMN];
const RECIPE_ITEM_PLACEHOLDERS = placeholdersFor(RECIPE_ITEM_INSERT_COLUMNS);
const DEFAULT_LIMIT = 50;

function positiveLimit(limit: number | undefined, fallback = DEFAULT_LIMIT): number {
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.trunc(limit)
    : fallback;
}

function finiteNonNegative(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function sanitizeServings(value: unknown): number {
  const n = finiteNonNegative(value);
  return n > 0 ? n : 1;
}

function recipeKind(value: unknown): RecipeKind {
  return value === 'meal' ? 'meal' : 'recipe';
}

function mealTypeOrNull(value: unknown): MealType | null {
  return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value)
    ? (value as MealType)
    : null;
}

function rowToRecipe(row: RecipeRow, items: RecipeItem[] = []): Recipe {
  return {
    id: row.id,
    name: row.name,
    kind: recipeKind(row.kind),
    servings: sanitizeServings(row.servings),
    defaultMealType: mealTypeOrNull(row.default_meal_type),
    notes: textOrNull(row.notes),
    photoUri: textOrNull(row.photo_uri),
    isFavorite: intToBool(row.is_favorite),
    timesLogged: Math.trunc(finiteNonNegative(row.times_logged)),
    lastLoggedAt: textOrNull(row.last_logged_at),
    items,
    totals: rowToMacros(row),
    totalGrams: finiteNonNegative(row.total_grams),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRecipeItem(row: RecipeItemRow): RecipeItem {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    foodId: textOrNull(row.food_id),
    name: row.name,
    quantity: finiteNonNegative(row.quantity),
    unit: row.unit,
    gramsTotal: finiteNonNegative(row.grams_total),
    macros: rowToMacros(row),
    sortOrder: Math.trunc(finiteNonNegative(row.sort_order)),
  };
}

function recipeToRow(recipe: Recipe): RecipeRow {
  const macros = macrosToColumns(recipe.totals);
  return {
    id: recipe.id,
    name: recipe.name,
    kind: recipe.kind,
    servings: sanitizeServings(recipe.servings),
    default_meal_type: recipe.defaultMealType,
    notes: textOrNull(recipe.notes),
    photo_uri: textOrNull(recipe.photoUri),
    is_favorite: boolToInt(recipe.isFavorite),
    times_logged: Math.trunc(finiteNonNegative(recipe.timesLogged)),
    last_logged_at: textOrNull(recipe.lastLoggedAt),
    total_grams: finiteNonNegative(recipe.totalGrams),
    ...macros,
    created_at: recipe.createdAt,
    updated_at: recipe.updatedAt,
  };
}

function recipeItemToRow(item: RecipeItem): RecipeItemRow {
  const macros = macrosToColumns(item.macros);
  return {
    id: item.id,
    recipe_id: item.recipeId,
    food_id: textOrNull(item.foodId),
    name: item.name,
    quantity: finiteNonNegative(item.quantity),
    unit: item.unit,
    grams_total: finiteNonNegative(item.gramsTotal),
    ...macros,
    sort_order: Math.trunc(finiteNonNegative(item.sortOrder)),
  };
}

function recipeUpsertSql(): string {
  return upsertSql(TABLES.recipes, RECIPE_INSERT_COLUMNS, 'id').replace(
    /;$/,
    ` WHERE ${TABLES.recipes}.account_id = excluded.account_id;`
  );
}

async function visibleFoodIdOrNull(db: Db, foodId: ID | null, accountId: ID): Promise<ID | null> {
  if (!foodId) return null;
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM foods
     WHERE id = ? AND (account_id = ? OR (account_id IS NULL AND source = 'seed'))
     LIMIT 1;`,
    foodId,
    accountId
  );
  return row ? foodId : null;
}

async function loadItems(db: Db, recipeId: ID, accountId: ID): Promise<RecipeItem[]> {
  const rows = await db.getAllAsync<RecipeItemRow>(
    `SELECT ${RECIPE_ITEM_COLUMNS} FROM recipe_items
     WHERE recipe_id = ? AND account_id = ?
     ORDER BY sort_order ASC, id ASC;`,
    recipeId,
    accountId
  );
  return (rows ?? []).map(rowToRecipeItem);
}

async function attachItems(db: Db, rows: RecipeRow[], accountId: ID): Promise<Recipe[]> {
  const recipes: Recipe[] = [];
  for (const row of rows) {
    recipes.push(rowToRecipe(row, await loadItems(db, row.id, accountId)));
  }
  return recipes;
}

async function loadRecipe(db: Db, id: ID, accountId: ID): Promise<Recipe | null> {
  const row = await db.getFirstAsync<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes WHERE id = ? AND account_id = ? LIMIT 1;`,
    id,
    accountId
  );
  return row ? rowToRecipe(row, await loadItems(db, id, accountId)) : null;
}

async function writeRecipe(
  db: Db,
  accountId: ID,
  input: {
    id?: ID;
    name: string;
    kind?: RecipeKind;
    servings?: number;
    defaultMealType?: MealType | null;
    notes?: string | null;
    photoUri?: string | null;
    items: Array<Omit<RecipeItem, 'id' | 'recipeId'>>;
  }
): Promise<Recipe> {
  const now = nowISO();
  const existing = input.id ? await loadRecipe(db, input.id, accountId) : null;
  const id = existing?.id ?? input.id ?? newId();
  const items = await Promise.all((input.items ?? []).map(async (item, index) => ({
    id: newId(),
    recipeId: id,
    foodId: await visibleFoodIdOrNull(db, item.foodId ?? null, accountId),
    name: item.name,
    quantity: finiteNonNegative(item.quantity),
    unit: item.unit,
    gramsTotal: finiteNonNegative(item.gramsTotal),
    macros: item.macros ?? { calories: 0, protein: 0, carbs: 0, fat: 0 },
    sortOrder: Math.trunc(finiteNonNegative(item.sortOrder ?? index)),
  })));
  const totals = recipeTotals(items);
  const recipe: Recipe = {
    id,
    name: input.name,
    kind: input.kind === undefined ? existing?.kind ?? 'recipe' : recipeKind(input.kind),
    servings: sanitizeServings(input.servings ?? existing?.servings ?? 1),
    defaultMealType:
      input.defaultMealType === undefined ? existing?.defaultMealType ?? null : input.defaultMealType,
    notes: input.notes === undefined ? existing?.notes ?? null : input.notes,
    photoUri: input.photoUri === undefined ? existing?.photoUri ?? null : input.photoUri,
    isFavorite: existing?.isFavorite ?? false,
    timesLogged: existing?.timesLogged ?? 0,
    lastLoggedAt: existing?.lastLoggedAt ?? null,
    items,
    totals: totals.macros,
    totalGrams: totals.grams,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const row = recipeToRow(recipe);
  const result = await db.runAsync(
    recipeUpsertSql(),
    ...toBindValues({ ...row, [ACCOUNT_ID_COLUMN]: accountId }, RECIPE_INSERT_COLUMNS)
  );
  if ((result?.changes ?? 0) === 0) throw new Error(`saveRecipe: recipe not found (${id})`);

  await db.runAsync('DELETE FROM recipe_items WHERE recipe_id = ? AND account_id = ?;', id, accountId);
  for (const item of items) {
    const itemRow = recipeItemToRow(item);
    await db.runAsync(
      `INSERT INTO recipe_items (${RECIPE_ITEM_INSERT_COLUMNS.join(', ')})
       VALUES (${RECIPE_ITEM_PLACEHOLDERS});`,
      ...toBindValues({ ...itemRow, [ACCOUNT_ID_COLUMN]: accountId }, RECIPE_ITEM_INSERT_COLUMNS)
    );
  }
  return recipe;
}

export async function listRecipes(opts?: {
  kind?: RecipeKind;
  favoritesOnly?: boolean;
  limit?: number;
}): Promise<Recipe[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const params: BindValue[] = [accountId];
  let where = 'account_id = ?';
  if (opts?.kind) {
    where += ' AND kind = ?';
    params.push(recipeKind(opts.kind));
  }
  if (opts?.favoritesOnly) where += ' AND is_favorite = 1';
  const rows = await db.getAllAsync<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes
     WHERE ${where}
     ORDER BY is_favorite DESC, (last_logged_at IS NULL) ASC, last_logged_at DESC, name ASC
     LIMIT ?;`,
    ...params,
    positiveLimit(opts?.limit)
  );
  return attachItems(db, rows ?? [], accountId);
}

/**
 * Every recipe for the current account, with no page limit.
 *
 * `listRecipes` is deliberately capped (it backs the recipe browser), so a
 * full-database export must not reuse it — otherwise recipes past the cap are
 * silently dropped from the backup and lost on restore. Exports use this.
 */
export async function listAllRecipes(): Promise<Recipe[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const rows = await db.getAllAsync<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes
     WHERE account_id = ?
     ORDER BY is_favorite DESC, (last_logged_at IS NULL) ASC, last_logged_at DESC, name ASC;`,
    accountId
  );
  return attachItems(db, rows ?? [], accountId);
}

export async function getRecipe(id: ID): Promise<Recipe | null> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return null;
  return loadRecipe(db, id, accountId);
}

export async function searchRecipes(needle: string, limit?: number): Promise<Recipe[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  const q = (needle ?? '').trim().toLowerCase();
  if (!q) return listRecipes({ limit });
  const escaped = escapeLikePattern(q);
  const contains = `%${escaped}%`;
  const prefix = `${escaped}%`;
  const rows = await db.getAllAsync<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes
     WHERE account_id = ? AND lower(name) LIKE ? ESCAPE '\\'
     ORDER BY
       CASE
         WHEN lower(name) = ? THEN 0
         WHEN lower(name) LIKE ? ESCAPE '\\' THEN 1
         ELSE 2
       END ASC,
       times_logged DESC,
       name ASC
     LIMIT ?;`,
    accountId,
    contains,
    q,
    prefix,
    positiveLimit(limit)
  );
  return attachItems(db, rows ?? [], accountId);
}

export async function saveRecipe(input: {
  id?: ID;
  name: string;
  kind?: RecipeKind;
  servings?: number;
  defaultMealType?: MealType | null;
  notes?: string | null;
  photoUri?: string | null;
  items: Array<Omit<RecipeItem, 'id' | 'recipeId'>>;
}): Promise<Recipe> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('saveRecipe');

  // Recipe photos live in the same per-account folder as meal photos, so that
  // deleting the account removes them too and a restored backup can never point
  // one account at another account's files.
  const previous = input.id
    ? await db.getFirstAsync<{ photo_uri: string | null }>(
        'SELECT photo_uri FROM recipes WHERE id = ? AND account_id = ?;',
        input.id,
        accountId
      )
    : null;
  const photoUri =
    input.photoUri === undefined ? undefined : namespaceFoodPhotoUri(input.photoUri, accountId);

  let recipe!: Recipe;
  await runInTransaction(db, async () => {
    recipe = await writeRecipe(db, accountId, { ...input, photoUri });
  });

  const replaced = previous?.photo_uri ?? null;
  if (replaced && replaced !== recipe.photoUri) deleteFoodPhotoFile(replaced);

  invalidateStore();
  return recipe;
}

export async function deleteRecipe(id: ID): Promise<void> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return;
  const row = await db.getFirstAsync<{ photo_uri: string | null }>(
    'SELECT photo_uri FROM recipes WHERE id = ? AND account_id = ?;',
    id,
    accountId
  );
  await db.runAsync('DELETE FROM recipes WHERE id = ? AND account_id = ?;', id, accountId);
  // Each pick is copied to its own file, so nothing else can reference it.
  deleteFoodPhotoFile(row?.photo_uri ?? null);
  invalidateStore();
}

export async function toggleFavoriteRecipe(id: ID): Promise<Recipe> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('toggleFavoriteRecipe');
  let recipe: Recipe | null = null;
  await runInTransaction(db, async () => {
    const row = await db.getFirstAsync<{ is_favorite: number }>(
      'SELECT is_favorite FROM recipes WHERE id = ? AND account_id = ? LIMIT 1;',
      id,
      accountId
    );
    if (!row) throw new Error(`toggleFavoriteRecipe: recipe not found (${id})`);
    await db.runAsync(
      'UPDATE recipes SET is_favorite = ?, updated_at = ? WHERE id = ? AND account_id = ?;',
      row.is_favorite === 1 ? 0 : 1,
      nowISO(),
      id,
      accountId
    );
    recipe = await loadRecipe(db, id, accountId);
  });
  invalidateStore();
  if (!recipe) throw new Error(`toggleFavoriteRecipe: recipe not found (${id})`);
  return recipe;
}

export async function logRecipe(input: {
  recipeId: ID;
  date: ISODate;
  mealType: MealType;
  servings?: number;
}): Promise<FoodEntry[]> {
  const db = await ensureReady();
  const accountId = currentAccountScope();
  if (!accountId) return [];
  let created: FoodEntry[] = [];
  let changed = false;
  await runInTransaction(db, async () => {
    const recipe = await loadRecipe(db, input.recipeId, accountId);
    if (!recipe) return;
    changed = true;
    const servings = sanitizeServings(input.servings ?? 1);
    const factor = recipe.kind === 'recipe' ? servings / sanitizeServings(recipe.servings) : servings;
    const items = scaleRecipeItems(recipe.items, factor);
    const entries: NewFoodEntry[] = items.map((item) => ({
      date: input.date,
      mealType: input.mealType,
      foodId: item.foodId,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit as NewFoodEntry['unit'],
      servingLabel: `${roundMacro(item.gramsTotal)} g`,
      gramsTotal: item.gramsTotal,
      macros: item.macros,
      source: 'custom',
    }));
    created = await prepareFoodEntriesForInsert(entries, accountId, nowISO(), db);
    await insertPreparedFoodEntries(db, created, accountId);
    const loggedAt = nowISO();
    await db.runAsync(
      `UPDATE recipes
       SET times_logged = times_logged + 1, last_logged_at = ?, updated_at = ?
       WHERE id = ? AND account_id = ?;`,
      loggedAt,
      loggedAt,
      recipe.id,
      accountId
    );
  });
  if (changed) invalidateStore();
  return created;
}

export async function createRecipeFromEntries(input: {
  name: string;
  kind?: RecipeKind;
  entryIds: ID[];
  servings?: number;
}): Promise<Recipe> {
  const db = await ensureReady();
  const accountId = requireCurrentAccountId('createRecipeFromEntries');
  let recipe!: Recipe;
  await runInTransaction(db, async () => {
    const items: Array<Omit<RecipeItem, 'id' | 'recipeId'>> = [];
    for (const id of input.entryIds ?? []) {
      const row = await db.getFirstAsync<FoodEntryRow>(
        `SELECT ${COLUMNS.food_entries.join(', ')} FROM food_entries
         WHERE id = ? AND account_id = ? LIMIT 1;`,
        id,
        accountId
      );
      if (!row) continue;
      const entry = rowToFoodEntry(row);
      items.push({
        foodId: entry.foodId,
        name: entry.name,
        quantity: entry.quantity,
        unit: entry.unit,
        gramsTotal: entry.gramsTotal,
        macros: entry.macros,
        sortOrder: items.length,
      });
    }
    recipe = await writeRecipe(db, accountId, {
      name: input.name,
      kind: input.kind,
      servings: input.servings,
      items,
    });
  });
  invalidateStore();
  return recipe;
}
