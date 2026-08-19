import { act, renderHook } from '@testing-library/react-native';

import type { ExerciseEntry } from '@/types';

import { MET_ACTIVITIES, TEST_TODAY, calcCaloriesBurned } from './domainMock';

jest.mock('@/domain', () => require('./domainMock'));

import {
  CUSTOM_ACTIVITY_MET,
  DEFAULT_WEIGHT_KG,
  useWorkoutForm,
} from '../useWorkoutForm';

const RUNNING = MET_ACTIVITIES[0]; // 8.3 MET
const WALKING = MET_ACTIVITIES[1]; // 3.5 MET

function setup(weightKg: number | null = 80, entry: ExerciseEntry | null = null) {
  return renderHook(() => useWorkoutForm({ date: TEST_TODAY, weightKg, entry }));
}

describe('useWorkoutForm — estimation', () => {
  it('starts empty and cannot be saved', () => {
    const { result } = setup();
    expect(result.current.values.name).toBe('');
    expect(result.current.values.durationMin).toBeNull();
    expect(result.current.estimatedCalories).toBe(0);
    expect(result.current.canSave).toBe(false);
  });

  it('estimates from the picked activity and duration', () => {
    const { result } = setup(80);

    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));

    expect(result.current.values.name).toBe(RUNNING.name);
    expect(result.current.values.category).toBe('cardio');
    expect(result.current.met).toBe(RUNNING.met);
    expect(result.current.estimatedCalories).toBe(calcCaloriesBurned(RUNNING.met, 80, 30));
    expect(result.current.calories).toBe(result.current.estimatedCalories);
    expect(result.current.isCaloriesOverridden).toBe(false);
  });

  it('re-estimates when the duration changes', () => {
    const { result } = setup(80);
    act(() => result.current.selectActivity(RUNNING));

    act(() => result.current.setDurationMin(30));
    const thirty = result.current.estimatedCalories;
    expect(thirty).toBe(calcCaloriesBurned(RUNNING.met, 80, 30));

    act(() => result.current.setDurationMin(60));
    expect(result.current.estimatedCalories).toBe(calcCaloriesBurned(RUNNING.met, 80, 60));
    expect(result.current.estimatedCalories).toBeGreaterThan(thirty);
  });

  it('re-estimates when the activity changes', () => {
    const { result } = setup(80);
    act(() => result.current.setDurationMin(45));

    act(() => result.current.selectActivity(RUNNING));
    const running = result.current.estimatedCalories;

    act(() => result.current.selectActivity(WALKING));
    expect(result.current.estimatedCalories).toBe(calcCaloriesBurned(WALKING.met, 80, 45));
    expect(result.current.estimatedCalories).toBeLessThan(running);
  });

  it('uses a moderate MET for custom activities', () => {
    const { result } = setup(80);
    act(() => result.current.selectCustom('Garden bootcamp'));
    act(() => result.current.setDurationMin(30));

    expect(result.current.isCustom).toBe(true);
    expect(result.current.met).toBe(CUSTOM_ACTIVITY_MET);
    expect(result.current.estimatedCalories).toBe(
      calcCaloriesBurned(CUSTOM_ACTIVITY_MET, 80, 30)
    );
  });
});

describe('useWorkoutForm — manual override', () => {
  it('keeps a manual calorie value when the duration changes afterwards', () => {
    const { result } = setup(80);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));

    act(() => result.current.setCalories(500));
    expect(result.current.isCaloriesOverridden).toBe(true);
    expect(result.current.calories).toBe(500);

    act(() => result.current.setDurationMin(90));
    expect(result.current.calories).toBe(500);
    expect(result.current.estimatedCalories).toBe(calcCaloriesBurned(RUNNING.met, 80, 90));
  });

  it('restores the estimate when the override is cleared', () => {
    const { result } = setup(80);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));
    act(() => result.current.setCalories(500));

    act(() => result.current.setCalories(null));

    expect(result.current.isCaloriesOverridden).toBe(false);
    expect(result.current.calories).toBe(calcCaloriesBurned(RUNNING.met, 80, 30));
  });

  it('restores the estimate via useEstimate()', () => {
    const { result } = setup(80);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));
    act(() => result.current.setCalories(999));

    act(() => result.current.useEstimate());

    expect(result.current.isCaloriesOverridden).toBe(false);
    expect(result.current.calories).toBe(calcCaloriesBurned(RUNNING.met, 80, 30));
  });

  it('drops the override when a different activity is picked', () => {
    const { result } = setup(80);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));
    act(() => result.current.setCalories(500));

    act(() => result.current.selectActivity(WALKING));

    expect(result.current.isCaloriesOverridden).toBe(false);
    expect(result.current.calories).toBe(calcCaloriesBurned(WALKING.met, 80, 30));
  });

  it('keeps the override while the name is edited', () => {
    const { result } = setup(80);
    act(() => result.current.selectCustom('Boot'));
    act(() => result.current.setDurationMin(20));
    act(() => result.current.setCalories(123));

    act(() => result.current.setName('Bootcamp'));

    expect(result.current.calories).toBe(123);
  });
});

