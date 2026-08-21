/**
 * Full JSON restore for snapshots produced by `exportAllData()`.
 */
import { boolToInt, runInTransaction } from '@/db/client';
import { ACCOUNT_ID_COLUMN, COLUMNS, SCHEMA_VERSION, TABLES } from '@/db/schema';
import { isValidISODate } from '@/domain/dates';
import { recipeTotals } from '@/domain/recipes';
import { getCurrentAccountId } from '@/services/auth/currentAccount';
import type {
  ActivityLevel,
  AppSettings,
  EntrySource,
  ExerciseCategory,
  ExerciseEntry,
  Food,
  FoodEntry,
  FoodSource,
  Goal,
  GoalType,
  ID,
  Macros,
  MacroSplitPreset,
  MealType,
  Recipe,
  RecipeItem,
  RecipeKind,
  ServingUnit,
  Sex,
  UserProfile,
  WeightLog,
} from '@/types';
import {
  ACTIVITY_LEVELS,
  EXERCISE_CATEGORIES,
  GOAL_TYPES,
  MEAL_TYPES,
} from '@/types/constants';
import {
  ensureReady,
  exerciseEntryToRow,
  foodEntryToRow,
  foodToRow,
  goalToRow,
  invalidateStore,
  macrosToColumns,
  profileToRow,
  textOrNull,
  toBindValues,
  weightLogToRow,
  type BindValue,
} from './mappers';
import { deleteFoodPhotoFile, accountPhotoPrefix } from './photoFiles';
import { SETTINGS_KEYS } from './settings';

export interface ImportOptions {
  mode?: 'replace' | 'merge';
}

export interface ImportTableCount {
  imported: number;
  skipped: number;
}

export interface ImportResult {
  mode: 'replace' | 'merge';
  counts: Record<ImportTableName, ImportTableCount>;
  warnings: string[];
}

export type ImportTableName =
  | 'profile'
  | 'goals'
  | 'foods'
  | 'foodEntries'
  | 'recipes'
  | 'recipeItems'
  | 'exerciseEntries'
  | 'weightLogs'
  | 'settings';

export class ImportDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportDataError';
  }
}

interface ExportPayload {
  version: number;
  exportedAt: string;
  profile: UserProfile | null;
  goals: unknown[];
  foods: unknown[];
  foodEntries: unknown[];
  recipes: unknown[];
  exerciseEntries: unknown[];
  weightLogs: unknown[];
  settings: Record<string, unknown>;
}

type Db = Awaited<ReturnType<typeof ensureReady>>;

/**
 * Keeps an imported photo path only when it points inside the importing
 * account's own folder.
 *
 * Anything else refers to a file the backup never contained: another account's
 * private photo on this device, or a path that does not exist on a fresh
 * install. Dropping it shows the entry without an image, which is honest, in
 * preference to exposing someone else's photo or rendering a broken one.
 */
function importedPhotoUri(uri: string | null, prefix: string | null): string | null {
  const trimmed = uri?.trim() ?? '';
  if (!trimmed || !prefix) return null;
  return trimmed.startsWith(prefix) ? trimmed : null;
}

const FOOD_INSERT_COLUMNS = [...COLUMNS.foods, ACCOUNT_ID_COLUMN];
const FOOD_ENTRY_INSERT_COLUMNS = [...COLUMNS.food_entries, ACCOUNT_ID_COLUMN];
const GOAL_INSERT_COLUMNS = [...COLUMNS.goals, ACCOUNT_ID_COLUMN];
const EXERCISE_INSERT_COLUMNS = [...COLUMNS.exercise_entries, ACCOUNT_ID_COLUMN];
const WEIGHT_INSERT_COLUMNS = [...COLUMNS.weight_logs, ACCOUNT_ID_COLUMN];
const PROFILE_INSERT_COLUMNS = [...COLUMNS.profile, ACCOUNT_ID_COLUMN];
const RECIPE_INSERT_COLUMNS = [...COLUMNS.recipes, ACCOUNT_ID_COLUMN];
const RECIPE_ITEM_INSERT_COLUMNS = [...COLUMNS.recipe_items, ACCOUNT_ID_COLUMN];

const TABLE_NAMES: ImportTableName[] = [
  'profile',
  'goals',
  'foods',
  'foodEntries',
  'recipes',
  'recipeItems',
  'exerciseEntries',
  'weightLogs',
  'settings',
];

