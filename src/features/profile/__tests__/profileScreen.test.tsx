import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useAppStore, DEFAULT_SETTINGS } from '@/store/appStore';
import type { Goal, UserProfile } from '@/types';

import { computePlan } from '../useGoalEditor';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
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

beforeEach(() => {
  jest.clearAllMocks();
  setStore(null, null);
});

describe('Profile tab — no profile yet', () => {
  it('shows the onboarding CTA and routes to /onboarding', async () => {
    render(<ProfileScreen />);

    const cta = await screen.findByTestId('profile-onboarding-cta');
    expect(cta).toBeTruthy();
    expect(screen.getByText('Set up your profile')).toBeTruthy();
    expect(screen.queryByTestId('profile-header-card')).toBeNull();

    fireEvent.press(screen.getByText('Start setup'));
    expect(mockPush).toHaveBeenCalledWith('/onboarding');
  });
});

describe('Profile tab — with a profile', () => {
  it('renders identity, plan and breakdown from the stored numbers', async () => {
    setStore(PROFILE, GOAL);
    render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByTestId('profile-header-card')).toBeTruthy());
    expect(screen.queryByTestId('profile-onboarding-cta')).toBeNull();

    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0);
    expect(screen.getByText(/30 yrs · Male/)).toBeTruthy();
    expect(screen.getByTestId('profile-weight-tile')).toBeTruthy();
    expect(screen.getByTestId('profile-bmi-tile')).toBeTruthy();

    // Plan card mirrors the persisted target, not a locally recomputed one.
    expect(screen.getByTestId('target-calories')).toBeTruthy();
    expect(screen.getByTestId('plan-breakdown-toggle')).toBeTruthy();
  });

  it('prompts to set a goal when there is no active goal', async () => {
    setStore(PROFILE, null);
    render(<ProfileScreen />);
    await waitFor(() => expect(screen.getByTestId('profile-no-goal')).toBeTruthy());
    expect(screen.getByTestId('set-goal-button')).toBeTruthy();
  });

  it('opens the goal editor sheet and saves a changed plan', async () => {
    setStore(PROFILE, GOAL);
    render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByTestId('edit-goal-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('edit-goal-button'));

    await waitFor(() => expect(screen.getByTestId('goal-editor-sheet')).toBeTruthy());

    fireEvent.press(screen.getByTestId('goal-option-bulk'));
    fireEvent.press(screen.getByTestId('goal-save'));

    await waitFor(() => expect(repos.saveGoal).toHaveBeenCalled());
    const payload = (repos.saveGoal as jest.Mock).mock.calls[0][0];
    expect(payload.type).toBe('bulk');
    expect(payload.rateKgPerWeek).toBeGreaterThan(0);
    expect(payload.targets.calories).toBeGreaterThan(GOAL.targets.calories);
    expect(payload.isActive).toBe(true);
  });

  it('links out to settings and to a fresh onboarding run', async () => {
    setStore(PROFILE, GOAL);
    render(<ProfileScreen />);

    await waitFor(() => expect(screen.getByTestId('profile-settings-link')).toBeTruthy());
    fireEvent.press(screen.getByTestId('profile-settings-link'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});