describe('useWorkoutForm — weight fallback', () => {
  it('falls back to the documented default weight when nothing is on record', () => {
    const { result } = setup(null);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));

    expect(result.current.usingFallbackWeight).toBe(true);
    expect(result.current.weightKgUsed).toBe(DEFAULT_WEIGHT_KG);
    expect(result.current.estimatedCalories).toBe(
      calcCaloriesBurned(RUNNING.met, DEFAULT_WEIGHT_KG, 30)
    );
  });

  it('treats a zero/negative weight as missing', () => {
    const { result } = setup(0);
    expect(result.current.usingFallbackWeight).toBe(true);
    expect(result.current.weightKgUsed).toBe(DEFAULT_WEIGHT_KG);
  });

  it('uses the recorded weight when present', () => {
    const { result } = setup(62.5);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));

    expect(result.current.usingFallbackWeight).toBe(false);
    expect(result.current.weightKgUsed).toBe(62.5);
    expect(result.current.estimatedCalories).toBe(calcCaloriesBurned(RUNNING.met, 62.5, 30));
  });
});

describe('useWorkoutForm — validation', () => {
  it('blocks saving without an activity name', () => {
    const { result } = setup();
    act(() => result.current.setDurationMin(30));
    expect(result.current.canSave).toBe(false);
    expect(result.current.nameError).toBeTruthy();

    act(() => result.current.selectCustom('   '));
    expect(result.current.canSave).toBe(false);
  });

  it('blocks saving with an empty or zero duration', () => {
    const { result } = setup();
    act(() => result.current.selectActivity(RUNNING));

    expect(result.current.canSave).toBe(false);

    act(() => result.current.setDurationMin(0));
    expect(result.current.canSave).toBe(false);
    expect(result.current.durationError).toBeTruthy();

    act(() => result.current.setDurationMin(1));
    expect(result.current.canSave).toBe(true);
  });

  it('blocks saving on a future date', () => {
    const { result } = setup();
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));
    expect(result.current.canSave).toBe(true);

    act(() => result.current.setDate('2026-03-11'));

    expect(result.current.canSave).toBe(false);
    expect(result.current.dateError).toMatch(/future/i);
  });
});

describe('useWorkoutForm — payload', () => {
  it('builds a manual entry payload', () => {
    const { result } = setup(80);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));
    act(() => result.current.setNotes('  felt great  '));

    const payload = result.current.buildPayload();

    expect(payload).toMatchObject({
      date: TEST_TODAY,
      name: RUNNING.name,
      category: 'cardio',
      durationMin: 30,
      caloriesBurned: calcCaloriesBurned(RUNNING.met, 80, 30),
      source: 'manual',
      externalId: null,
      notes: 'felt great',
    });
    expect(typeof payload.loggedAt).toBe('string');
  });

  it('saves the manual calorie value when overridden', () => {
    const { result } = setup(80);
    act(() => result.current.selectActivity(RUNNING));
    act(() => result.current.setDurationMin(30));
    act(() => result.current.setCalories(275));

    expect(result.current.buildPayload().caloriesBurned).toBe(275);
  });

  it('nulls out blank notes', () => {
    const { result } = setup(80);
    act(() => result.current.selectCustom('Shovelling snow'));
    act(() => result.current.setDurationMin(25));
    act(() => result.current.setNotes('    '));

    expect(result.current.buildPayload().notes).toBeNull();
  });
});

describe('useWorkoutForm — editing', () => {
  const entry: ExerciseEntry = {
    id: 'e1',
    date: '2026-03-09',
    name: 'Evening swim',
    category: 'sports',
    durationMin: 40,
    caloriesBurned: 333,
    source: 'manual',
    externalId: null,
    notes: 'pool was busy',
    loggedAt: '2026-03-09T19:00:00.000Z',
    createdAt: '2026-03-09T19:00:00.000Z',
    updatedAt: '2026-03-09T19:00:00.000Z',
  };

  it('prefills from the entry and keeps its saved calories', () => {
    const { result } = setup(80, entry);

    expect(result.current.isEditing).toBe(true);
    expect(result.current.values.name).toBe('Evening swim');
    expect(result.current.values.category).toBe('sports');
    expect(result.current.values.durationMin).toBe(40);
    expect(result.current.values.date).toBe('2026-03-09');
    expect(result.current.values.notes).toBe('pool was busy');
    expect(result.current.calories).toBe(333);
    expect(result.current.isCaloriesOverridden).toBe(true);
    expect(result.current.canSave).toBe(true);
  });

  it('falls back to the estimate once the saved calories are cleared', () => {
    const { result } = setup(80, entry);

    act(() => result.current.setCalories(null));

    expect(result.current.calories).toBe(calcCaloriesBurned(CUSTOM_ACTIVITY_MET, 80, 40));
  });

  it('keeps the original loggedAt timestamp', () => {
    const { result } = setup(80, entry);
    expect(result.current.buildPayload().loggedAt).toBe(entry.loggedAt);
  });
});