const SEXES: Sex[] = ['male', 'female'];
const WEIGHT_UNITS = ['kg', 'lb'] as const;
const HEIGHT_UNITS = ['cm', 'ft_in'] as const;
const FOOD_SOURCES: FoodSource[] = ['seed', 'custom', 'vision', 'label', 'quick_add'];
const ENTRY_SOURCES: EntrySource[] = ['manual', 'healthkit', 'health_connect'];
const SERVING_UNITS: ServingUnit[] = ['g', 'ml', 'oz', 'serving', 'piece', 'cup', 'tbsp', 'tsp'];
const MACRO_SPLITS: MacroSplitPreset[] = ['balanced', 'high_protein', 'low_carb', 'keto', 'custom'];
const RECIPE_KINDS: RecipeKind[] = ['recipe', 'meal'];
const ENERGY_UNITS = ['kcal', 'kJ'] as const;
const THEMES = ['system', 'light', 'dark'] as const;

function emptyCounts(): Record<ImportTableName, ImportTableCount> {
  return Object.fromEntries(TABLE_NAMES.map((name) => [name, { imported: 0, skipped: 0 }])) as Record<
    ImportTableName,
    ImportTableCount
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * A required day bucket: a real local calendar date written as 'YYYY-MM-DD'.
 *
 * `requiredString` is not enough for the `date` columns. A backup — hand-edited,
 * third-party, or produced by a buggy exporter — can carry a full timestamp
 * (wrong width) or a shape-only value like '2026-02-31' / '9999-99-99'. Stored
 * verbatim these become "ghost" rows: `date = '2026-05-01'` never matches a
 * 24-char timestamp, and a garbage future date sorts after every real day, so
 * `ORDER BY date DESC` would hand it back as the latest weight forever. The
 * shared {@link isValidISODate} guard is exactly what `domain/dates` documents
 * untrusted imported dates must pass; the canonical trimmed value is stored so
 * padded input can never miss an equality match either.
 */
function requiredISODate(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isValidISODate(trimmed) ? trimmed : null;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined || typeof value === 'string' ? (value ?? null) : null;
}

function requiredNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean | null {
  const value = row[key];
  return typeof value === 'boolean' ? value : null;
}

function requiredUnion<T extends string>(
  row: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | null {
  const value = row[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function nullableUnion<T extends string>(
  row: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function requiredMacros(row: Record<string, unknown>, key: string): Macros | null {
  const value = row[key];
  if (!isRecord(value)) return null;
  const calories = requiredNumber(value, 'calories');
  const protein = requiredNumber(value, 'protein');
  const carbs = requiredNumber(value, 'carbs');
  const fat = requiredNumber(value, 'fat');
  if (calories === null || protein === null || carbs === null || fat === null) return null;
  const macros: Macros = { calories, protein, carbs, fat };
  const fiber = nullableNumber(value, 'fiber');
  const sugar = nullableNumber(value, 'sugar');
  const sodium = nullableNumber(value, 'sodium');
  if (fiber !== null) macros.fiber = fiber;
  if (sugar !== null) macros.sugar = sugar;
  if (sodium !== null) macros.sodium = sodium;
  return macros;
}

function warn(warnings: string[], table: ImportTableName, index: number, message: string): void {
  warnings.push(`${table}[${index}]: ${message}`);
}

function validatePayload(payload: unknown): ExportPayload {
  if (!isRecord(payload)) throw new ImportDataError('Import file must be a JSON object.');
  const version = payload.version;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new ImportDataError('Import file is missing a numeric version.');
  }
  if (version > SCHEMA_VERSION) {
    throw new ImportDataError(
      `Import file version ${version} is newer than supported schema version ${SCHEMA_VERSION}.`
    );
  }
  // Older exports are accepted only when they still contain the current snapshot
  // shape; otherwise we would have to guess at missing tables and silently drop data.
  if (typeof payload.exportedAt !== 'string') {
    throw new ImportDataError('Import file is missing exportedAt.');
  }
  if (!(payload.profile === null || isRecord(payload.profile))) {
    throw new ImportDataError('Import file profile must be an object or null.');
  }
  for (const key of ['goals', 'foods', 'foodEntries', 'recipes', 'exerciseEntries', 'weightLogs']) {
    if (!Array.isArray(payload[key])) throw new ImportDataError(`Import file ${key} must be an array.`);
  }
  if (!isRecord(payload.settings)) throw new ImportDataError('Import file settings must be an object.');
  return payload as unknown as ExportPayload;
}

function parseProfile(value: unknown): UserProfile | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const name = requiredString(value, 'name');
  const sex = requiredUnion(value, 'sex', SEXES);
  const birthDate = requiredString(value, 'birthDate');
  const heightCm = requiredNumber(value, 'heightCm');
  const currentWeightKg = requiredNumber(value, 'currentWeightKg');
  const activityLevel = requiredUnion<ActivityLevel>(value, 'activityLevel', ACTIVITY_LEVELS);
  const weightUnit = requiredUnion(value, 'weightUnit', WEIGHT_UNITS);
  const heightUnit = requiredUnion(value, 'heightUnit', HEIGHT_UNITS);
  const createdAt = requiredString(value, 'createdAt');
  const updatedAt = requiredString(value, 'updatedAt');
  if (
    !id ||
    !name ||
    !sex ||
    !birthDate ||
    heightCm === null ||
    currentWeightKg === null ||
    !activityLevel ||
    !weightUnit ||
    !heightUnit ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id,
    name,
    sex,
    birthDate,
    heightCm,
    currentWeightKg,
    goalWeightKg: nullableNumber(value, 'goalWeightKg'),
    activityLevel,
    weightUnit,
    heightUnit,
    onboardedAt: nullableString(value, 'onboardedAt'),
    createdAt,
    updatedAt,
  };
}

function parseGoal(value: unknown): Goal | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const type = requiredUnion<GoalType>(value, 'type', GOAL_TYPES);
  const rateKgPerWeek = requiredNumber(value, 'rateKgPerWeek');
  const macroSplit = requiredUnion(value, 'macroSplit', MACRO_SPLITS);
  const targets = value.targets;
  const startedAt = requiredString(value, 'startedAt');
  const isActive = requiredBoolean(value, 'isActive');
  const isManualOverride = requiredBoolean(value, 'isManualOverride');
  const createdAt = requiredString(value, 'createdAt');
  const updatedAt = requiredString(value, 'updatedAt');
  if (!isRecord(targets)) return null;
  const calories = requiredNumber(targets, 'calories');
  const protein = requiredNumber(targets, 'protein');
  const carbs = requiredNumber(targets, 'carbs');
  const fat = requiredNumber(targets, 'fat');
  if (
    !id ||
    !type ||
    rateKgPerWeek === null ||
    !macroSplit ||
    calories === null ||
    protein === null ||
    carbs === null ||
    fat === null ||
    !startedAt ||
    isActive === null ||
    isManualOverride === null ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id,
    type,
    rateKgPerWeek,
    macroSplit,
    targets: { calories, protein, carbs, fat },
    isManualOverride,
    startedAt,
    isActive,
    createdAt,
    updatedAt,
  };
}

function parseFood(value: unknown): Food | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const name = requiredString(value, 'name');
  const per100g = requiredMacros(value, 'per100g');
  const servingSizeG = requiredNumber(value, 'servingSizeG');
  const servingLabel = requiredString(value, 'servingLabel');
  const source = requiredUnion(value, 'source', FOOD_SOURCES);
  const isFavorite = requiredBoolean(value, 'isFavorite');
  const usageCount = requiredNumber(value, 'usageCount');
  const createdAt = requiredString(value, 'createdAt');
  const updatedAt = requiredString(value, 'updatedAt');
  if (
    !id ||
    !name ||
    !per100g ||
    servingSizeG === null ||
    !servingLabel ||
    !source ||
    isFavorite === null ||
    usageCount === null ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id,
    name,
    brand: nullableString(value, 'brand'),
    per100g,
    servingSizeG,
    servingLabel,
    barcode: nullableString(value, 'barcode'),
    source,
    isFavorite,
    usageCount,
    lastUsedAt: nullableString(value, 'lastUsedAt'),
    createdAt,
    updatedAt,
  };
}

function parseFoodEntry(value: unknown): FoodEntry | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const date = requiredISODate(value, 'date');
  const mealType = requiredUnion<MealType>(value, 'mealType', MEAL_TYPES);
  const quantity = requiredNumber(value, 'quantity');
  const unit = requiredUnion(value, 'unit', SERVING_UNITS);
  const servingLabel = requiredString(value, 'servingLabel');
  const gramsTotal = requiredNumber(value, 'gramsTotal');
  const macros = requiredMacros(value, 'macros');
  const source = requiredUnion(value, 'source', FOOD_SOURCES);
  const wasEdited = requiredBoolean(value, 'wasEdited');
  const loggedAt = requiredString(value, 'loggedAt');
  const createdAt = requiredString(value, 'createdAt');
  const updatedAt = requiredString(value, 'updatedAt');
  const name = requiredString(value, 'name');
  if (
    !id ||
    !date ||
    !mealType ||
    quantity === null ||
    !unit ||
    !servingLabel ||
    gramsTotal === null ||
    !macros ||
    !source ||
    wasEdited === null ||
    !loggedAt ||
    !createdAt ||
    !updatedAt ||
    !name
  ) {
    return null;
  }
  return {
    id,
    date,
    mealType,
    foodId: nullableString(value, 'foodId'),
    name,
    brand: nullableString(value, 'brand'),
    quantity,
    unit,
    servingLabel,
    gramsTotal,
    macros,
    photoUri: nullableString(value, 'photoUri'),
    source,
    visionConfidence: nullableNumber(value, 'visionConfidence'),
    wasEdited,
    loggedAt,
    createdAt,
    updatedAt,
  };
}

