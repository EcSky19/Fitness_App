/**
 * Goal + macro target planning.
 *
 * Pure TypeScript: no React Native, no Expo, no I/O.
 */
import { GOAL_LABELS, KCAL_PER_KG_FAT } from '@/types/constants';
import type {
  GoalType,
  MacroSplitPreset,
  MacroTargets,
  Sex,
  UserProfile,
  WeightUnit,
} from '@/types';
import { calcAge, calcBMR, calcTDEE, macrosToCalories } from './nutrition';
import { roundTo, toDisplayWeight, toFiniteNumber } from './units';

/** Fraction of total calories per macro. Each preset sums to 1. */
export const MACRO_SPLITS: Record<
  MacroSplitPreset,
  { protein: number; carbs: number; fat: number }
> = {
  balanced: { protein: 0.3, carbs: 0.4, fat: 0.3 },
  high_protein: { protein: 0.4, carbs: 0.35, fat: 0.25 },
  low_carb: { protein: 0.35, carbs: 0.2, fat: 0.45 },
  keto: { protein: 0.25, carbs: 0.05, fat: 0.7 },
  /** `custom` defaults to `balanced` until the user overrides the targets. */
  custom: { protein: 0.3, carbs: 0.4, fat: 0.3 },
};

export const MACRO_SPLIT_LABELS: Record<MacroSplitPreset, string> = {
  balanced: 'Balanced',
  high_protein: 'High protein',
  low_carb: 'Low carb',
  keto: 'Keto',
  custom: 'Custom',
};

/** Safety floors — a target is never allowed below these values. */
export const MIN_CALORIES_FEMALE = 1200;
export const MIN_CALORIES_MALE = 1500;

/** Protein floors in g per kg of bodyweight. */
export const PROTEIN_FLOOR_G_PER_KG = 1.6;
export const PROTEIN_FLOOR_HIGH_PROTEIN_G_PER_KG = 2.2;

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/**
 * Daily calorie target for a goal.
 *
 * `deficit/surplus = rateKgPerWeek * KCAL_PER_KG_FAT / 7`. The sign is derived
 * from `goalType`, so callers may pass the rate as either `-0.5` or `0.5` for a
 * cut. A safety floor (1500 male / 1200 otherwise) is applied, then the result
 * is rounded to the nearest 10 kcal.
 */
export function calcCalorieTarget(a: {
  tdee: number;
  goalType: GoalType;
  rateKgPerWeek: number;
  sex?: Sex;
}): number {
  const tdee = Math.max(0, toFiniteNumber(a?.tdee));
  const rate = Math.abs(toFiniteNumber(a?.rateKgPerWeek));

  let signedRate = 0;
  if (a?.goalType === 'cut') signedRate = -rate;
  else if (a?.goalType === 'bulk') signedRate = rate;

  const adjustment = (signedRate * KCAL_PER_KG_FAT) / 7;
  const floor = a?.sex === 'male' ? MIN_CALORIES_MALE : MIN_CALORIES_FEMALE;
  const target = Math.max(tdee + adjustment, floor);
  return Math.round(target / 10) * 10;
}

/**
 * Split a calorie target into whole grams of protein / carbs / fat.
 *
 * When `opts.weightKg` is supplied a protein floor is enforced
 * (1.6 g/kg, 2.2 g/kg for `high_protein`) and the leftover calories are
 * redistributed between carbs and fat by their relative split ratio. Grams are
 * never negative and the macros re-derive to within a few kcal of the target.
 */
