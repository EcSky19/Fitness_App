import { act, renderHook } from '@testing-library/react-native';

import { calcBMR, calcTDEE } from '@/domain';
import {
  LIMITS,
  STEP_COUNT,
  daysInMonth,
  toISODate,
  useOnboardingForm,
} from '../useOnboardingForm';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/db/repositories', () => ({
  saveProfile: jest.fn(async () => null),
  saveGoal: jest.fn(async () => null),
  addWeightLog: jest.fn(async () => null),
  getProfile: jest.fn(async () => null),
  getActiveGoal: jest.fn(async () => null),
}));

/** Fill steps 1-4 with a valid 30-year-old male, 180 cm, 80 kg, moderate. */
function fillValidProfile(result: { current: ReturnType<typeof useOnboardingForm> }) {
  const birthYear = new Date().getFullYear() - 30;
  act(() => {
    result.current.set('name', 'Alex');
    result.current.setSex('male');
  });
  act(() => {
    result.current.set('birthMonth', 6);
    result.current.set('birthDay', 15);
    result.current.set('birthYear', birthYear);
  });
  act(() => {
    result.current.set('heightCmInput', 180);
    result.current.set('weightInput', 80);
  });
  act(() => {
    result.current.set('activityLevel', 'moderate');
  });
  act(() => {
    result.current.setGoalType('cut');
  });
}

describe('toISODate / daysInMonth', () => {
  it('rejects dates that do not exist', () => {
    expect(toISODate(2023, 2, 30)).toBeNull();
    expect(toISODate(2023, 13, 1)).toBeNull();
    expect(toISODate(2023, 0, 10)).toBeNull();
    expect(toISODate(null, 1, 1)).toBeNull();
  });

  it('accepts real dates including leap days', () => {
    expect(toISODate(2024, 2, 29)).toBe('2024-02-29');
    expect(toISODate(1995, 12, 5)).toBe('1995-12-05');
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });
});

describe('useOnboardingForm — per-step validation', () => {
  it('starts on the welcome step, which is always valid', () => {
    const { result } = renderHook(() => useOnboardingForm());
    expect(result.current.step).toBe(0);
    expect(result.current.stepKey).toBe('welcome');
    expect(result.current.canGoNext).toBe(true);
    expect(result.current.stepCount).toBe(STEP_COUNT);
  });

  it('blocks step 2 until a name and a plausible birth date exist', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.goToStep(1));

    expect(result.current.canGoNext).toBe(false);
    expect(result.current.errors.name).toBeDefined();
    expect(result.current.errors.birthDate).toBeDefined();

    act(() => {
      result.current.set('name', 'Alex');
      result.current.set('birthMonth', 2);
      result.current.set('birthDay', 30);
      result.current.set('birthYear', 1995);
    });
    expect(result.current.errors.birthDate).toBe('That date does not exist.');

    act(() => result.current.set('birthDay', 28));
    expect(result.current.canGoNext).toBe(true);
    expect(result.current.birthDate).toBe('1995-02-28');
  });

  it('rejects ages outside 13-100', () => {
    const { result } = renderHook(() => useOnboardingForm());
    const thisYear = new Date().getFullYear();
    act(() => result.current.goToStep(1));
    act(() => {
      result.current.set('name', 'Kid');
      result.current.set('birthMonth', 1);
      result.current.set('birthDay', 1);
      result.current.set('birthYear', thisYear - 5);
    });
    expect(result.current.errors.birthDate).toContain(String(LIMITS.age.min));

    act(() => result.current.set('birthYear', thisYear - 120));
    expect(result.current.errors.birthDate).toContain(String(LIMITS.age.max));

    act(() => result.current.set('birthYear', thisYear - 30));
    expect(result.current.errors.birthDate).toBeUndefined();
  });

  it('rejects absurd or zero height and weight on the body step', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.goToStep(2));
    expect(result.current.errors.height).toBe('Enter your height.');
    expect(result.current.errors.weight).toBe('Enter your current weight.');

    act(() => {
      result.current.set('heightCmInput', 0);
      result.current.set('weightInput', 0);
    });
    expect(result.current.errors.height).toContain('100');
    expect(result.current.errors.weight).toContain('300');

    act(() => {
      result.current.set('heightCmInput', 400);
      result.current.set('weightInput', 900);
    });
    expect(result.current.errors.height).toBeDefined();
    expect(result.current.errors.weight).toBeDefined();

    act(() => {
      result.current.set('heightCmInput', 180);
      result.current.set('weightInput', 80);
    });
    expect(result.current.canGoNext).toBe(true);
  });

  it('requires an activity level and a goal', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.goToStep(3));
    expect(result.current.canGoNext).toBe(false);
    act(() => result.current.set('activityLevel', 'light'));
    expect(result.current.canGoNext).toBe(true);

    act(() => result.current.goToStep(4));
    expect(result.current.errors.goalType).toBeDefined();
    act(() => result.current.setGoalType('bulk'));
    expect(result.current.errors.goalType).toBeUndefined();
  });

  it('does not advance while the current step is invalid', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.goToStep(1));
    act(() => result.current.next());
    expect(result.current.step).toBe(1);
  });
});

