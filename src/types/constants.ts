/**
 * Shared constants derived from the type contract in `./index.ts`.
 * Keep in sync with the union types — these arrays are the canonical iteration
 * order used by the UI.
 */
import type { ActivityLevel, ExerciseCategory, GoalType, MealType } from './index';

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

export const ACTIVITY_LEVELS: ActivityLevel[] = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
];

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (little or no exercise)',
  light: 'Lightly active (1-3 days/week)',
  moderate: 'Moderately active (3-5 days/week)',
  active: 'Very active (6-7 days/week)',
  very_active: 'Extra active (physical job or 2x/day)',
};

/** Multipliers applied to BMR to obtain TDEE. */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const GOAL_TYPES: GoalType[] = ['cut', 'maintain', 'bulk'];

export const GOAL_LABELS: Record<GoalType, string> = {
  cut: 'Lose weight',
  maintain: 'Maintain weight',
  bulk: 'Gain weight',
};

/** Energy in one kilogram of body fat. */
export const KCAL_PER_KG_FAT = 7700;

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export const EXERCISE_CATEGORIES: ExerciseCategory[] = [
  'cardio',
  'strength',
  'sports',
  'flexibility',
  'other',
];

export const EXERCISE_CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  cardio: 'Cardio',
  strength: 'Strength',
  sports: 'Sports',
  flexibility: 'Flexibility',
  other: 'Other',
};
