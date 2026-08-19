import type { MacroSplitPreset, UserProfile } from '@/types';
import { KCAL_PER_KG_FAT } from '@/types/constants';
import {
  MACRO_SPLITS,
  MIN_CALORIES_FEMALE,
  MIN_CALORIES_MALE,
  PROTEIN_FLOOR_G_PER_KG,
  PROTEIN_FLOOR_HIGH_PROTEIN_G_PER_KG,
  buildTargetsForProfile,
  calcCalorieTarget,
  calcMacroTargets,
  describeGoal,
  rateBounds,
  suggestRateKgPerWeek,
} from '../goals';
import { calcAge, calcBMR, calcTDEE, macrosToCalories } from '../nutrition';

const PRESETS: MacroSplitPreset[] = ['balanced', 'high_protein', 'low_carb', 'keto', 'custom'];

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'u1',
    name: 'Test User',
    sex: 'male',
    birthDate: '1995-06-15',
    heightCm: 180,
    currentWeightKg: 80,
    goalWeightKg: 75,
    activityLevel: 'moderate',
    weightUnit: 'kg',
    heightUnit: 'cm',
    onboardedAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('goals — MACRO_SPLITS', () => {
  it('defines every preset with fractions summing to 1', () => {
    for (const preset of PRESETS) {
      const split = MACRO_SPLITS[preset];
      expect(split).toBeDefined();
      expect(split.protein + split.carbs + split.fat).toBeCloseTo(1, 10);
      expect(split.protein).toBeGreaterThan(0);
      expect(split.carbs).toBeGreaterThanOrEqual(0);
      expect(split.fat).toBeGreaterThan(0);
    }
  });

  it('uses the documented fractions', () => {
    expect(MACRO_SPLITS.balanced).toEqual({ protein: 0.3, carbs: 0.4, fat: 0.3 });
    expect(MACRO_SPLITS.high_protein).toEqual({ protein: 0.4, carbs: 0.35, fat: 0.25 });
    expect(MACRO_SPLITS.low_carb).toEqual({ protein: 0.35, carbs: 0.2, fat: 0.45 });
    expect(MACRO_SPLITS.keto).toEqual({ protein: 0.25, carbs: 0.05, fat: 0.7 });
    expect(MACRO_SPLITS.custom).toEqual(MACRO_SPLITS.balanced);
  });
});

describe('goals — calcCalorieTarget', () => {
  it('applies a deficit for a cut', () => {
    // 0.5 kg/week * 7700 / 7 = 550 kcal/day
    expect(calcCalorieTarget({ tdee: 2500, goalType: 'cut', rateKgPerWeek: -0.5, sex: 'male' })).toBe(
      1950,
    );
    expect((0.5 * KCAL_PER_KG_FAT) / 7).toBe(550);
  });

  it('leaves maintenance untouched and ignores a stray rate', () => {
    expect(calcCalorieTarget({ tdee: 2500, goalType: 'maintain', rateKgPerWeek: 0 })).toBe(2500);
    expect(calcCalorieTarget({ tdee: 2500, goalType: 'maintain', rateKgPerWeek: -0.5 })).toBe(2500);
    expect(calcCalorieTarget({ tdee: 2503, goalType: 'maintain', rateKgPerWeek: 0 })).toBe(2500);
  });

  it('applies a surplus for a bulk and rounds to the nearest 10', () => {
    // 0.25 kg/week -> +275 kcal -> 2775 -> 2780
    expect(calcCalorieTarget({ tdee: 2500, goalType: 'bulk', rateKgPerWeek: 0.25 })).toBe(2780);
    expect(calcCalorieTarget({ tdee: 2500, goalType: 'bulk', rateKgPerWeek: 0.5 })).toBe(3050);
  });

  it('is sign-agnostic — goalType decides the direction', () => {
    const negative = calcCalorieTarget({ tdee: 2500, goalType: 'cut', rateKgPerWeek: -0.5 });
    const positive = calcCalorieTarget({ tdee: 2500, goalType: 'cut', rateKgPerWeek: 0.5 });
    expect(positive).toBe(negative);
    expect(calcCalorieTarget({ tdee: 2500, goalType: 'bulk', rateKgPerWeek: -0.25 })).toBe(2780);
  });

  it('engages the safety floor for an aggressive cut on a small sedentary person', () => {
    // A small sedentary woman: TDEE 1400, 1 kg/week deficit would be 300 kcal.
    expect(calcCalorieTarget({ tdee: 1400, goalType: 'cut', rateKgPerWeek: -1, sex: 'female' })).toBe(
      MIN_CALORIES_FEMALE,
    );
    expect(calcCalorieTarget({ tdee: 1600, goalType: 'cut', rateKgPerWeek: -1, sex: 'male' })).toBe(
      MIN_CALORIES_MALE,
    );
    // No sex supplied -> the more conservative 1200 floor.
    expect(calcCalorieTarget({ tdee: 1400, goalType: 'cut', rateKgPerWeek: -1 })).toBe(1200);
  });

  it('always returns a safe, rounded, finite number', () => {
    for (const tdee of [0, Number.NaN, -500, 1200, 4000]) {
      for (const rate of [0, 0.5, 1, Number.NaN]) {
        const value = calcCalorieTarget({ tdee, goalType: 'cut', rateKgPerWeek: rate });
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(MIN_CALORIES_FEMALE);
        expect(value % 10).toBe(0);
      }
    }
  });
});