describe('useOnboardingForm — unit conversions', () => {
  it('round-trips weight through a kg -> lb -> kg toggle', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.set('weightInput', 80));
    expect(result.current.weightKg).toBeCloseTo(80, 2);

    act(() => result.current.setWeightUnit('lb'));
    expect(result.current.fields.weightInput).toBeCloseTo(176.4, 1);
    expect(result.current.weightKg).toBeCloseTo(80, 1);

    act(() => result.current.setWeightUnit('kg'));
    expect(result.current.fields.weightInput).toBeCloseTo(80, 1);
    expect(result.current.weightKg).toBeCloseTo(80, 1);
  });

  it('round-trips height through a cm -> ft/in -> cm toggle', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.set('heightCmInput', 180));
    expect(result.current.heightCm).toBe(180);

    act(() => result.current.setHeightUnit('ft_in'));
    expect(result.current.fields.heightFt).toBe(5);
    expect(result.current.fields.heightIn).toBe(11);
    expect(result.current.heightCm).toBeCloseTo(180.3, 1);

    act(() => result.current.setHeightUnit('cm'));
    expect(result.current.fields.heightCmInput).toBe(180);
    expect(result.current.heightCm).toBe(180);
  });

  it('keeps the goal weight in sync when the unit flips mid-edit', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => {
      result.current.set('weightInput', 80);
      result.current.set('goalWeightInput', 72);
    });
    act(() => result.current.setWeightUnit('lb'));
    expect(result.current.goalWeightKg).toBeCloseTo(72, 1);
  });
});

