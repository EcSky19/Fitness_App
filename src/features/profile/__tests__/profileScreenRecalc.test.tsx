import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';

import { useAppStore, DEFAULT_SETTINGS } from '@/store/appStore';
import type { Goal, UserProfile } from '@/types';

import { computePlan } from '../useGoalEditor';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/db/repositories', () => ({
  listWeightLogs: jest.fn(async () => []),
  listGoals: jest.fn(async () => []),
  getLatestWeight: jest.fn(async () => null),
  getProfile: jest.fn(async () => null),
  getActiveGoal: jest.fn(async () => null),
  saveProfile: jest.fn(async (p: unknown) => p),
  saveGoal: jest.fn(async (g: unknown) => g),
  addWeightLog: jest.fn(async () => undefined),
}));

import * as repos from '@/db/repositories';

import ProfileScreen from '../../../../app/(tabs)/profile';

const BIRTH_YEAR = new Date().getFullYear() - 30;

const PLAN = computePlan({
  sex: 'male',
  weightKg: 80,
  heightCm: 180,
  ageYears: 30,
  activityLevel: 'moderate',
  goalType: 'cut',
  rateKgPerWeek: -0.5,
  macroSplit: 'balanced',
});

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

const GOAL: Goal = {
  id: 'goal-1',
  type: 'cut',
  rateKgPerWeek: -0.5,
  macroSplit: 'balanced',
  targets: PLAN.targets,
  isManualOverride: false,
  startedAt: '2024-01-01',
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function setStore(profile: UserProfile | null, goal: Goal | null): void {
  useAppStore.setState({
    profile,
    goal,
    settings: { ...DEFAULT_SETTINGS },
    isReady: true,
    dataVersion: 0,
  });
}

/** Auto-press the button whose text matches `choose`. */
function autoAnswer(choose: string): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const btn = (buttons ?? []).find((b) => b.text === choose);
    btn?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setStore(PROFILE, GOAL);
});

afterEach(() => {
  (Alert.alert as unknown as jest.Mock).mockRestore?.();
});

describe('Profile tab — recalculate after a body stat changes', () => {
  it('recomputes the active goal targets from the newly saved weight', async () => {
    const NEW_WEIGHT = 90;
    (repos.getProfile as jest.Mock).mockResolvedValue({ ...PROFILE, currentWeightKg: NEW_WEIGHT });
    autoAnswer('Recalculate');

    render(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('body-stat-weight')).toBeTruthy());

    fireEvent.press(screen.getByTestId('body-stat-weight'));
    await waitFor(() => expect(screen.getByTestId('field-weight')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('field-weight'), String(NEW_WEIGHT));
    fireEvent.press(screen.getByTestId('field-save'));

    await waitFor(() => expect(repos.saveGoal).toHaveBeenCalled());

    const expected = computePlan({
      sex: 'male',
      weightKg: NEW_WEIGHT,
      heightCm: 180,
      ageYears: 30,
      activityLevel: 'moderate',
      goalType: 'cut',
      rateKgPerWeek: -0.5,
      macroSplit: 'balanced',
    });

    const payload = (repos.saveGoal as jest.Mock).mock.calls[0][0];
    expect(payload.targets.calories).toBe(expected.targets.calories);
    expect(payload.targets.calories).not.toBe(GOAL.targets.calories);
    expect(payload.isManualOverride).toBe(false);
  });

  it('leaves the goal untouched when the user keeps the current targets', async () => {
    (repos.getProfile as jest.Mock).mockResolvedValue({ ...PROFILE, currentWeightKg: 90 });
    autoAnswer('Keep current');

    render(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('body-stat-weight')).toBeTruthy());

    fireEvent.press(screen.getByTestId('body-stat-weight'));
    await waitFor(() => expect(screen.getByTestId('field-weight')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('field-weight'), '90');
    fireEvent.press(screen.getByTestId('field-save'));

    await waitFor(() => expect(repos.saveProfile).toHaveBeenCalled());
    expect(repos.saveGoal).not.toHaveBeenCalled();
  });
});

describe('Profile tab — a save that fails must not corrupt the shown value', () => {
  it('keeps the old profile and warns when the repository write throws', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (repos.saveProfile as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    render(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('body-stat-weight')).toBeTruthy());

    fireEvent.press(screen.getByTestId('body-stat-weight'));
    await waitFor(() => expect(screen.getByTestId('field-weight')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('field-weight'), '90');
    fireEvent.press(screen.getByTestId('field-save'));

    // The user is told the save failed…
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', expect.any(String))
    );

    // …and the app must NOT optimistically show 90 kg. The store still holds
    // the original weight, so nothing silently reverts on the next launch.
    expect(useAppStore.getState().profile?.currentWeightKg).toBe(80);
    // A failed body-stat save must not trigger a goal recalculation.
    expect(repos.saveGoal).not.toHaveBeenCalled();
  });
});

describe('Profile tab — profile arrives after the screen mounts', () => {
  it('shows the real daily target, not "No active goal yet", once bootstrap loads the profile', async () => {
    // Signed in and ready, but the profile/goal have not been read yet: the
    // firstRun gate can leave the tab mounted with `profile === null`.
    setStore(null, null);
    render(<ProfileScreen />);
    await screen.findByTestId('profile-onboarding-cta');

    // The account's profile + active goal land from the async bootstrap.
    act(() => setStore(PROFILE, GOAL));

    await waitFor(() => expect(screen.getByTestId('profile-header-card')).toBeTruthy());

    // The user has an active goal, so their target must be shown — not a
    // "set a goal" prompt that hides it.
    expect(screen.queryByTestId('profile-no-goal')).toBeNull();
    expect(screen.getByTestId('target-calories')).toBeTruthy();
  });
});