function parseRecipeItem(value: unknown): RecipeItem | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const recipeId = requiredString(value, 'recipeId');
  const name = requiredString(value, 'name');
  const quantity = requiredNumber(value, 'quantity');
  const unit = requiredString(value, 'unit');
  const gramsTotal = requiredNumber(value, 'gramsTotal');
  const macros = requiredMacros(value, 'macros');
  const sortOrder = requiredNumber(value, 'sortOrder');
  if (!id || !recipeId || !name || quantity === null || !unit || gramsTotal === null || !macros || sortOrder === null) {
    return null;
  }
  return {
    id,
    recipeId,
    foodId: nullableString(value, 'foodId'),
    name,
    quantity,
    unit,
    gramsTotal,
    macros,
    sortOrder,
  };
}

function parseRecipe(value: unknown): Recipe | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const name = requiredString(value, 'name');
  const kind = requiredUnion(value, 'kind', RECIPE_KINDS);
  const servings = requiredNumber(value, 'servings');
  const isFavorite = requiredBoolean(value, 'isFavorite');
  const timesLogged = requiredNumber(value, 'timesLogged');
  const itemsValue = value.items;
  const totals = requiredMacros(value, 'totals');
  const totalGrams = requiredNumber(value, 'totalGrams');
  const createdAt = requiredString(value, 'createdAt');
  const updatedAt = requiredString(value, 'updatedAt');
  if (
    !id ||
    !name ||
    !kind ||
    servings === null ||
    isFavorite === null ||
    timesLogged === null ||
    !Array.isArray(itemsValue) ||
    !totals ||
    totalGrams === null ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  const items: RecipeItem[] = [];
  for (const item of itemsValue) {
    const parsed = parseRecipeItem(item);
    if (!parsed) return null;
    items.push(parsed);
  }
  return {
    id,
    name,
    kind,
    servings,
    defaultMealType: nullableUnion<MealType>(value, 'defaultMealType', MEAL_TYPES),
    notes: nullableString(value, 'notes'),
    photoUri: nullableString(value, 'photoUri'),
    isFavorite,
    timesLogged,
    lastLoggedAt: nullableString(value, 'lastLoggedAt'),
    items,
    totals,
    totalGrams,
    createdAt,
    updatedAt,
  };
}

