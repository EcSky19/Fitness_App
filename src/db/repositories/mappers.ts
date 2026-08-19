/**
 * Row <-> model mappers for every MacroTrack table.
 *
 * DB columns are snake_case, the TS contract in `@/types` is camelCase, so every
 * field is mapped explicitly. `Macros` live in individual REAL columns (the
 * `foods` table suffixes them with `_per_100g`) and booleans are INTEGER 0/1.
 *
 * The bottom of this file also holds the tiny runtime helpers shared by all
 * repositories (`ensureReady`, `invalidateStore`, `escapeLikePattern`, ...) so
 * that the repository layer needs no extra internal module.
 */
import { boolToInt, getDb, initDatabase, intToBool, type Database } from '@/db/client';
import type {
  ActivityLevel,
  EntrySource,
  ExerciseCategory,
  ExerciseEntry,
  Food,
  FoodEntry,
  FoodSource,
  Goal,
  GoalType,
  HeightUnit,
  MacroSplitPreset,
  Macros,
  MacroTargets,
  MealType,
  ServingUnit,
  Sex,
  UserProfile,
  WeightLog,
  WeightUnit,
} from '@/types';
import {
  ACTIVITY_LEVELS,
  EXERCISE_CATEGORIES,
  GOAL_TYPES,
  MEAL_TYPES,
} from '@/types/constants';

// ---------------------------------------------------------------------------
// Row shapes (exactly what SQLite hands back)
// ---------------------------------------------------------------------------