export function calcMacroTargets(
  calories: number,
  split: MacroSplitPreset,
  opts?: { weightKg?: number },
): MacroTargets {
  const target = Math.max(0, Math.round(toFiniteNumber(calories)));
  if (target <= 0) return { calories: 0, protein: 0, carbs: 0, fat: 0 };

  const ratios = MACRO_SPLITS[split] ?? MACRO_SPLITS.balanced;

  let proteinG = (target * ratios.protein) / KCAL_PER_G.protein;
  const weightKg = Math.max(0, toFiniteNumber(opts?.weightKg));
  if (weightKg > 0) {
    const perKg =
      split === 'high_protein' ? PROTEIN_FLOOR_HIGH_PROTEIN_G_PER_KG : PROTEIN_FLOOR_G_PER_KG;
    proteinG = Math.max(proteinG, weightKg * perKg);
  }
  // Protein alone can never exceed the calorie budget.
  proteinG = Math.min(proteinG, target / KCAL_PER_G.protein);

  const remainingKcal = Math.max(0, target - proteinG * KCAL_PER_G.protein);
  const tailRatio = ratios.carbs + ratios.fat;
  const carbShare = tailRatio > 0 ? ratios.carbs / tailRatio : 0.5;

  let carbsKcal = remainingKcal * carbShare;
  let fatKcal = remainingKcal - carbsKcal;
  if (carbsKcal < 0) {
    fatKcal += carbsKcal;
    carbsKcal = 0;
  }
  if (fatKcal < 0) {
    carbsKcal += fatKcal;
    fatKcal = 0;
  }

  let protein = Math.max(0, Math.round(proteinG));
  let carbs = Math.max(0, Math.round(carbsKcal / KCAL_PER_G.carbs));
  let fat = Math.max(0, Math.round(fatKcal / KCAL_PER_G.fat));

  // Absorb whole-gram rounding drift so the macros still add up to the target.
  const drift = target - macrosToCalories({ protein, carbs, fat });
  if (Math.abs(drift) >= 5) {
    const carbAdjust = Math.round(drift / KCAL_PER_G.carbs);
    if (ratios.carbs > 0 && carbs + carbAdjust >= 0) {
      carbs += carbAdjust;
    } else {
      fat = Math.max(0, fat + Math.round(drift / KCAL_PER_G.fat));
    }
  }

  return { calories: target, protein, carbs, fat };
}

/** Full pipeline: profile -> age -> BMR -> TDEE -> calorie target -> macro grams. */
export function buildTargetsForProfile(
  profile: UserProfile,
  goalType: GoalType,
  rateKgPerWeek: number,
  split: MacroSplitPreset,
): MacroTargets {
  const weightKg = Math.max(0, toFiniteNumber(profile?.currentWeightKg));
  const bmr = calcBMR({
    sex: profile?.sex ?? 'female',
    weightKg,
    heightCm: Math.max(0, toFiniteNumber(profile?.heightCm)),
    ageYears: calcAge(profile?.birthDate),
  });
  const tdee = calcTDEE(bmr, profile?.activityLevel ?? 'sedentary');
  const calories = calcCalorieTarget({
    tdee,
    goalType,
    rateKgPerWeek,
    sex: profile?.sex,
  });
  return calcMacroTargets(calories, split, weightKg > 0 ? { weightKg } : undefined);
}

/** Default weekly rate: cut `-0.5`, maintain `0`, bulk `+0.25` kg/week. */
export function suggestRateKgPerWeek(goalType: GoalType): number {
  if (goalType === 'cut') return -0.5;
  if (goalType === 'bulk') return 0.25;
  return 0;
}

/** Slider bounds (kg/week) for the goal rate picker. */
export function rateBounds(goalType: GoalType): { min: number; max: number; step: number } {
  if (goalType === 'cut') return { min: -1, max: -0.1, step: 0.05 };
  if (goalType === 'bulk') return { min: 0.1, max: 0.5, step: 0.05 };
  return { min: 0, max: 0, step: 0.05 };
}

/** e.g. `describeGoal('cut', -0.45359237, 'lb')` -> `"Lose 1.0 lb per week"`. */
export function describeGoal(
  goalType: GoalType,
  rateKgPerWeek: number,
  unit: WeightUnit,
): string {
  const rate = Math.abs(toFiniteNumber(rateKgPerWeek));
  if (goalType === 'maintain' || rate < 1e-9) return GOAL_LABELS.maintain;
  const displayUnit: WeightUnit = unit === 'lb' ? 'lb' : 'kg';
  const amount = roundTo(toDisplayWeight(rate, displayUnit), 1).toFixed(1);
  const verb = goalType === 'bulk' ? 'Gain' : 'Lose';
  return `${verb} ${amount} ${displayUnit} per week`;
}
