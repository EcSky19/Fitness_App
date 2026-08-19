import { EXERCISE_CATEGORIES } from '@/types/constants';
import { MET_ACTIVITIES, calcCaloriesBurned, findActivity, searchActivities } from '../exercise';

describe('exercise — MET_ACTIVITIES catalogue', () => {
  it('ships at least 30 activities', () => {
    expect(MET_ACTIVITIES.length).toBeGreaterThanOrEqual(30);
  });

  it('has unique ids and non-empty names', () => {
    const ids = MET_ACTIVITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const activity of MET_ACTIVITIES) {
      expect(activity.id).toMatch(/^[a-z0-9_]+$/);
      expect(activity.name.length).toBeGreaterThan(0);
    }
  });

  it('uses valid categories and plausible MET values', () => {
    for (const activity of MET_ACTIVITIES) {
      expect(EXERCISE_CATEGORIES).toContain(activity.category);
      expect(activity.met).toBeGreaterThan(0);
      expect(activity.met).toBeLessThan(25);
    }
  });

  it('covers cardio, strength, sports and flexibility', () => {
    for (const category of ['cardio', 'strength', 'sports', 'flexibility'] as const) {
      expect(MET_ACTIVITIES.filter((a) => a.category === category).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('uses compendium MET values for well-known activities', () => {
    expect(findActivity('walking')?.met).toBe(3.5);
    expect(findActivity('running_6mph')?.met).toBe(9.8);
    expect(findActivity('cycling_moderate')?.met).toBe(8.0);
    expect(findActivity('swimming')?.met).toBe(7.0);
    expect(findActivity('weight_training')?.met).toBe(5.0);
    expect(findActivity('hiit')?.met).toBe(8.0);
    expect(findActivity('yoga')?.met).toBe(2.5);
    expect(findActivity('basketball')?.met).toBe(6.5);
    expect(findActivity('elliptical')?.met).toBe(5.0);
    expect(findActivity('rowing_machine')?.met).toBe(7.0);
    expect(findActivity('stair_climber')?.met).toBe(9.0);
    expect(findActivity('hiking')?.met).toBe(6.0);
    expect(findActivity('jump_rope')?.met).toBe(12.3);
    expect(findActivity('pilates')?.met).toBe(3.0);
    expect(findActivity('boxing')?.met).toBe(7.8);
    expect(findActivity('soccer')?.met).toBe(7.0);
    expect(findActivity('tennis')?.met).toBe(7.3);
    expect(findActivity('dancing')?.met).toBe(5.0);
    expect(findActivity('rock_climbing')?.met).toBe(8.0);
  });
});

describe('exercise — calcCaloriesBurned', () => {
  it('matches the MET formula for a known case', () => {
    // 8 MET * 3.5 * 70 kg / 200 * 30 min = 294 kcal
    expect(calcCaloriesBurned(8, 70, 30)).toBe(294);
  });

  it('scales linearly with duration, weight and MET', () => {
    expect(calcCaloriesBurned(8, 70, 60)).toBe(calcCaloriesBurned(8, 70, 30) * 2);
    expect(calcCaloriesBurned(8, 140, 30)).toBe(calcCaloriesBurned(8, 70, 30) * 2);
    expect(calcCaloriesBurned(16, 70, 30)).toBe(calcCaloriesBurned(8, 70, 30) * 2);
  });

  it('computes a realistic 45 minute run', () => {
    // 9.8 MET, 75 kg, 45 min -> 578 kcal
    expect(calcCaloriesBurned(9.8, 75, 45)).toBe(579);
  });

  it('returns 0 for zero / negative / invalid input', () => {
    expect(calcCaloriesBurned(0, 70, 30)).toBe(0);
    expect(calcCaloriesBurned(8, 0, 30)).toBe(0);
    expect(calcCaloriesBurned(8, 70, 0)).toBe(0);
    expect(calcCaloriesBurned(-8, 70, 30)).toBe(0);
    expect(calcCaloriesBurned(8, -70, 30)).toBe(0);
    expect(calcCaloriesBurned(Number.NaN, 70, 30)).toBe(0);
    expect(calcCaloriesBurned(8, 70, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('exercise — lookup', () => {
  it('finds an activity by exact id, case-insensitively', () => {
    expect(findActivity('walking')?.name).toBe('Walking (3 mph, moderate)');
    expect(findActivity('  WALKING  ')?.id).toBe('walking');
  });

  it('returns undefined for unknown / empty ids', () => {
    expect(findActivity('does_not_exist')).toBeUndefined();
    expect(findActivity('')).toBeUndefined();
    expect(findActivity('   ')).toBeUndefined();
  });

  it('never partially matches an id', () => {
    expect(findActivity('walk')).toBeUndefined();
  });
});

describe('exercise — search', () => {
  it('returns the full catalogue for an empty query', () => {
    expect(searchActivities('')).toHaveLength(MET_ACTIVITIES.length);
    expect(searchActivities('   ')).toHaveLength(MET_ACTIVITIES.length);
  });

  it('does not leak a mutable reference to the catalogue', () => {
    const all = searchActivities('');
    all.pop();
    expect(searchActivities('')).toHaveLength(MET_ACTIVITIES.length);
  });

  it('matches on name substrings, case-insensitively', () => {
    const running = searchActivities('running');
    expect(running.length).toBeGreaterThanOrEqual(3);
    expect(running.every((a) => a.name.toLowerCase().includes('running'))).toBe(true);
    expect(searchActivities('YOGA').map((a) => a.id)).toContain('yoga');
  });

  it('matches on id and category', () => {
    expect(searchActivities('jump_rope').map((a) => a.id)).toContain('jump_rope');
    const flexibility = searchActivities('flexibility');
    expect(flexibility.length).toBeGreaterThanOrEqual(5);
    expect(flexibility.every((a) => a.category === 'flexibility')).toBe(true);
  });

  it('ranks name-prefix matches first', () => {
    const results = searchActivities('walking');
    expect(results.length).toBeGreaterThan(1);
    expect(results[0].name.toLowerCase().startsWith('walking')).toBe(true);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchActivities('quidditch')).toEqual([]);
  });
});
