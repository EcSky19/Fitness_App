import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { calcBMR, calcTDEE } from '@/domain';
import { useAppStore, DEFAULT_SETTINGS } from '@/store/appStore';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/db/repositories', () => ({
  saveProfile: jest.fn(async (p: Record<string, unknown>) => ({ id: 'me', ...p })),
  saveGoal: jest.fn(async (g: Record<string, unknown>) => ({ id: 'goal-1', ...g })),
  addWeightLog: jest.fn(async () => undefined),
  saveSettings: jest.fn(async () => undefined),
  getProfile: jest.fn(async () => null),
  getActiveGoal: jest.fn(async () => null),
  getLatestWeight: jest.fn(async () => null),
}));

import * as repos from '@/db/repositories';

import OnboardingScreen from '../../../../app/onboarding';

const BIRTH_YEAR = new Date().getFullYear() - 30;

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function next(): void {
  fireEvent.press(screen.getByTestId('onboarding-next'));
}

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    profile: null,
    goal: null,
    // Onboarding seeds its unit toggles from settings; pin metric for the
    // deterministic path and exercise the toggle in its own test.
    settings: { ...DEFAULT_SETTINGS, weightUnit: 'kg', heightUnit: 'cm' },
    isReady: true,
  });
});

describe('Onboarding wizard', () => {
  it('gates each step and writes a complete, plausible plan on finish', async () => {
    render(<OnboardingScreen />);

    // Step 1 — welcome is always passable.
    expect(screen.getByTestId('onboarding-step-welcome')).toBeTruthy();
    expect(screen.getByTestId('onboarding-back').props.accessibilityState.disabled).toBe(true);
    next();

    // Step 2 — blocked until the name and a real birth date exist.
    expect(screen.getByTestId('onboarding-step-about')).toBeTruthy();
    next();
    expect(screen.getByTestId('onboarding-step-about')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Alex');
    fireEvent.changeText(screen.getByTestId('dob-month'), '6');
    fireEvent.changeText(screen.getByTestId('dob-day'), '15');
    fireEvent.changeText(screen.getByTestId('dob-year'), String(BIRTH_YEAR));
    next();

    // Step 3 — body.
    expect(screen.getByTestId('onboarding-step-body')).toBeTruthy();
    next();
    expect(screen.getByTestId('onboarding-step-body')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('height-cm'), '180');
    fireEvent.changeText(screen.getByTestId('onboarding-weight'), '80');
    next();

    // Step 4 — activity.
    expect(screen.getByTestId('onboarding-step-activity')).toBeTruthy();
    fireEvent.press(screen.getByTestId('activity-option-moderate'));
    next();

    // Step 5 — goal, with a suggested rate inside the bounds.
    expect(screen.getByTestId('onboarding-step-goal')).toBeTruthy();
    fireEvent.press(screen.getByTestId('goal-option-cut'));
    expect(screen.getByTestId('rate-value')).toBeTruthy();
    expect(screen.getByTestId('onboarding-goal-weight')).toBeTruthy();
    next();

    // Step 6 — the plan, with the real numbers on screen.
    expect(screen.getByTestId('onboarding-step-plan')).toBeTruthy();
    expect(screen.getByTestId('target-calories')).toBeTruthy();
    expect(screen.getByTestId('plan-sentence')).toBeTruthy();

    fireEvent.press(screen.getByTestId('onboarding-finish'));

    await waitFor(() => expect(repos.saveProfile).toHaveBeenCalled());
    await flushAsync();

    const profile = (repos.saveProfile as jest.Mock).mock.calls[0][0];
    expect(profile).toMatchObject({
      name: 'Alex',
      sex: 'male',
      heightCm: 180,
      currentWeightKg: 80,
      activityLevel: 'moderate',
      birthDate: `${BIRTH_YEAR}-06-15`,
    });
    expect(typeof profile.onboardedAt).toBe('string');

    const goal = (repos.saveGoal as jest.Mock).mock.calls[0][0];
    const bmr = calcBMR({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 });
    const tdee = calcTDEE(bmr, 'moderate');
    expect(goal.type).toBe('cut');
    expect(goal.isActive).toBe(true);
    expect(goal.rateKgPerWeek).toBeLessThan(0);
    expect(goal.targets.calories).toBeLessThan(tdee);
    expect(goal.targets.calories).toBeGreaterThan(1500);
    expect(goal.targets.protein).toBeGreaterThan(0);

    expect(repos.addWeightLog).toHaveBeenCalledWith(
      expect.objectContaining({ weightKg: 80, date: expect.any(String) })
    );
    expect(useAppStore.getState().profile).not.toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
  });

  it('keeps the underlying weight when the unit is toggled mid-edit', async () => {
    render(<OnboardingScreen />);
    next();
    fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Alex');
    fireEvent.changeText(screen.getByTestId('dob-month'), '6');
    fireEvent.changeText(screen.getByTestId('dob-day'), '15');
    fireEvent.changeText(screen.getByTestId('dob-year'), String(BIRTH_YEAR));
    next();

    fireEvent.changeText(screen.getByTestId('height-cm'), '180');
    fireEvent.changeText(screen.getByTestId('onboarding-weight'), '80');

    fireEvent.press(screen.getByText('lb'));
    expect(Number(screen.getByTestId('onboarding-weight').props.value)).toBeCloseTo(176.4, 0);

    fireEvent.press(screen.getByText('kg'));
    expect(Number(screen.getByTestId('onboarding-weight').props.value)).toBeCloseTo(80, 1);
  });

  it('warns when a manual calorie override falls under the safety floor', async () => {
    render(<OnboardingScreen />);
    next();
    fireEvent.changeText(screen.getByTestId('onboarding-name'), 'Alex');
    fireEvent.changeText(screen.getByTestId('dob-month'), '6');
    fireEvent.changeText(screen.getByTestId('dob-day'), '15');
    fireEvent.changeText(screen.getByTestId('dob-year'), String(BIRTH_YEAR));
    next();
    fireEvent.changeText(screen.getByTestId('height-cm'), '180');
    fireEvent.changeText(screen.getByTestId('onboarding-weight'), '80');
    next();
    fireEvent.press(screen.getByTestId('activity-option-moderate'));
    next();
    fireEvent.press(screen.getByTestId('goal-option-cut'));
    next();

    expect(screen.queryByTestId('target-warning')).toBeNull();

    fireEvent.press(screen.getByTestId('fine-tune-toggle'));
    fireEvent.changeText(screen.getByTestId('fine-tune-calories'), '900');

    expect(screen.getByTestId('target-warning')).toBeTruthy();
    // A below-floor target is a warning, not a block.
    expect(screen.getByTestId('onboarding-finish')).toBeTruthy();

    fireEvent.press(screen.getByTestId('fine-tune-reset'));
    expect(screen.queryByTestId('target-warning')).toBeNull();
  });
});