function parseExerciseEntry(value: unknown): ExerciseEntry | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const date = requiredISODate(value, 'date');
  const name = requiredString(value, 'name');
  const category = requiredUnion<ExerciseCategory>(value, 'category', EXERCISE_CATEGORIES);
  const durationMin = requiredNumber(value, 'durationMin');
  const caloriesBurned = requiredNumber(value, 'caloriesBurned');
  const source = requiredUnion(value, 'source', ENTRY_SOURCES);
  const loggedAt = requiredString(value, 'loggedAt');
  const createdAt = requiredString(value, 'createdAt');
  const updatedAt = requiredString(value, 'updatedAt');
  if (!id || !date || !name || !category || durationMin === null || caloriesBurned === null || !source || !loggedAt || !createdAt || !updatedAt) {
    return null;
  }
  return {
    id,
    date,
    name,
    category,
    durationMin,
    caloriesBurned,
    source,
    externalId: nullableString(value, 'externalId'),
    notes: nullableString(value, 'notes'),
    loggedAt,
    createdAt,
    updatedAt,
  };
}

function parseWeightLog(value: unknown): WeightLog | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, 'id');
  const date = requiredISODate(value, 'date');
  const weightKg = requiredNumber(value, 'weightKg');
  const source = requiredUnion(value, 'source', ENTRY_SOURCES);
  const createdAt = requiredString(value, 'createdAt');
  const updatedAt = requiredString(value, 'updatedAt');
  if (!id || !date || weightKg === null || !source || !createdAt || !updatedAt) return null;
  return {
    id,
    date,
    weightKg,
    bodyFatPct: nullableNumber(value, 'bodyFatPct'),
    note: nullableString(value, 'note'),
    source,
    createdAt,
    updatedAt,
  };
}

