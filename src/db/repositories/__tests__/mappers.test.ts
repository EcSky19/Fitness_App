import {
  escapeLikePattern,
  exerciseEntryToRow,
  foodEntryToRow,
  foodToRow,
  goalToRow,
  macrosToColumns,
  profileToRow,
  rowToExerciseEntry,
  rowToFood,
  rowToFoodEntry,
  rowToGoal,
  rowToMacros,
  rowToProfile,
  rowToWeightLog,
  scaleMacros,
  weightLogToRow,
  type ExerciseEntryRow,
  type FoodEntryRow,
  type FoodRow,
  type GoalRow,
  type ProfileRow,
  type WeightLogRow,
} from '@/db/repositories';
import type {
  ExerciseEntry,
  Food,
  FoodEntry,
  Goal,
  UserProfile,
  WeightLog,
} from '@/types';

const profile: UserProfile = {
  id: 'me',
  name: 'Ada',
  sex: 'female',
  birthDate: '1990-12-10',
  heightCm: 168,
  currentWeightKg: 62.4,
  goalWeightKg: null,
  activityLevel: 'active',
  weightUnit: 'kg',
  heightUnit: 'cm',
  onboardedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const goal: Goal = {
  id: 'goal-1',
  type: 'cut',
  rateKgPerWeek: -0.45,
  macroSplit: 'high_protein',
  targets: { calories: 1900, protein: 160, carbs: 150, fat: 60 },
  isManualOverride: true,
  startedAt: '2026-01-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const food: Food = {
  id: 'food-1',
  name: 'Greek yogurt',
  brand: 'Fage',
  per100g: { calories: 97, protein: 10, carbs: 4, fat: 5, fiber: 0, sugar: 4, sodium: 35 },
  servingSizeG: 170,
  servingLabel: '1 tub (170 g)',
  barcode: '5201054000121',
  source: 'seed',
  isFavorite: true,
  usageCount: 7,
  lastUsedAt: '2026-05-01T09:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T09:00:00.000Z',
};

const entry: FoodEntry = {
  id: 'entry-1',
  date: '2026-05-01',
  mealType: 'breakfast',
  foodId: 'food-1',
  name: 'Greek yogurt',
  brand: 'Fage',
  quantity: 1,
  unit: 'serving',
  servingLabel: '1 tub (170 g)',
  gramsTotal: 170,
  macros: { calories: 165, protein: 17, carbs: 6.8, fat: 8.5 },
  photoUri: null,
  source: 'vision',
  visionConfidence: 0.82,
  wasEdited: false,
  loggedAt: '2026-05-01T08:00:00.000Z',
  createdAt: '2026-05-01T08:00:00.000Z',
  updatedAt: '2026-05-01T08:00:00.000Z',
};

const exercise: ExerciseEntry = {
  id: 'ex-1',
  date: '2026-05-01',
  name: 'Run',
  category: 'cardio',
  durationMin: 32,
  caloriesBurned: 344,
  source: 'healthkit',
  externalId: 'hk-1',
  notes: null,
  loggedAt: '2026-05-01T07:00:00.000Z',
  createdAt: '2026-05-01T07:05:00.000Z',
  updatedAt: '2026-05-01T07:05:00.000Z',
};

const weight: WeightLog = {
  id: 'w-1',
  date: '2026-05-01',
  weightKg: 62.4,
  bodyFatPct: null,
  note: null,
  source: 'manual',
  createdAt: '2026-05-01T06:00:00.000Z',
  updatedAt: '2026-05-01T06:00:00.000Z',
};

describe('mappers', () => {
  it('round-trips the profile', () => {
    const row = profileToRow(profile);
    expect(row.birth_date).toBe('1990-12-10');
    expect(row.goal_weight_kg).toBeNull();
    expect(rowToProfile(row)).toEqual(profile);
  });

  it('round-trips goals with boolean columns', () => {
    const row = goalToRow(goal);
    expect(row.is_active).toBe(1);
    expect(row.is_manual_override).toBe(1);
    expect(row.target_protein).toBe(160);
    expect(rowToGoal(row)).toEqual(goal);
  });

  it('round-trips foods including per-100 g macros', () => {
    const row = foodToRow(food);
    expect(row.calories_per_100g).toBe(97);
    expect(row.sodium_per_100g).toBe(35);
    expect(row.is_favorite).toBe(1);
    expect(rowToFood(row)).toEqual(food);
  });

  it('maps missing optional macros to NULL and back to undefined', () => {
    const row = foodToRow({
      ...food,
      per100g: { calories: 50, protein: 1, carbs: 2, fat: 3 },
    });

    expect(row.fiber_per_100g).toBeNull();
    expect(row.sugar_per_100g).toBeNull();
    expect(row.sodium_per_100g).toBeNull();

    const mapped = rowToFood(row);
    expect(mapped.per100g).toEqual({ calories: 50, protein: 1, carbs: 2, fat: 3 });
    expect('fiber' in mapped.per100g).toBe(false);
    expect(mapped.per100g.sugar).toBeUndefined();
  });

  it('round-trips food entries', () => {
    const row = foodEntryToRow(entry);
    expect(row.meal_type).toBe('breakfast');
    expect(row.grams_total).toBe(170);
    expect(row.vision_confidence).toBe(0.82);
    expect(row.was_edited).toBe(0);
    expect(row.fiber).toBeNull();
    expect(rowToFoodEntry(row)).toEqual(entry);
  });

  it('round-trips exercise entries and weight logs', () => {
    const exerciseRow = exerciseEntryToRow(exercise);
    expect(exerciseRow.duration_min).toBe(32);
    expect(exerciseRow.external_id).toBe('hk-1');
    expect(exerciseRow.notes).toBeNull();
    expect(rowToExerciseEntry(exerciseRow)).toEqual(exercise);

    const weightRow = weightLogToRow(weight);
    expect(weightRow.body_fat_pct).toBeNull();
    expect(rowToWeightLog(weightRow)).toEqual(weight);
  });

  it('falls back to safe values for unknown enum columns', () => {
    const badProfile = { ...profileToRow(profile), sex: 'other', activity_level: 'nope' };
    expect(rowToProfile(badProfile as ProfileRow).sex).toBe('male');
    expect(rowToProfile(badProfile as ProfileRow).activityLevel).toBe('moderate');

    const badGoal = { ...goalToRow(goal), type: 'shred', macro_split: 'atkins' };
    expect(rowToGoal(badGoal as GoalRow).type).toBe('maintain');
    expect(rowToGoal(badGoal as GoalRow).macroSplit).toBe('balanced');

    const badFood = { ...foodToRow(food), source: 'alien' };
    expect(rowToFood(badFood as FoodRow).source).toBe('custom');

    const badEntry = { ...foodEntryToRow(entry), meal_type: 'brunch', unit: 'handful' };
    expect(rowToFoodEntry(badEntry as FoodEntryRow).mealType).toBe('snack');
    expect(rowToFoodEntry(badEntry as FoodEntryRow).unit).toBe('g');

    const badExercise = { ...exerciseEntryToRow(exercise), category: 'chess', source: 'fitbit' };
    expect(rowToExerciseEntry(badExercise as ExerciseEntryRow).category).toBe('other');
    expect(rowToExerciseEntry(badExercise as ExerciseEntryRow).source).toBe('manual');

    const badWeight = { ...weightLogToRow(weight), source: 'guess' };
    expect(rowToWeightLog(badWeight as WeightLogRow).source).toBe('manual');
  });

  it('maps macro columns both ways', () => {
    expect(
      rowToMacros({ calories: 10, protein: 1, carbs: 2, fat: 3, fiber: null, sugar: 4, sodium: null })
    ).toEqual({ calories: 10, protein: 1, carbs: 2, fat: 3, sugar: 4 });

    expect(macrosToColumns({ calories: 10, protein: 1, carbs: 2, fat: 3, fiber: 5 })).toEqual({
      calories: 10,
      protein: 1,
      carbs: 2,
      fat: 3,
      fiber: 5,
      sugar: null,
      sodium: null,
    });

    expect(macrosToColumns(undefined)).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: null,
      sugar: null,
      sodium: null,
    });
  });

  it('scales macros without inventing optional fields', () => {
    expect(scaleMacros({ calories: 300, protein: 20, carbs: 30, fat: 10, fiber: 6 }, 0.5)).toEqual({
      calories: 150,
      protein: 10,
      carbs: 15,
      fat: 5,
      fiber: 3,
    });

    const scaled = scaleMacros({ calories: 100, protein: 3, carbs: 7, fat: 1 }, 1 / 3);
    expect(scaled).toEqual({ calories: 33.33, protein: 1, carbs: 2.33, fat: 0.33 });
    expect('sodium' in scaled).toBe(false);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
    expect(escapeLikePattern('plain')).toBe('plain');
  });
});
