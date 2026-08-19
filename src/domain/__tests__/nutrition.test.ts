import type { ExerciseEntry, FoodEntry, Macros, MacroTargets, MealType } from '@/types';
import { ACTIVITY_MULTIPLIERS, MEAL_TYPES } from '@/types/constants';
import {
  buildDailySummary,
  calcAge,
  calcBMR,
  calcTDEE,
  emptyMacros,
  inferCalories,
  macrosToCalories,
  normalizeMacros,
  scaleMacros,
  sumMacros,
} from '../nutrition';

const DATE = '2025-05-01';

function makeEntry(mealType: MealType, macros: Macros, id = `e-${mealType}`): FoodEntry {
  return {
    id,
    date: DATE,
    mealType,
    foodId: null,
    name: 'Test food',
    brand: null,
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 serving',
    gramsTotal: 100,
    macros,
    photoUri: null,
    source: 'custom',
    visionConfidence: null,
    wasEdited: false,
    loggedAt: `${DATE}T12:00:00.000Z`,
    createdAt: `${DATE}T12:00:00.000Z`,
    updatedAt: `${DATE}T12:00:00.000Z`,
  };
}

function makeExercise(caloriesBurned: number, id = 'x1'): ExerciseEntry {
  return {
    id,
    date: DATE,
    name: 'Running',
    category: 'cardio',
    durationMin: 30,
    caloriesBurned,
    source: 'manual',
    externalId: null,
    notes: null,
    loggedAt: `${DATE}T18:00:00.000Z`,
    createdAt: `${DATE}T18:00:00.000Z`,
    updatedAt: `${DATE}T18:00:00.000Z`,
  };
}

const TARGETS: MacroTargets = { calories: 2000, protein: 150, carbs: 200, fat: 67 };

describe('nutrition — calcAge', () => {
  it('counts whole years, not yet counting an upcoming birthday', () => {
    expect(calcAge('1995-06-15', new Date(2025, 5, 15))).toBe(30);
    expect(calcAge('1995-06-15', new Date(2025, 5, 14))).toBe(29);
    expect(calcAge('1995-06-15', new Date(2025, 6, 1))).toBe(30);
    expect(calcAge('1995-12-31', new Date(2025, 0, 1))).toBe(29);
  });

  it('handles leap-day birthdays and never returns a negative age', () => {
    expect(calcAge('2000-02-29', new Date(2025, 2, 1))).toBe(25);
    expect(calcAge('2030-01-01', new Date(2025, 0, 1))).toBe(0);
    expect(calcAge('garbage', new Date(2025, 0, 1))).toBe(0);
  });
});

describe('nutrition — BMR and TDEE', () => {
  it('matches known Mifflin-St Jeor values', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(calcBMR({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 })).toBeCloseTo(1780, 6);
    // 10*60 + 6.25*165 - 5*30 - 161 = 1320.25
    expect(calcBMR({ sex: 'female', weightKg: 60, heightCm: 165, ageYears: 30 })).toBeCloseTo(
      1320.25,
      6,
    );
  });

  it('applies the 166 kcal male/female offset difference', () => {
    const male = calcBMR({ sex: 'male', weightKg: 70, heightCm: 175, ageYears: 40 });
    const female = calcBMR({ sex: 'female', weightKg: 70, heightCm: 175, ageYears: 40 });
    expect(male - female).toBeCloseTo(166, 6);
  });

  it('is NaN safe and never negative', () => {
    expect(calcBMR({ sex: 'male', weightKg: Number.NaN, heightCm: 180, ageYears: 30 })).toBeGreaterThanOrEqual(0);
    expect(calcBMR({ sex: 'female', weightKg: 0, heightCm: 0, ageYears: 200 })).toBe(0);
  });

  it('multiplies BMR by the activity multiplier for every level', () => {
    const bmr = 1780;
    expect(calcTDEE(bmr, 'sedentary')).toBe(Math.round(bmr * 1.2));
    expect(calcTDEE(bmr, 'light')).toBe(Math.round(bmr * 1.375));
    expect(calcTDEE(bmr, 'moderate')).toBe(Math.round(bmr * 1.55));
    expect(calcTDEE(bmr, 'active')).toBe(Math.round(bmr * 1.725));
    expect(calcTDEE(bmr, 'very_active')).toBe(Math.round(bmr * 1.9));
    expect(calcTDEE(bmr, 'sedentary')).toBe(2136);
    expect(calcTDEE(bmr, 'moderate')).toBe(2759);
  });

  it('increases monotonically with the activity level', () => {
    const values = (Object.keys(ACTIVITY_MULTIPLIERS) as (keyof typeof ACTIVITY_MULTIPLIERS)[]).map(
      (level) => calcTDEE(1500, level),
    );
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
    expect(calcTDEE(Number.NaN, 'moderate')).toBe(0);
  });
});