async function idExists(db: Db, table: string, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ? LIMIT 1;`, id);
  return Boolean(row);
}

async function currentScopedIdExists(db: Db, table: string, id: string, accountId: ID): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ? AND account_id = ? LIMIT 1;`,
    id,
    accountId
  );
  return Boolean(row);
}

async function nextFreeId(db: Db, table: string, id: string): Promise<string> {
  if (!(await idExists(db, table, id))) return id;
  let suffix = 1;
  let candidate = `${id}-imported`;
  while (await idExists(db, table, candidate)) {
    suffix += 1;
    candidate = `${id}-imported-${suffix}`;
  }
  return candidate;
}

async function existingFoodDuplicate(db: Db, food: Food, accountId: ID): Promise<ID | null> {
  const byId = await db.getFirstAsync<{ id: string; account_id: string | null; source: string }>(
    'SELECT id, account_id, source FROM foods WHERE id = ? LIMIT 1;',
    food.id
  );
  if (byId && (byId.account_id === accountId || (byId.account_id === null && byId.source === 'seed'))) {
    return byId.id;
  }
  if (food.source === 'seed') {
    const bySeed = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM foods
       WHERE account_id IS NULL AND source = 'seed'
         AND (lower(name) = lower(?) OR (barcode IS NOT NULL AND barcode = ?))
       ORDER BY created_at ASC LIMIT 1;`,
      food.name,
      food.barcode
    );
    return bySeed?.id ?? null;
  }
  if (food.barcode) {
    const byBarcode = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM foods WHERE account_id = ? AND barcode = ? ORDER BY created_at ASC LIMIT 1;',
      accountId,
      food.barcode
    );
    return byBarcode?.id ?? null;
  }
  return null;
}

async function remappedScopedId(
  db: Db,
  table: string,
  originalId: string,
  accountId: ID
): Promise<{ id: string; duplicate: boolean }> {
  if (await currentScopedIdExists(db, table, originalId, accountId)) {
    return { id: originalId, duplicate: true };
  }
  return { id: await nextFreeId(db, table, originalId), duplicate: false };
}

async function visibleFoodExists(db: Db, foodId: ID, accountId: ID): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM foods
     WHERE id = ? AND (account_id = ? OR (account_id IS NULL AND source = 'seed')) LIMIT 1;`,
    foodId,
    accountId
  );
  return Boolean(row);
}

/**
 * Deletes every row scoped to `accountId` inside the caller's transaction.
 *
 * Photo files are NOT deleted here: the file system is not transactional, so a
 * mid-import failure would roll the rows back while their photos were already
 * gone, leaving restored entries pointing at deleted files. The URIs are
 * collected into `photoSink` instead and deleted by the caller ONLY after the
 * transaction commits.
 */
async function clearAccountData(db: Db, accountId: ID, photoSink: string[]): Promise<void> {
  const photoRows = await db.getAllAsync<{ photo_uri: string | null }>(
    'SELECT photo_uri FROM food_entries WHERE account_id = ? AND photo_uri IS NOT NULL;',
    accountId
  );
  for (const row of photoRows ?? []) {
    if (row.photo_uri) photoSink.push(row.photo_uri);
  }

  // Recipes carry photos too; missing them here leaves a file on disk for every
  // replaced recipe with no row left to ever reference or clean it up.
  const recipePhotoRows = await db.getAllAsync<{ photo_uri: string | null }>(
    'SELECT photo_uri FROM recipes WHERE account_id = ? AND photo_uri IS NOT NULL;',
    accountId
  );
  for (const row of recipePhotoRows ?? []) {
    if (row.photo_uri) photoSink.push(row.photo_uri);
  }

  await db.runAsync('DELETE FROM food_entries WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM recipe_items WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM recipes WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM exercise_entries WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM weight_logs WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM goals WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM foods WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM profile WHERE account_id = ?;', accountId);
  await db.runAsync('DELETE FROM settings WHERE account_id = ?;', accountId);
}

