/**
 * Nutrition math: age, BMR/TDEE, macro arithmetic and the daily rollup.
 *
 * Pure TypeScript: no React Native, no Expo, no I/O.
 *
 * Optional macro fields (`fiber`, `sugar`, `sodium`) are *preserved, never
 * invented*: they stay `undefined` unless at least one input actually provided
 * them. Required fields always exist and are never negative.
 */
import { ACTIVITY_MULTIPLIERS, MEAL_TYPES } from '@/types/constants';
import type {
  ActivityLevel,
  DailySummary,
  ExerciseEntry,
  FoodEntry,
  ISODate,
  Macros,
  MacroTargets,
  MealType,
  Sex,
} from '@/types';
import { isoToDate } from './dates';
import { roundTo, toFiniteNumber } from './units';

/** kcal per gram of each macronutrient (Atwater factors). */
export const KCAL_PER_G_PROTEIN = 4;
export const KCAL_PER_G_CARBS = 4;
export const KCAL_PER_G_FAT = 9;

const OPTIONAL_MACRO_KEYS = ['fiber', 'sugar', 'sodium'] as const;
type OptionalMacroKey = (typeof OPTIONAL_MACRO_KEYS)[number];

/** Non-negative finite number, `0` for anything unusable. */
function nonNegative(value: unknown): number {
  return Math.max(0, toFiniteNumber(value));
}

/** Whole years between `birthDate` and `at` (default: now). Never negative. */
export function calcAge(birthDate: ISODate, at: Date = new Date()): number {
  const born = isoToDate(birthDate);
  const ref = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();
  let age = ref.getFullYear() - born.getFullYear();
  const monthDelta = ref.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && ref.getDate() < born.getDate())) {
    age -= 1;
  }
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}

/**
 * Mifflin-St Jeor basal metabolic rate (kcal/day), unrounded.
 * `10 * kg + 6.25 * cm - 5 * age + (male ? +5 : -161)`
 */
export function calcBMR(a: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): number {
  const weightKg = nonNegative(a?.weightKg);
  const heightCm = nonNegative(a?.heightCm);
  const ageYears = nonNegative(a?.ageYears);
  const sexOffset = a?.sex === 'male' ? 5 : -161;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + sexOffset;
  return Math.max(0, bmr);
}

/** Total daily energy expenditure (kcal/day), rounded to a whole kcal. */
export function calcTDEE(bmr: number, level: ActivityLevel): number {
  const base = nonNegative(bmr);
  const multiplier = ACTIVITY_MULTIPLIERS[level] ?? ACTIVITY_MULTIPLIERS.sedentary;
  return Math.round(base * multiplier);
}

/** A fresh all-zero macro object (required fields only). */
export function emptyMacros(): Macros {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

/** Element-wise sum. Optional keys appear only when present on at least one input. */
export function sumMacros(list: Macros[]): Macros {
  const items = Array.isArray(list) ? list : [];
  const total = emptyMacros();
  const optionalTotals: Partial<Record<OptionalMacroKey, number>> = {};

  for (const item of items) {
    if (!item) continue;
    total.calories += toFiniteNumber(item.calories);
    total.protein += toFiniteNumber(item.protein);
    total.carbs += toFiniteNumber(item.carbs);
    total.fat += toFiniteNumber(item.fat);
    for (const key of OPTIONAL_MACRO_KEYS) {
      if (item[key] === undefined || item[key] === null) continue;
      optionalTotals[key] = (optionalTotals[key] ?? 0) + toFiniteNumber(item[key]);
    }
  }

  const out: Macros = {
    calories: roundTo(Math.max(0, total.calories), 2),
    protein: roundTo(Math.max(0, total.protein), 2),
    carbs: roundTo(Math.max(0, total.carbs), 2),
    fat: roundTo(Math.max(0, total.fat), 2),
  };
  for (const key of OPTIONAL_MACRO_KEYS) {
    const value = optionalTotals[key];
    if (value !== undefined) out[key] = roundTo(Math.max(0, value), 2);
  }
  return out;
}

/** Scale per-100 g nutrition to an absolute gram amount. Values rounded to 2 dp. */
export function scaleMacros(per100g: Macros, grams: number): Macros {
  const factor = nonNegative(grams) / 100;
  const source = per100g ?? emptyMacros();
  const out: Macros = {
    calories: roundTo(nonNegative(source.calories) * factor, 2),
    protein: roundTo(nonNegative(source.protein) * factor, 2),
    carbs: roundTo(nonNegative(source.carbs) * factor, 2),
    fat: roundTo(nonNegative(source.fat) * factor, 2),
  };
  for (const key of OPTIONAL_MACRO_KEYS) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    out[key] = roundTo(nonNegative(value) * factor, 2);
  }
  return out;
}

