import { act, renderHook } from '@testing-library/react-native';

import { macrosToCalories } from '@/domain';
import type { Goal, UserProfile } from '@/types';

import { computePlan, macroCalorieGap, resolveTargets, useGoalEditor } from '../useGoalEditor';

jest.mock('@/db/repositories', () => ({
  saveGoal: jest.fn(async () => null),
  getActiveGoal: jest.fn(async () => null),
}));

const BIRTH_YEAR = new Date().getFullYear() - 30;

const PROFILE: UserProfile = {
  id: 'me',
  name: 'Alex',
  sex: 'male',
  birthDate: `${BIRTH_YEAR}-06-15`,
  heightCm: 180,
  currentWeightKg: 80,
  goalWeightKg: 75,
  activityLevel: 'moderate',
  weightUnit: 'kg',
  heightUnit: 'cm',
  onboardedAt: '2024-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const type = overrides.type ?? 'maintain';
  const rateKgPerWeek = overrides.rateKgPerWeek ?? 0;
  const macroSplit = overrides.macroSplit ?? 'balanced';
  const plan = computePlan({
    sex: 'male',
    weightKg: 80,
    heightCm: 180,
    ageYears: 30,
    activityLevel: 'moderate',
    goalType: type,
    rateKgPerWeek,
    macroSplit,
  });
  return {
    id: 'goal-1',
    type,
    rateKgPerWeek,
    macroSplit,
    targets: plan.targets,
    isManualOverride: false,
    startedAt: '2024-01-01',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computePlan', () => {
  it('keeps every intermediate value and derives macros from the target', () => {
    const plan = computePlan({
      sex: 'male',
      weightKg: 80,
      heightCm: 180,
      ageYears: 30,
      activityLevel: 'moderate',
      goalType: 'cut',
      rateKgPerWeek: -0.5,
      macroSplit: 'balanced',
    });

    expect(plan.bmr).toBe(1780);
    expect(plan.activityMultiplier).toBe(1.55);
    expect(plan.tdee).toBe(Math.round(1780 * 1.55));
    expect(plan.delta).toBeLessThan(0);
    expect(plan.calories).toBe(plan.tdee + plan.delta);
    expect(plan.belowFloor).toBe(false);
    expect(plan.floor).toBe(1500);
    // Macro grams must reconstruct the calorie target within rounding noise.
    expect(Math.abs(macroCalorieGap(plan.targets))).toBeLessThanOrEqual(plan.calories * 0.02);
  });

  it('never drops a computed target below the safety floor', () => {
    const plan = computePlan({
      sex: 'female',
      weightKg: 45,
      heightCm: 155,
      ageYears: 60,
      activityLevel: 'sedentary',
      goalType: 'cut',
      rateKgPerWeek: -1,
      macroSplit: 'balanced',
    });
    expect(plan.calories).toBeGreaterThanOrEqual(plan.floor);
    expect(plan.belowFloor).toBe(false);
  });
});

describe('resolveTargets', () => {
  it('substitutes only the non-null manual values', () => {
    const computed = { calories: 2000, protein: 150, carbs: 200, fat: 67 };
    expect(resolveTargets(computed, false, { calories: 1, protein: 2, carbs: 3, fat: 4 })).toBe(
      computed
    );
    expect(
      resolveTargets(computed, true, { calories: 1800, protein: null, carbs: null, fat: null })
    ).toEqual({ calories: 1800, protein: 150, carbs: 200, fat: 67 });
  });
});