describe('goals — calcMacroTargets', () => {
  it('re-derives to within 2% of the calorie target for every preset', () => {
    for (const preset of PRESETS) {
      for (const calories of [1200, 1500, 1800, 2000, 2350, 2500, 3000, 4000]) {
        const targets = calcMacroTargets(calories, preset);
        expect(targets.calories).toBe(calories);
        const derived = macrosToCalories(targets);
        expect(Math.abs(derived - calories)).toBeLessThanOrEqual(calories * 0.02);
        expect(targets.protein).toBeGreaterThanOrEqual(0);
        expect(targets.carbs).toBeGreaterThanOrEqual(0);
        expect(targets.fat).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(targets.protein)).toBe(true);
        expect(Number.isInteger(targets.carbs)).toBe(true);
        expect(Number.isInteger(targets.fat)).toBe(true);
      }
    }
  });

  it('honours the split ratios when no protein floor is requested', () => {
    const balanced = calcMacroTargets(2000, 'balanced');
    expect(balanced.protein).toBe(150); // 600 kcal / 4
    expect(balanced.carbs).toBe(200); // 800 kcal / 4
    expect(balanced.fat).toBe(67); // 600 kcal / 9
  });

  it('produces very low carbs for keto', () => {
    const keto = calcMacroTargets(2000, 'keto');
    expect(keto.carbs).toBeLessThan(30);
    expect(keto.fat * 9).toBeGreaterThan(2000 * 0.6);
    expect(calcMacroTargets(2000, 'keto', { weightKg: 80 }).carbs).toBeLessThan(30);
  });

  it('enforces the 1.6 g/kg protein floor and rebalances the rest', () => {
    const targets = calcMacroTargets(2000, 'balanced', { weightKg: 100 });
    expect(targets.protein).toBeGreaterThanOrEqual(160); // 1.6 * 100
    // Leftover calories still respect the carbs:fat ratio (0.4 : 0.3).
    const leftover = 2000 - targets.protein * 4;
    expect(targets.carbs * 4).toBeCloseTo(leftover * (0.4 / 0.7), -1);
    expect(Math.abs(macrosToCalories(targets) - 2000)).toBeLessThanOrEqual(40);
  });

  it('enforces the 2.2 g/kg protein floor for high_protein', () => {
    const targets = calcMacroTargets(2000, 'high_protein', { weightKg: 100 });
    expect(targets.protein).toBeGreaterThanOrEqual(220);
    expect(Math.abs(macrosToCalories(targets) - 2000)).toBeLessThanOrEqual(40);
  });

  it('applies the floor for every preset and weight without going negative', () => {
    for (const preset of PRESETS) {
      for (const weightKg of [45, 60, 77, 90, 120]) {
        for (const calories of [1200, 1600, 2200, 3000]) {
          const targets = calcMacroTargets(calories, preset, { weightKg });
          const perKg =
            preset === 'high_protein'
              ? PROTEIN_FLOOR_HIGH_PROTEIN_G_PER_KG
              : PROTEIN_FLOOR_G_PER_KG;
          const floorG = Math.min(weightKg * perKg, calories / 4);
          expect(targets.protein).toBeGreaterThanOrEqual(Math.floor(floorG));
          expect(targets.carbs).toBeGreaterThanOrEqual(0);
          expect(targets.fat).toBeGreaterThanOrEqual(0);
          expect(Math.abs(macrosToCalories(targets) - calories)).toBeLessThanOrEqual(
            calories * 0.02,
          );
        }
      }
    }
  });

  it('never goes negative when the protein floor exceeds the whole budget', () => {
    const targets = calcMacroTargets(800, 'balanced', { weightKg: 200 });
    expect(targets.protein).toBe(200); // capped at 800 / 4
    expect(targets.carbs).toBe(0);
    expect(targets.fat).toBe(0);
    expect(macrosToCalories(targets)).toBe(800);
  });

  it('handles zero / invalid calories', () => {
    expect(calcMacroTargets(0, 'balanced')).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    expect(calcMacroTargets(Number.NaN, 'keto')).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    expect(calcMacroTargets(-500, 'balanced')).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe('goals — buildTargetsForProfile', () => {
  it('wires profile -> age -> BMR -> TDEE -> calories -> macros', () => {
    const profile = makeProfile();
    const expectedCalories = calcCalorieTarget({
      tdee: calcTDEE(
        calcBMR({
          sex: profile.sex,
          weightKg: profile.currentWeightKg,
          heightCm: profile.heightCm,
          ageYears: calcAge(profile.birthDate),
        }),
        profile.activityLevel,
      ),
      goalType: 'cut',
      rateKgPerWeek: -0.5,
      sex: profile.sex,
    });

    const targets = buildTargetsForProfile(profile, 'cut', -0.5, 'balanced');
    expect(targets.calories).toBe(expectedCalories);
    expect(targets.calories).toBeGreaterThanOrEqual(MIN_CALORIES_MALE);
    expect(targets.protein).toBeGreaterThanOrEqual(profile.currentWeightKg * 1.6 - 1);
    expect(Math.abs(macrosToCalories(targets) - targets.calories)).toBeLessThanOrEqual(
      targets.calories * 0.02,
    );
  });

  it('orders cut < maintain < bulk for the same profile', () => {
    const profile = makeProfile();
    const cut = buildTargetsForProfile(profile, 'cut', -0.5, 'balanced').calories;
    const maintain = buildTargetsForProfile(profile, 'maintain', 0, 'balanced').calories;
    const bulk = buildTargetsForProfile(profile, 'bulk', 0.25, 'balanced').calories;
    expect(cut).toBeLessThan(maintain);
    expect(maintain).toBeLessThan(bulk);
  });

  it('stays safe for a tiny sedentary profile on an aggressive cut', () => {
    const profile = makeProfile({
      sex: 'female',
      currentWeightKg: 48,
      heightCm: 155,
      activityLevel: 'sedentary',
    });
    const targets = buildTargetsForProfile(profile, 'cut', -1, 'balanced');
    expect(targets.calories).toBeGreaterThanOrEqual(MIN_CALORIES_FEMALE);
    expect(targets.carbs).toBeGreaterThanOrEqual(0);
    expect(targets.fat).toBeGreaterThanOrEqual(0);
  });
});

describe('goals — rate helpers', () => {
  it('suggests a default weekly rate per goal type', () => {
    expect(suggestRateKgPerWeek('cut')).toBe(-0.5);
    expect(suggestRateKgPerWeek('maintain')).toBe(0);
    expect(suggestRateKgPerWeek('bulk')).toBe(0.25);
  });

  it('bounds the rate slider, and the suggestion always sits inside the bounds', () => {
    for (const goalType of ['cut', 'maintain', 'bulk'] as const) {
      const bounds = rateBounds(goalType);
      expect(bounds.min).toBeLessThanOrEqual(bounds.max);
      expect(bounds.step).toBeGreaterThanOrEqual(0);
      const suggestion = suggestRateKgPerWeek(goalType);
      expect(suggestion).toBeGreaterThanOrEqual(bounds.min);
      expect(suggestion).toBeLessThanOrEqual(bounds.max);
    }
    expect(rateBounds('cut').max).toBeLessThan(0);
    expect(rateBounds('bulk').min).toBeGreaterThan(0);
  });

  it('describes a goal in the user weight unit', () => {
    expect(describeGoal('cut', -0.45359237, 'lb')).toBe('Lose 1.0 lb per week');
    expect(describeGoal('cut', -0.5, 'kg')).toBe('Lose 0.5 kg per week');
    expect(describeGoal('cut', 0.5, 'kg')).toBe('Lose 0.5 kg per week');
    expect(describeGoal('bulk', 0.25, 'kg')).toBe('Gain 0.3 kg per week');
    expect(describeGoal('bulk', 0.45359237, 'lb')).toBe('Gain 1.0 lb per week');
    expect(describeGoal('maintain', 0, 'kg')).toBe('Maintain weight');
    expect(describeGoal('cut', 0, 'kg')).toBe('Maintain weight');
    expect(describeGoal('cut', Number.NaN, 'lb')).toBe('Maintain weight');
  });
});