/** Energy implied by the macros (4/4/9), unrounded. */
export function macrosToCalories(m: {
  protein: number;
  carbs: number;
  fat: number;
}): number {
  return (
    nonNegative(m?.protein) * KCAL_PER_G_PROTEIN +
    nonNegative(m?.carbs) * KCAL_PER_G_CARBS +
    nonNegative(m?.fat) * KCAL_PER_G_FAT
  );
}

/** Same as {@link macrosToCalories} but rounded — for filling in a missing calorie field. */
export function inferCalories(protein: number, carbs: number, fat: number): number {
  return Math.round(macrosToCalories({ protein, carbs, fat }));
}

/** Fill missing required fields with `0` and clamp negatives to `0`. */
export function normalizeMacros(m: Partial<Macros>): Macros {
  const source = m ?? {};
  const out: Macros = {
    calories: roundTo(nonNegative(source.calories), 2),
    protein: roundTo(nonNegative(source.protein), 2),
    carbs: roundTo(nonNegative(source.carbs), 2),
    fat: roundTo(nonNegative(source.fat), 2),
  };
  for (const key of OPTIONAL_MACRO_KEYS) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    out[key] = roundTo(nonNegative(value), 2);
  }
  return out;
}

/** Zero-filled record containing every meal key. */
function emptyByMeal(): Record<MealType, Macros> {
  const byMeal = {} as Record<MealType, Macros>;
  for (const meal of MEAL_TYPES) byMeal[meal] = emptyMacros();
  return byMeal;
}

/**
 * Roll a day's food + exercise entries into the summary the UI renders.
 *
 * `remainingCalories = targets.calories - consumed.calories + (addExerciseToTarget ? burned : 0)`
 * so exercise only "buys back" calories when the setting is enabled.
 */
export function buildDailySummary(a: {
  date: ISODate;
  entries: FoodEntry[];
  exercises: ExerciseEntry[];
  targets: MacroTargets;
  addExerciseToTarget?: boolean;
}): DailySummary {
  const entries = Array.isArray(a?.entries) ? a.entries.filter(Boolean) : [];
  const exercises = Array.isArray(a?.exercises) ? a.exercises.filter(Boolean) : [];
  const targets: MacroTargets = {
    calories: nonNegative(a?.targets?.calories),
    protein: nonNegative(a?.targets?.protein),
    carbs: nonNegative(a?.targets?.carbs),
    fat: nonNegative(a?.targets?.fat),
  };

  const consumed = sumMacros(entries.map((e) => e.macros ?? emptyMacros()));

  const grouped: Record<MealType, Macros[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const entry of entries) {
    const meal: MealType = MEAL_TYPES.includes(entry.mealType) ? entry.mealType : 'snack';
    grouped[meal].push(entry.macros ?? emptyMacros());
  }
  const byMeal = emptyByMeal();
  for (const meal of MEAL_TYPES) byMeal[meal] = sumMacros(grouped[meal]);

  const exerciseBurned = roundTo(
    exercises.reduce((sum, e) => sum + nonNegative(e.caloriesBurned), 0),
    2,
  );

  const netCalories = Math.round(consumed.calories - exerciseBurned);
  const remainingCalories = Math.round(
    targets.calories - consumed.calories + (a?.addExerciseToTarget ? exerciseBurned : 0),
  );

  return {
    date: a?.date,
    consumed,
    byMeal,
    exerciseBurned,
    targets,
    netCalories,
    remainingCalories,
    entryCount: entries.length,
  };
}