describe('useGoalEditor', () => {
  it('seeds from the active goal', () => {
    const goal = makeGoal({ type: 'cut', rateKgPerWeek: -0.5 });
    const { result } = renderHook(() => useGoalEditor({ profile: PROFILE, goal }));
    expect(result.current.ready).toBe(true);
    expect(result.current.goalType).toBe('cut');
    expect(result.current.rateKgPerWeek).toBe(-0.5);
    expect(result.current.baseTargets).toEqual(goal.targets);
    expect(result.current.hasChanges).toBe(false);
  });

  it('updates the rate and the targets when the goal type changes', () => {
    const goal = makeGoal();
    const { result } = renderHook(() => useGoalEditor({ profile: PROFILE, goal }));
    const maintainCalories = result.current.targets?.calories ?? 0;

    act(() => result.current.setGoalType('cut'));
    expect(result.current.rateKgPerWeek).toBe(-0.5);
    expect(result.current.bounds).toEqual({ min: -1, max: -0.1, step: 0.05 });
    const cutCalories = result.current.targets?.calories ?? 0;
    expect(cutCalories).toBeLessThan(maintainCalories);

    act(() => result.current.setGoalType('bulk'));
    expect(result.current.rateKgPerWeek).toBe(0.25);
    expect(result.current.targets?.calories ?? 0).toBeGreaterThan(maintainCalories);
    expect(result.current.hasChanges).toBe(true);
  });

  it('changes the targets when the macro split changes but keeps the calories', () => {
    const { result } = renderHook(() => useGoalEditor({ profile: PROFILE, goal: makeGoal() }));
    const before = result.current.targets;
    act(() => result.current.setMacroSplit('keto'));
    const after = result.current.targets;
    expect(after?.calories).toBe(before?.calories);
    expect(after?.fat ?? 0).toBeGreaterThan(before?.fat ?? 0);
    expect(after?.carbs ?? 0).toBeLessThan(before?.carbs ?? 0);
  });

  it('keeps a manual override through unrelated field changes', () => {
    const { result } = renderHook(() => useGoalEditor({ profile: PROFILE, goal: makeGoal() }));

    act(() => result.current.setOverrideField('calories', 1800));
    expect(result.current.isManualOverride).toBe(true);
    expect(result.current.targets?.calories).toBe(1800);

    act(() => result.current.setMacroSplit('high_protein'));
    expect(result.current.targets?.calories).toBe(1800);
    expect(result.current.isManualOverride).toBe(true);

    act(() => result.current.setGoalType('bulk'));
    expect(result.current.targets?.calories).toBe(1800);

    act(() => result.current.nudgeRate(1));
    expect(result.current.targets?.calories).toBe(1800);
    expect(result.current.isManualOverride).toBe(true);
  });

  it('clears the override and re-reads the latest weight on recalculate', () => {
    const { result } = renderHook(() =>
      useGoalEditor({ profile: PROFILE, goal: makeGoal(), latestWeightKg: 78 })
    );
    expect(result.current.weightKg).toBe(78);

    act(() => result.current.setOverrideField('calories', 1400));
    expect(result.current.isManualOverride).toBe(true);
    expect(result.current.belowFloor).toBe(true);

    act(() => result.current.setWeightKg(90));
    act(() => result.current.recalculate());

    expect(result.current.isManualOverride).toBe(false);
    expect(result.current.override.calories).toBeNull();
    expect(result.current.weightKg).toBe(78);
    expect(result.current.targets).toEqual(result.current.plan?.targets);
    expect(result.current.belowFloor).toBe(false);
  });

  it('warns but still allows a manual target below the floor', () => {
    const { result } = renderHook(() => useGoalEditor({ profile: PROFILE, goal: makeGoal() }));
    act(() => result.current.setOverrideField('calories', 1000));
    expect(result.current.belowFloor).toBe(true);
    expect(result.current.floor).toBe(1500);
    expect(result.current.buildGoalPayload()?.targets?.calories).toBe(1000);
  });

  it('builds a payload that marks a manual override as a custom split', () => {
    const goal = makeGoal({ type: 'cut', rateKgPerWeek: -0.5, startedAt: '2024-03-01' });
    const { result } = renderHook(() => useGoalEditor({ profile: PROFILE, goal }));

    let payload = result.current.buildGoalPayload();
    expect(payload).toMatchObject({
      type: 'cut',
      rateKgPerWeek: -0.5,
      macroSplit: 'balanced',
      isManualOverride: false,
      isActive: true,
      startedAt: '2024-03-01',
    });
    expect(macrosToCalories(payload?.targets ?? { protein: 0, carbs: 0, fat: 0 })).toBeGreaterThan(0);

    act(() => result.current.setOverrideField('protein', 200));
    payload = result.current.buildGoalPayload();
    expect(payload?.macroSplit).toBe('custom');
    expect(payload?.isManualOverride).toBe(true);
    expect(payload?.targets?.protein).toBe(200);
  });

  it('zeroes the rate for a maintain payload', () => {
    const { result } = renderHook(() =>
      useGoalEditor({ profile: PROFILE, goal: makeGoal({ type: 'cut', rateKgPerWeek: -0.5 }) })
    );
    act(() => result.current.setGoalType('maintain'));
    expect(result.current.buildGoalPayload()?.rateKgPerWeek).toBe(0);
  });

  it('is not ready without a profile', () => {
    const { result } = renderHook(() => useGoalEditor({ profile: null, goal: null }));
    expect(result.current.ready).toBe(false);
    expect(result.current.plan).toBeNull();
    expect(result.current.buildGoalPayload()).toBeNull();
  });
});
