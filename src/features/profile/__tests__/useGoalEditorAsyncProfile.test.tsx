import { renderHook } from '@testing-library/react-native';

import type { Goal, UserProfile } from '@/types';

import { computePlan, useGoalEditor } from '../useGoalEditor';

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

function makeGoal(): Goal {
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
  return {
    id: 'goal-1',
    type: 'cut',
    rateKgPerWeek: -0.5,
    macroSplit: 'balanced',
    targets: plan.targets,
    isManualOverride: false,
    startedAt: '2024-01-01',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('useGoalEditor — profile arrives after the first render', () => {
  it('computes the plan and targets once the profile loads', () => {
    const goal = makeGoal();
    const { result, rerender } = renderHook(
      ({ profile }: { profile: UserProfile | null }) => useGoalEditor({ profile, goal }),
      { initialProps: { profile: null as UserProfile | null } }
    );

    // The store bootstraps asynchronously, so on first render there is no profile.
    expect(result.current.plan).toBeNull();

    // …then the account's profile lands.
    rerender({ profile: PROFILE });

    expect(result.current.weightKg).toBe(80);
    expect(result.current.plan).not.toBeNull();
    expect(result.current.targets).not.toBeNull();
  });

  it('follows the current weight when the latest weigh-in loads late', () => {
    const goal = makeGoal();
    const { result, rerender } = renderHook(
      ({ latestWeightKg }: { latestWeightKg: number | null }) =>
        useGoalEditor({ profile: PROFILE, goal, latestWeightKg }),
      { initialProps: { latestWeightKg: null as number | null } }
    );

    expect(result.current.weightKg).toBe(80); // falls back to profile weight

    rerender({ latestWeightKg: 84 });

    expect(result.current.weightKg).toBe(84);
    expect(result.current.plan?.bmr).toBe(computePlan({
      sex: 'male',
      weightKg: 84,
      heightCm: 180,
      ageYears: 30,
      activityLevel: 'moderate',
      goalType: 'cut',
      rateKgPerWeek: -0.5,
      macroSplit: 'balanced',
    }).bmr);
  });
});