describe('nutrition — macro arithmetic', () => {
  it('creates a fresh zeroed object', () => {
    expect(emptyMacros()).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    const a = emptyMacros();
    a.calories = 100;
    expect(emptyMacros().calories).toBe(0);
  });

  it('sums a list element-wise', () => {
    expect(
      sumMacros([
        { calories: 100, protein: 10, carbs: 5, fat: 2 },
        { calories: 50, protein: 5, carbs: 2.5, fat: 1 },
      ]),
    ).toEqual({ calories: 150, protein: 15, carbs: 7.5, fat: 3 });
    expect(sumMacros([])).toEqual(emptyMacros());
  });

  it('aggregates optional fields only when at least one input has them', () => {
    const withFiber = sumMacros([
      { calories: 100, protein: 10, carbs: 5, fat: 2, fiber: 3, sodium: 120 },
      { calories: 50, protein: 5, carbs: 2, fat: 1 },
    ]);
    expect(withFiber.fiber).toBe(3);
    expect(withFiber.sodium).toBe(120);
    expect(withFiber.sugar).toBeUndefined();

    const plain = sumMacros([{ calories: 100, protein: 10, carbs: 5, fat: 2 }]);
    expect(plain.fiber).toBeUndefined();
  });

  it('scales per-100 g nutrition and round-trips the factor', () => {
    const per100g: Macros = {
      calories: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2,
      fiber: 2.4,
      sugar: 10.4,
      sodium: 1,
    };

    expect(scaleMacros(per100g, 100)).toEqual(per100g);

    const scaled = scaleMacros(per100g, 250);
    expect(scaled.calories).toBeCloseTo(52 * 2.5, 6);
    expect(scaled.protein).toBeCloseTo(0.3 * 2.5, 6);
    expect(scaled.carbs).toBeCloseTo(14 * 2.5, 6);
    expect(scaled.fat).toBeCloseTo(0.2 * 2.5, 6);
    // optional fields survive the scaling
    expect(scaled.fiber).toBeCloseTo(2.4 * 2.5, 6);
    expect(scaled.sugar).toBeCloseTo(10.4 * 2.5, 6);
    expect(scaled.sodium).toBeCloseTo(1 * 2.5, 6);
  });

  it('does not invent optional fields and handles degenerate grams', () => {
    const per100g: Macros = { calories: 200, protein: 20, carbs: 10, fat: 8 };
    expect(scaleMacros(per100g, 50)).toEqual({ calories: 100, protein: 10, carbs: 5, fat: 4 });
    expect(scaleMacros(per100g, 0)).toEqual(emptyMacros());
    expect(scaleMacros(per100g, -100)).toEqual(emptyMacros());
    expect(scaleMacros(per100g, Number.NaN)).toEqual(emptyMacros());
    expect(scaleMacros(per100g, 250).fiber).toBeUndefined();
  });

  it('derives calories with the 4/4/9 factors', () => {
    expect(macrosToCalories({ protein: 30, carbs: 40, fat: 10 })).toBe(30 * 4 + 40 * 4 + 10 * 9);
    expect(macrosToCalories({ protein: 0, carbs: 0, fat: 0 })).toBe(0);
    expect(inferCalories(30, 40, 10)).toBe(370);
    expect(inferCalories(10.4, 0, 0)).toBe(42);
    expect(inferCalories(Number.NaN, -5, 10)).toBe(90);
  });

  it('normalizes partial macros', () => {
    expect(normalizeMacros({})).toEqual(emptyMacros());
    expect(normalizeMacros({ calories: 100 })).toEqual({
      calories: 100,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    expect(normalizeMacros({ calories: -50, protein: -1, carbs: 5, fat: 2 })).toEqual({
      calories: 0,
      protein: 0,
      carbs: 5,
      fat: 2,
    });
    expect(normalizeMacros({ calories: Number.NaN, fiber: 4 })).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 4,
    });
  });
});