export interface ProfileRow {
  id: string;
  name: string;
  sex: string;
  birth_date: string;
  height_cm: number;
  current_weight_kg: number;
  goal_weight_kg: number | null;
  activity_level: string;
  weight_unit: string;
  height_unit: string;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalRow {
  id: string;
  type: string;
  rate_kg_per_week: number;
  macro_split: string;
  target_calories: number;
  target_protein: number;
  target_carbs: number;
  target_fat: number;
  is_manual_override: number;
  started_at: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface FoodRow {
  id: string;
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number | null;
  sugar_per_100g: number | null;
  sodium_per_100g: number | null;
  serving_size_g: number;
  serving_label: string;
  barcode: string | null;
  source: string;
  is_favorite: number;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FoodEntryRow {
  id: string;
  date: string;
  meal_type: string;
  food_id: string | null;
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  serving_label: string;
  grams_total: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
  photo_uri: string | null;
  source: string;
  vision_confidence: number | null;
  was_edited: number;
  logged_at: string;
  created_at: string;
  updated_at: string;
}

export interface ExerciseEntryRow {
  id: string;
  date: string;
  name: string;
  category: string;
  duration_min: number;
  calories_burned: number;
  source: string;
  external_id: string | null;
  notes: string | null;
  logged_at: string;
  created_at: string;
  updated_at: string;
}

export interface WeightLogRow {
  id: string;
  date: string;
  weight_kg: number;
  body_fat_pct: number | null;
  note: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface SettingsRow {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Primitive coercion
// ---------------------------------------------------------------------------

const SEXES: Sex[] = ['male', 'female'];
const WEIGHT_UNITS: WeightUnit[] = ['kg', 'lb'];
const HEIGHT_UNITS: HeightUnit[] = ['cm', 'ft_in'];
const SERVING_UNITS: ServingUnit[] = ['g', 'ml', 'oz', 'serving', 'piece', 'cup', 'tbsp', 'tsp'];
const FOOD_SOURCES: FoodSource[] = ['seed', 'custom', 'vision', 'label', 'quick_add'];
const ENTRY_SOURCES: EntrySource[] = ['manual', 'healthkit', 'health_connect'];
const MACRO_SPLITS: MacroSplitPreset[] = ['balanced', 'high_protein', 'low_carb', 'keto', 'custom'];

/** Narrows a DB string to a union member, falling back when the value is unknown. */
function asUnion<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** DB `NULL` -> `undefined` for optional model fields. */
export function nullToUndefined(value: number | null | undefined): number | undefined {
  return value === null || value === undefined || !Number.isFinite(value) ? undefined : value;
}

/** `undefined` -> DB `NULL` for optional model fields. */
export function undefinedToNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** Nullable text column helper (never lets `undefined` or blanks reach the driver). */
export function textOrNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return value.trim() === '' ? null : value;
}

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

export const EMPTY_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

interface MacroColumns {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
}

/** Builds `Macros` from the absolute macro columns of `food_entries`. */
export function rowToMacros(row: MacroColumns): Macros {
  const macros: Macros = {
    calories: asNumber(row.calories),
    protein: asNumber(row.protein),
    carbs: asNumber(row.carbs),
    fat: asNumber(row.fat),
  };
  const fiber = nullToUndefined(row.fiber);
  const sugar = nullToUndefined(row.sugar);
  const sodium = nullToUndefined(row.sodium);
  if (fiber !== undefined) macros.fiber = fiber;
  if (sugar !== undefined) macros.sugar = sugar;
  if (sodium !== undefined) macros.sodium = sodium;
  return macros;
}

/** Inverse of {@link rowToMacros}. */
export function macrosToColumns(macros: Macros | undefined): MacroColumns {
  const m = macros ?? EMPTY_MACROS;
  return {
    calories: asNumber(m.calories),
    protein: asNumber(m.protein),
    carbs: asNumber(m.carbs),
    fat: asNumber(m.fat),
    fiber: undefinedToNull(m.fiber),
    sugar: undefinedToNull(m.sugar),
    sodium: undefinedToNull(m.sodium),
  };
}

/** Multiplies every macro (optional fields stay `undefined`). */
export function scaleMacros(macros: Macros, factor: number): Macros {
  const scale = (v: number): number => roundMacro(v * factor);
  const scaled: Macros = {
    calories: scale(macros.calories),
    protein: scale(macros.protein),
    carbs: scale(macros.carbs),
    fat: scale(macros.fat),
  };
  if (macros.fiber !== undefined) scaled.fiber = scale(macros.fiber);
  if (macros.sugar !== undefined) scaled.sugar = scale(macros.sugar);
  if (macros.sodium !== undefined) scaled.sodium = scale(macros.sodium);
  return scaled;
}

/** Keeps floating point noise out of stored macros. */
export function roundMacro(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

export function rowToProfile(row: ProfileRow): UserProfile {
  return {
    id: asText(row.id),
    name: asText(row.name),
    sex: asUnion(row.sex, SEXES, 'male'),
    birthDate: asText(row.birth_date),
    heightCm: asNumber(row.height_cm),
    currentWeightKg: asNumber(row.current_weight_kg),
    goalWeightKg: row.goal_weight_kg === null ? null : asNumber(row.goal_weight_kg),
    activityLevel: asUnion<ActivityLevel>(row.activity_level, ACTIVITY_LEVELS, 'moderate'),
    weightUnit: asUnion(row.weight_unit, WEIGHT_UNITS, 'kg'),
    heightUnit: asUnion(row.height_unit, HEIGHT_UNITS, 'cm'),
    onboardedAt: textOrNull(row.onboarded_at),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

export function profileToRow(profile: UserProfile): ProfileRow {
  return {
    id: profile.id,
    name: profile.name,
    sex: profile.sex,
    birth_date: profile.birthDate,
    height_cm: asNumber(profile.heightCm),
    current_weight_kg: asNumber(profile.currentWeightKg),
    goal_weight_kg: undefinedToNull(profile.goalWeightKg),
    activity_level: profile.activityLevel,
    weight_unit: profile.weightUnit,
    height_unit: profile.heightUnit,
    onboarded_at: textOrNull(profile.onboardedAt),
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// goals
// ---------------------------------------------------------------------------

export function rowToGoal(row: GoalRow): Goal {
  const targets: MacroTargets = {
    calories: asNumber(row.target_calories),
    protein: asNumber(row.target_protein),
    carbs: asNumber(row.target_carbs),
    fat: asNumber(row.target_fat),
  };
  return {
    id: asText(row.id),
    type: asUnion<GoalType>(row.type, GOAL_TYPES, 'maintain'),
    rateKgPerWeek: asNumber(row.rate_kg_per_week),
    macroSplit: asUnion(row.macro_split, MACRO_SPLITS, 'balanced'),
    targets,
    isManualOverride: intToBool(row.is_manual_override),
    startedAt: asText(row.started_at),
    isActive: intToBool(row.is_active),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

export function goalToRow(goal: Goal): GoalRow {
  return {
    id: goal.id,
    type: goal.type,
    rate_kg_per_week: asNumber(goal.rateKgPerWeek),
    macro_split: goal.macroSplit,
    target_calories: asNumber(goal.targets?.calories),
    target_protein: asNumber(goal.targets?.protein),
    target_carbs: asNumber(goal.targets?.carbs),
    target_fat: asNumber(goal.targets?.fat),
    is_manual_override: boolToInt(goal.isManualOverride),
    started_at: goal.startedAt,
    is_active: boolToInt(goal.isActive),
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// foods
// ---------------------------------------------------------------------------

export function rowToFood(row: FoodRow): Food {
  const per100g: Macros = rowToMacros({
    calories: row.calories_per_100g,
    protein: row.protein_per_100g,
    carbs: row.carbs_per_100g,
    fat: row.fat_per_100g,
    fiber: row.fiber_per_100g,
    sugar: row.sugar_per_100g,
    sodium: row.sodium_per_100g,
  });
  return {
    id: asText(row.id),
    name: asText(row.name),
    brand: textOrNull(row.brand),
    per100g,
    servingSizeG: asNumber(row.serving_size_g, 100),
    servingLabel: asText(row.serving_label),
    barcode: textOrNull(row.barcode),
    source: asUnion(row.source, FOOD_SOURCES, 'custom'),
    isFavorite: intToBool(row.is_favorite),
    usageCount: asNumber(row.usage_count),
    lastUsedAt: textOrNull(row.last_used_at),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

export function foodToRow(food: Food): FoodRow {
  const macros = macrosToColumns(food.per100g);
  return {
    id: food.id,
    name: food.name,
    brand: textOrNull(food.brand),
    calories_per_100g: macros.calories,
    protein_per_100g: macros.protein,
    carbs_per_100g: macros.carbs,
    fat_per_100g: macros.fat,
    fiber_per_100g: macros.fiber,
    sugar_per_100g: macros.sugar,
    sodium_per_100g: macros.sodium,
    serving_size_g: asNumber(food.servingSizeG, 100),
    serving_label: food.servingLabel,
    barcode: textOrNull(food.barcode),
    source: food.source,
    is_favorite: boolToInt(food.isFavorite),
    usage_count: Math.trunc(asNumber(food.usageCount)),
    last_used_at: textOrNull(food.lastUsedAt),
    created_at: food.createdAt,
    updated_at: food.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// food entries
// ---------------------------------------------------------------------------

export function rowToFoodEntry(row: FoodEntryRow): FoodEntry {
  return {
    id: asText(row.id),
    date: asText(row.date),
    mealType: asUnion<MealType>(row.meal_type, MEAL_TYPES, 'snack'),
    foodId: textOrNull(row.food_id),
    name: asText(row.name),
    brand: textOrNull(row.brand),
    quantity: asNumber(row.quantity),
    unit: asUnion(row.unit, SERVING_UNITS, 'g'),
    servingLabel: asText(row.serving_label),
    gramsTotal: asNumber(row.grams_total),
    macros: rowToMacros(row),
    photoUri: textOrNull(row.photo_uri),
    source: asUnion(row.source, FOOD_SOURCES, 'custom'),
    visionConfidence: row.vision_confidence === null ? null : asNumber(row.vision_confidence),
    wasEdited: intToBool(row.was_edited),
    loggedAt: asText(row.logged_at),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

export function foodEntryToRow(entry: FoodEntry): FoodEntryRow {
  const macros = macrosToColumns(entry.macros);
  return {
    id: entry.id,
    date: entry.date,
    meal_type: entry.mealType,
    food_id: textOrNull(entry.foodId),
    name: entry.name,
    brand: textOrNull(entry.brand),
    quantity: asNumber(entry.quantity),
    unit: entry.unit,
    serving_label: entry.servingLabel,
    grams_total: asNumber(entry.gramsTotal),
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    fiber: macros.fiber,
    sugar: macros.sugar,
    sodium: macros.sodium,
    photo_uri: textOrNull(entry.photoUri),
    source: entry.source,
    vision_confidence: undefinedToNull(entry.visionConfidence),
    was_edited: boolToInt(entry.wasEdited),
    logged_at: entry.loggedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// exercise entries
// ---------------------------------------------------------------------------

export function rowToExerciseEntry(row: ExerciseEntryRow): ExerciseEntry {
  return {
    id: asText(row.id),
    date: asText(row.date),
    name: asText(row.name),
    category: asUnion<ExerciseCategory>(row.category, EXERCISE_CATEGORIES, 'other'),
    durationMin: asNumber(row.duration_min),
    caloriesBurned: asNumber(row.calories_burned),
    source: asUnion(row.source, ENTRY_SOURCES, 'manual'),
    externalId: textOrNull(row.external_id),
    notes: textOrNull(row.notes),
    loggedAt: asText(row.logged_at),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

export function exerciseEntryToRow(entry: ExerciseEntry): ExerciseEntryRow {
  return {
    id: entry.id,
    date: entry.date,
    name: entry.name,
    category: entry.category,
    duration_min: asNumber(entry.durationMin),
    calories_burned: asNumber(entry.caloriesBurned),
    source: entry.source,
    external_id: textOrNull(entry.externalId),
    notes: textOrNull(entry.notes),
    logged_at: entry.loggedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// weight logs
// ---------------------------------------------------------------------------

export function rowToWeightLog(row: WeightLogRow): WeightLog {
  return {
    id: asText(row.id),
    date: asText(row.date),
    weightKg: asNumber(row.weight_kg),
    bodyFatPct: row.body_fat_pct === null ? null : asNumber(row.body_fat_pct),
    note: textOrNull(row.note),
    source: asUnion(row.source, ENTRY_SOURCES, 'manual'),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at),
  };
}

export function weightLogToRow(log: WeightLog): WeightLogRow {
  return {
    id: log.id,
    date: log.date,
    weight_kg: asNumber(log.weightKg),
    body_fat_pct: undefinedToNull(log.bodyFatPct),
    note: textOrNull(log.note),
    source: log.source,
    created_at: log.createdAt,
    updated_at: log.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Shared repository helpers
// ---------------------------------------------------------------------------

/**
 * Every repository function starts with this: it guarantees migrations have run
 * before the first query so screens can never hit an unmigrated database.
 */
export async function ensureReady(): Promise<Database> {
  await initDatabase();
  return getDb();
}

interface StoreModule {
  useAppStore?: { getState: () => { invalidate?: () => void } };
}

/**
 * Bumps `dataVersion` so screens re-query after a write.
 *
 * The store is required lazily (and defensively) because `@/store/appStore`
 * imports the repositories back — a static import would create a cycle, and a
 * broken store must never reject an otherwise successful write. Both module ids
 * are string literals so Metro can still resolve them statically.
 */
export function invalidateStore(): void {
  let mod: StoreModule | undefined;
  try {
    mod = require('@/store/appStore') as StoreModule;
  } catch {
    try {
      mod = require('../../store/appStore') as StoreModule;
    } catch {
      mod = undefined;
    }
  }

  try {
    mod?.useAppStore?.getState()?.invalidate?.();
  } catch {
    // Store not ready yet (boot, tests, ...) — the write itself still succeeded.
  }
}

/** Escapes LIKE wildcards so user input can never widen the pattern. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Drops `undefined` values from a patch so spreading it over an existing record
 * cannot blank out fields the caller never mentioned.
 */
export function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    const v = value[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Values SQLite can bind. */
export type BindValue = string | number | null;

/** Orders a row object's values to match a column list (SQL bind order). */
export function toBindValues(row: object, columns: readonly string[]): BindValue[] {
  const record = row as Record<string, BindValue | undefined>;
  return columns.map((column) => record[column] ?? null);
}

/** `'?, ?, ?'` for the given column list. */
export function placeholdersFor(columns: readonly string[]): string {
  return columns.map(() => '?').join(', ');
}