function insertSql(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')});`;
}

function recipeBindValues(recipe: Recipe, accountId: ID): BindValue[] {
  const totals = macrosToColumns(recipe.totals);
  const row = {
    id: recipe.id,
    name: recipe.name,
    kind: recipe.kind,
    servings: recipe.servings,
    default_meal_type: recipe.defaultMealType,
    notes: textOrNull(recipe.notes),
    photo_uri: textOrNull(recipe.photoUri),
    is_favorite: boolToInt(recipe.isFavorite),
    times_logged: Math.trunc(recipe.timesLogged),
    last_logged_at: textOrNull(recipe.lastLoggedAt),
    total_grams: recipe.totalGrams,
    ...totals,
    created_at: recipe.createdAt,
    updated_at: recipe.updatedAt,
    [ACCOUNT_ID_COLUMN]: accountId,
  };
  return toBindValues(row, RECIPE_INSERT_COLUMNS);
}

function recipeItemBindValues(item: RecipeItem, accountId: ID): BindValue[] {
  const macros = macrosToColumns(item.macros);
  const row = {
    id: item.id,
    recipe_id: item.recipeId,
    food_id: textOrNull(item.foodId),
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    grams_total: item.gramsTotal,
    ...macros,
    sort_order: Math.trunc(item.sortOrder),
    [ACCOUNT_ID_COLUMN]: accountId,
  };
  return toBindValues(row, RECIPE_ITEM_INSERT_COLUMNS);
}

function settingValid(key: string, value: unknown): boolean {
  switch (key) {
    case 'weightUnit':
      return (WEIGHT_UNITS as readonly unknown[]).includes(value);
    case 'heightUnit':
      return (HEIGHT_UNITS as readonly unknown[]).includes(value);
    case 'energyUnit':
      return (ENERGY_UNITS as readonly unknown[]).includes(value);
    case 'healthSyncEnabled':
    case 'addExerciseToTarget':
      return typeof value === 'boolean';
    case 'theme':
      return (THEMES as readonly unknown[]).includes(value);
    case 'visionProvider':
    case 'barcodeProvider':
      return typeof value === 'string';
    default:
      return false;
  }
}

