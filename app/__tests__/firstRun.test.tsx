/**
 * First-run routing gate (`app/_layout.tsx`).
 *
 * A user who has never completed onboarding must land on `/onboarding` once
 * bootstrap has read the database — and exactly once, so the redirect can never
 * loop and manual visits to onboarding are never bounced.
 */
import { act, render } from '@testing-library/react-native';
import React from 'react';

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import type { UserProfile } from '@/types';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  setParams: jest.fn(),
};

let mockSegments: string[] = [];

jest.mock('expo-router', () => {
  const ReactLib = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');

  const Stack = Object.assign(
    ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement(View, { testID: 'router-Stack' }, children),
    { Screen: (): null => null }
  );

  return {
    __esModule: true,
    Stack,
    router: mockRouter,
    useRouter: () => mockRouter,
    useSegments: () => mockSegments,
    usePathname: () => `/${mockSegments.join('/')}`,
  };
});

const mockRepositories = {
  getProfile: jest.fn(),
  getActiveGoal: jest.fn(),
  getSettings: jest.fn(),
  saveSettings: jest.fn(),
};

jest.mock('@/db/repositories', () => mockRepositories);
jest.mock('@/services/foodSearch', () => ({ ensureFoodsSeeded: jest.fn(async () => 0) }));

import RootLayout from '../_layout';

const ONBOARDED: UserProfile = {
  id: 'me',
  name: 'Ada',
  sex: 'female',
  birthDate: '1990-05-04',
  heightCm: 165,
  currentWeightKg: 62,
  goalWeightKg: 58,
  activityLevel: 'moderate',
  weightUnit: 'kg',
  heightUnit: 'cm',
  onboardedAt: '2026-01-01T10:00:00.000Z',
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
};

function setStoredProfile(profile: UserProfile | null): void {
  mockRepositories.getProfile.mockResolvedValue(profile);
}

/** Mounts the root layout and lets its `bootstrap()` effect settle. */
async function mountLayout(): Promise<void> {
  render(<RootLayout />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockSegments = [];
  mockRepositories.getProfile.mockResolvedValue(null);
  mockRepositories.getActiveGoal.mockResolvedValue(null);
  mockRepositories.getSettings.mockResolvedValue({});
  mockRepositories.saveSettings.mockResolvedValue(undefined);

  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    isReady: false,
    dataVersion: 0,
  });
});

describe('first-run redirect', () => {
  it('sends a brand-new user to onboarding', async () => {
    setStoredProfile(null);

    await mountLayout();

    expect(useAppStore.getState().isReady).toBe(true);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('sends a user who never finished onboarding to onboarding', async () => {
    setStoredProfile({ ...ONBOARDED, onboardedAt: null });

    await mountLayout();

    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('leaves an onboarded user on the tabs', async () => {
    setStoredProfile(ONBOARDED);

    await mountLayout();

    expect(useAppStore.getState().profile?.onboardedAt).toBe(ONBOARDED.onboardedAt);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('never redirects while onboarding is already open (no loop)', async () => {
    setStoredProfile(null);
    mockSegments = ['onboarding'];

    await mountLayout();

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('does not redirect before bootstrap has finished', async () => {
    let resolveProfile: (value: UserProfile | null) => void = () => undefined;
    mockRepositories.getProfile.mockReturnValue(
      new Promise<UserProfile | null>((resolve) => {
        resolveProfile = resolve;
      })
    );

    render(<RootLayout />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(useAppStore.getState().isReady).toBe(false);
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await act(async () => {
      resolveProfile(null);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useAppStore.getState().isReady).toBe(true);
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('redirects at most once per launch', async () => {
    setStoredProfile(null);

    await mountLayout();
    await act(async () => {
      await useAppStore.getState().bootstrap();
    });
    await act(async () => {
      useAppStore.getState().invalidate();
    });

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });
});