describe('useOnboardingForm — plan and payload', () => {
  it('defaults the rate from the goal type and keeps it inside the bounds', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.setGoalType('cut'));
    expect(result.current.fields.rateKgPerWeek).toBe(-0.5);
    expect(result.current.rateBoundsForGoal.min).toBe(-1);

    act(() => result.current.setGoalType('bulk'));
    expect(result.current.fields.rateKgPerWeek).toBe(0.25);

    act(() => result.current.setGoalType('maintain'));
    expect(result.current.fields.rateKgPerWeek).toBe(0);
  });

  it('nudges the pace by magnitude, not by sign', () => {
    const { result } = renderHook(() => useOnboardingForm());
    act(() => result.current.setGoalType('cut'));
    act(() => result.current.nudgeRate(1));
    expect(result.current.fields.rateKgPerWeek).toBeCloseTo(-0.55, 3);
    act(() => result.current.nudgeRate(-1));
    act(() => result.current.nudgeRate(-1));
    expect(result.current.fields.rateKgPerWeek).toBeCloseTo(-0.45, 3);
  });

  it('produces a plausible BMR / TDEE / target in the final payload', () => {
    const { result } = renderHook(() => useOnboardingForm());
    fillValidProfile(result);

    const expectedBmr = Math.round(
      calcBMR({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 })
    );
    const expectedTdee = Math.round(calcTDEE(expectedBmr, 'moderate'));

    const payload = result.current.buildPayload();
    expect(payload).not.toBeNull();
    if (!payload) return;

    expect(payload.plan.bmr).toBe(expectedBmr);
    expect(payload.plan.bmr).toBeGreaterThan(1500);
    expect(payload.plan.bmr).toBeLessThan(2100);
    expect(payload.plan.tdee).toBe(expectedTdee);
    expect(payload.plan.tdee).toBeGreaterThan(payload.plan.bmr);
    // 0.5 kg/week cut == 550 kcal/day deficit, rounded to the nearest 10 kcal.
    expect(payload.plan.calories).toBe(Math.round((expectedTdee - 550) / 10) * 10);
    expect(Math.abs(payload.plan.delta + 550)).toBeLessThanOrEqual(5);

    expect(payload.profile.heightCm).toBe(180);
    expect(payload.profile.currentWeightKg).toBe(80);
    expect(payload.profile.onboardedAt).toEqual(expect.any(String));
    expect(payload.goal.type).toBe('cut');
    expect(payload.goal.isActive).toBe(true);
    expect(payload.goal.isManualOverride).toBe(false);
    expect(payload.goal.targets?.calories).toBe(payload.plan.calories);
    expect(payload.weightLog.weightKg).toBe(80);
    expect(payload.weightLog.date).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('stores metric even when the user typed imperial', () => {
    const { result } = renderHook(() =>
      useOnboardingForm({ initialWeightUnit: 'lb', initialHeightUnit: 'ft_in' })
    );
    const birthYear = new Date().getFullYear() - 30;
    act(() => {
      result.current.set('name', 'Alex');
      result.current.set('birthMonth', 6);
      result.current.set('birthDay', 15);
      result.current.set('birthYear', birthYear);
      result.current.set('heightFt', 5);
      result.current.set('heightIn', 11);
      result.current.set('weightInput', 176.4);
      result.current.set('activityLevel', 'moderate');
    });
    act(() => result.current.setGoalType('maintain'));

    const payload = result.current.buildPayload();
    expect(payload?.profile.heightCm).toBeCloseTo(180.3, 1);
    expect(payload?.profile.currentWeightKg).toBeCloseTo(80, 1);
    expect(payload?.profile.weightUnit).toBe('lb');
  });

  it('applies a manual override and flags a target under the safety floor', () => {
    const { result } = renderHook(() => useOnboardingForm());
    fillValidProfile(result);

    expect(result.current.belowFloor).toBe(false);

    act(() => result.current.setManualEnabled(true));
    expect(result.current.fields.override.calories).toBe(result.current.plan?.calories);

    act(() => result.current.setOverrideField('calories', 900));
    expect(result.current.targets?.calories).toBe(900);
    expect(result.current.belowFloor).toBe(true);
    expect(result.current.floor).toBe(1500);

    const payload = result.current.buildPayload();
    expect(payload?.goal.isManualOverride).toBe(true);
    expect(payload?.goal.macroSplit).toBe('custom');
    expect(payload?.goal.targets?.calories).toBe(900);

    act(() => result.current.setManualEnabled(false));
    expect(result.current.targets?.calories).toBe(result.current.plan?.calories);
    expect(result.current.belowFloor).toBe(false);
  });

  it('estimates weeks to the goal weight from the chosen pace', () => {
    const { result } = renderHook(() => useOnboardingForm());
    fillValidProfile(result);
    act(() => result.current.set('goalWeightInput', 75));
    // 5 kg at 0.5 kg/week -> 10 weeks.
    expect(result.current.weeksToGoal).toBe(10);
  });

  it('returns null from buildPayload while required fields are missing', () => {
    const { result } = renderHook(() => useOnboardingForm());
    expect(result.current.buildPayload()).toBeNull();
  });
});