export async function importAllData(
  payload: unknown,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const parsed = validatePayload(payload);
  const mode = options.mode ?? 'merge';
  const db = await ensureReady();
  const accountId = getCurrentAccountId();
  if (!accountId) throw new ImportDataError('importAllData: no current account');

  const counts = emptyCounts();
  const warnings: string[] = [];
  const foodIdMap = new Map<ID, ID>();
  const recipeIdMap = new Map<ID, ID>();
  // Photos of rows cleared in replace mode; deleted only after the transaction
  // commits so a rolled-back import never orphans a restored entry's photo.
  const photosToDelete: string[] = [];
  // A backup is JSON: it carries photo paths, never the image files. Only a path
  // already inside this account's own folder refers to a file that actually
  // exists and belongs to the importing user.
  const photoPrefix = accountPhotoPrefix(accountId);
  let droppedPhotos = 0;

  await runInTransaction(db, async () => {
    if (mode === 'replace') await clearAccountData(db, accountId, photosToDelete);

    const profile = parsed.profile ? parseProfile(parsed.profile) : null;
    if (parsed.profile && !profile) {
      counts.profile.skipped += 1;
      warnings.push('profile: skipped invalid profile row.');
    } else if (profile) {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM profile WHERE account_id = ? LIMIT 1;',
        accountId
      );
      if (existing) {
        counts.profile.skipped += 1;
      } else {
        const id = await nextFreeId(db, TABLES.profile, profile.id);
        const row = { ...profileToRow({ ...profile, id }), [ACCOUNT_ID_COLUMN]: accountId };
        await db.runAsync(insertSql(TABLES.profile, PROFILE_INSERT_COLUMNS), ...toBindValues(row, PROFILE_INSERT_COLUMNS));
        counts.profile.imported += 1;
      }
    }

    for (let i = 0; i < parsed.goals.length; i += 1) {
      const goal = parseGoal(parsed.goals[i]);
      if (!goal) {
        counts.goals.skipped += 1;
        warn(warnings, 'goals', i, 'skipped invalid row.');
        continue;
      }
      const remap = await remappedScopedId(db, TABLES.goals, goal.id, accountId);
      if (remap.duplicate) {
        counts.goals.skipped += 1;
        continue;
      }
      await db.runAsync(
        insertSql(TABLES.goals, GOAL_INSERT_COLUMNS),
        ...toBindValues({ ...goalToRow({ ...goal, id: remap.id }), [ACCOUNT_ID_COLUMN]: accountId }, GOAL_INSERT_COLUMNS)
      );
      counts.goals.imported += 1;
    }

    for (let i = 0; i < parsed.foods.length; i += 1) {
      const food = parseFood(parsed.foods[i]);
      if (!food) {
        counts.foods.skipped += 1;
        warn(warnings, 'foods', i, 'skipped invalid row.');
        continue;
      }
      const duplicateId = await existingFoodDuplicate(db, food, accountId);
      if (duplicateId) {
        foodIdMap.set(food.id, duplicateId);
        counts.foods.skipped += 1;
        continue;
      }
      const id = await nextFreeId(db, TABLES.foods, food.id);
      foodIdMap.set(food.id, id);
      const accountForFood = food.source === 'seed' ? null : accountId;
      await db.runAsync(
        insertSql(TABLES.foods, FOOD_INSERT_COLUMNS),
        ...toBindValues({ ...foodToRow({ ...food, id }), [ACCOUNT_ID_COLUMN]: accountForFood }, FOOD_INSERT_COLUMNS)
      );
      counts.foods.imported += 1;
    }

    for (let i = 0; i < parsed.foodEntries.length; i += 1) {
      const entry = parseFoodEntry(parsed.foodEntries[i]);
      if (!entry) {
        counts.foodEntries.skipped += 1;
        warn(warnings, 'foodEntries', i, 'skipped invalid row.');
        continue;
      }
      const remap = await remappedScopedId(db, TABLES.foodEntries, entry.id, accountId);
      if (remap.duplicate) {
        counts.foodEntries.skipped += 1;
        continue;
      }
      const foodId = entry.foodId ? foodIdMap.get(entry.foodId) ?? entry.foodId : null;
      if (foodId && !(await visibleFoodExists(db, foodId, accountId))) {
        counts.foodEntries.skipped += 1;
        warn(warnings, 'foodEntries', i, `skipped because food '${entry.foodId}' was not imported or visible.`);
        continue;
      }
      const photoUri = importedPhotoUri(entry.photoUri, photoPrefix);
      if (entry.photoUri && !photoUri) droppedPhotos += 1;
      await db.runAsync(
        insertSql(TABLES.foodEntries, FOOD_ENTRY_INSERT_COLUMNS),
        ...toBindValues(
          { ...foodEntryToRow({ ...entry, id: remap.id, foodId, photoUri }), [ACCOUNT_ID_COLUMN]: accountId },
          FOOD_ENTRY_INSERT_COLUMNS
        )
      );
      counts.foodEntries.imported += 1;
    }

    for (let i = 0; i < parsed.recipes.length; i += 1) {
      const recipe = parseRecipe(parsed.recipes[i]);
      if (!recipe) {
        counts.recipes.skipped += 1;
        warn(warnings, 'recipes', i, 'skipped invalid row.');
        continue;
      }
      const remap = await remappedScopedId(db, TABLES.recipes, recipe.id, accountId);
      if (remap.duplicate) {
        recipeIdMap.set(recipe.id, remap.id);
        counts.recipes.skipped += 1;
        counts.recipeItems.skipped += recipe.items.length;
        continue;
      }
      recipeIdMap.set(recipe.id, remap.id);
      const items: RecipeItem[] = [];
      const usedItemIds = new Set<ID>();
      for (let itemIndex = 0; itemIndex < recipe.items.length; itemIndex += 1) {
        const item = recipe.items[itemIndex];
        const itemRemap = await remappedScopedId(db, TABLES.recipeItems, item.id, accountId);
        if (itemRemap.duplicate || usedItemIds.has(itemRemap.id)) {
          counts.recipeItems.skipped += 1;
          continue;
        }
        usedItemIds.add(itemRemap.id);
        const foodId = item.foodId ? foodIdMap.get(item.foodId) ?? item.foodId : null;
        if (foodId && !(await visibleFoodExists(db, foodId, accountId))) {
          counts.recipeItems.skipped += 1;
          warnings.push(
            `recipes[${i}].items[${itemIndex}]: skipped because food '${item.foodId}' was not imported or visible.`
          );
          continue;
        }
        items.push({ ...item, id: itemRemap.id, recipeId: remap.id, foodId });
      }
      const totals = recipeTotals(items);
      const recipePhotoUri = importedPhotoUri(recipe.photoUri, photoPrefix);
      if (recipe.photoUri && !recipePhotoUri) droppedPhotos += 1;
      const nextRecipe: Recipe = {
        ...recipe,
        id: remap.id,
        items,
        photoUri: recipePhotoUri,
        totals: totals.macros,
        totalGrams: totals.grams,
      };
      await db.runAsync(insertSql(TABLES.recipes, RECIPE_INSERT_COLUMNS), ...recipeBindValues(nextRecipe, accountId));
      counts.recipes.imported += 1;
      for (const item of items) {
        await db.runAsync(insertSql(TABLES.recipeItems, RECIPE_ITEM_INSERT_COLUMNS), ...recipeItemBindValues(item, accountId));
        counts.recipeItems.imported += 1;
      }
    }

    for (let i = 0; i < parsed.exerciseEntries.length; i += 1) {
      const entry = parseExerciseEntry(parsed.exerciseEntries[i]);
      if (!entry) {
        counts.exerciseEntries.skipped += 1;
        warn(warnings, 'exerciseEntries', i, 'skipped invalid row.');
        continue;
      }
      const remap = await remappedScopedId(db, TABLES.exerciseEntries, entry.id, accountId);
      if (remap.duplicate) {
        counts.exerciseEntries.skipped += 1;
        continue;
      }
      if (entry.externalId) {
        const existingExternal = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM exercise_entries WHERE external_id = ? AND account_id = ? LIMIT 1;',
          entry.externalId,
          accountId
        );
        if (existingExternal) {
          counts.exerciseEntries.skipped += 1;
          warnings.push(`exerciseEntries[${i}]: skipped duplicate externalId '${entry.externalId}'.`);
          continue;
        }
      }
      await db.runAsync(
        insertSql(TABLES.exerciseEntries, EXERCISE_INSERT_COLUMNS),
        ...toBindValues(
          { ...exerciseEntryToRow({ ...entry, id: remap.id }), [ACCOUNT_ID_COLUMN]: accountId },
          EXERCISE_INSERT_COLUMNS
        )
      );
      counts.exerciseEntries.imported += 1;
    }

    for (let i = 0; i < parsed.weightLogs.length; i += 1) {
      const log = parseWeightLog(parsed.weightLogs[i]);
      if (!log) {
        counts.weightLogs.skipped += 1;
        warn(warnings, 'weightLogs', i, 'skipped invalid row.');
        continue;
      }
      const existingDate = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM weight_logs WHERE account_id = ? AND date = ? LIMIT 1;',
        accountId,
        log.date
      );
      if (existingDate) {
        counts.weightLogs.skipped += 1;
        continue;
      }
      const id = await nextFreeId(db, TABLES.weightLogs, log.id);
      await db.runAsync(
        insertSql(TABLES.weightLogs, WEIGHT_INSERT_COLUMNS),
        ...toBindValues({ ...weightLogToRow({ ...log, id }), [ACCOUNT_ID_COLUMN]: accountId }, WEIGHT_INSERT_COLUMNS)
      );
      counts.weightLogs.imported += 1;
    }

    for (const key of SETTINGS_KEYS) {
      const value = parsed.settings[key];
      if (value === undefined) continue;
      if (!settingValid(key, value)) {
        counts.settings.skipped += 1;
        warnings.push(`settings.${key}: skipped invalid value.`);
        continue;
      }
      const existing = await db.getFirstAsync<{ key: string }>(
        'SELECT key FROM settings WHERE account_id = ? AND key = ? LIMIT 1;',
        accountId,
        key
      );
      if (existing) {
        counts.settings.skipped += 1;
        continue;
      }
      await db.runAsync(
        'INSERT INTO settings (account_id, key, value) VALUES (?, ?, ?);',
        accountId,
        key,
        JSON.stringify(value)
      );
      counts.settings.imported += 1;
    }
  });

  // The import committed: now it is safe to delete the replaced photos.
  for (const uri of photosToDelete) deleteFoodPhotoFile(uri);

  if (droppedPhotos > 0) {
    warnings.push(
      `photos: ${droppedPhotos} photo${droppedPhotos === 1 ? '' : 's'} could not be restored because backup files do not include images.`
    );
  }

  invalidateStore();
  return { mode, counts, warnings };
}