describe('nutrition — buildDailySummary', () => {
  it('handles a completely empty day', () => {
    const summary = buildDailySummary({
      date: DATE,
      entries: [],
      exercises: [],
      targets: TARGETS,
    });

    expect(summary.date).toBe(DATE);
    expect(summary.consumed).toEqual(emptyMacros());
    expect(summary.entryCount).toBe(0);
    expect(summary.exerciseBurned).toBe(0);
    expect(summary.netCalories).toBe(0);
    expect(summary.remainingCalories).toBe(TARGETS.calories);
    expect(summary.targets).toEqual(TARGETS);
    for (const meal of MEAL_TYPES) {
      expect(summary.byMeal[meal]).toEqual(emptyMacros());
    }
  });

  it('always exposes all four meal keys, zero-filled', () => {
    const summary = buildDailySummary({
      date: DATE,
      entries: [makeEntry('breakfast', { calories: 400, protein: 30, carbs: 40, fat: 12 })],
      exercises: [],
      targets: TARGETS,
    });

    expect(Object.keys(summary.byMeal).sort()).toEqual([...MEAL_TYPES].sort());
    expect(summary.byMeal.breakfast.calories).toBe(400);
    expect(summary.byMeal.lunch).toEqual(emptyMacros());
    expect(summary.byMeal.dinner).toEqual(emptyMacros());
    expect(summary.byMeal.snack).toEqual(emptyMacros());
  });

  it('groups entries across all four meals and sums the totals', () => {
    const entries = [
      makeEntry('breakfast', { calories: 400, protein: 30, carbs: 40, fat: 12 }, 'b1'),
      makeEntry('lunch', { calories: 600, protein: 45, carbs: 60, fat: 18 }, 'l1'),
      makeEntry('dinner', { calories: 700, protein: 50, carbs: 70, fat: 20 }, 'd1'),
      makeEntry('snack', { calories: 200, protein: 10, carbs: 25, fat: 6 }, 's1'),
      makeEntry('snack', { calories: 100, protein: 5, carbs: 12, fat: 3 }, 's2'),
    ];

    const summary = buildDailySummary({ date: DATE, entries, exercises: [], targets: TARGETS });

    expect(summary.entryCount).toBe(5);
    expect(summary.consumed.calories).toBe(2000);
    expect(summary.consumed.protein).toBe(140);
    expect(summary.consumed.carbs).toBe(207);
    expect(summary.consumed.fat).toBe(59);
    expect(summary.byMeal.snack).toEqual({ calories: 300, protein: 15, carbs: 37, fat: 9 });
    expect(summary.remainingCalories).toBe(0);
  });

  it('keeps exercise out of the target unless addExerciseToTarget is set', () => {
    const entries = [makeEntry('lunch', { calories: 1500, protein: 100, carbs: 150, fat: 50 })];
    const exercises = [makeExercise(200, 'x1'), makeExercise(100, 'x2')];

    const off = buildDailySummary({
      date: DATE,
      entries,
      exercises,
      targets: TARGETS,
      addExerciseToTarget: false,
    });
    expect(off.exerciseBurned).toBe(300);
    expect(off.netCalories).toBe(1200);
    expect(off.remainingCalories).toBe(500);

    const on = buildDailySummary({
      date: DATE,
      entries,
      exercises,
      targets: TARGETS,
      addExerciseToTarget: true,
    });
    expect(on.exerciseBurned).toBe(300);
    expect(on.netCalories).toBe(1200);
    expect(on.remainingCalories).toBe(800);

    const omitted = buildDailySummary({ date: DATE, entries, exercises, targets: TARGETS });
    expect(omitted.remainingCalories).toBe(500);
  });

  it('reports a negative remaining budget when over target', () => {
    const summary = buildDailySummary({
      date: DATE,
      entries: [makeEntry('dinner', { calories: 2500, protein: 100, carbs: 300, fat: 90 })],
      exercises: [],
      targets: TARGETS,
    });
    expect(summary.remainingCalories).toBe(-500);
    expect(summary.netCalories).toBe(2500);
  });
});
