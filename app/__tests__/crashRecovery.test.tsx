/**
 * Crash recovery wiring (`app/_layout.tsx`).
 *
 * The error boundary's "Try again" button only clears the boundary's own state.
 * If the crash reproduces on every render, that leaves the user pressing a
 * button that re-throws forever. The root layout therefore hands the boundary an
 * `onReset` that navigates back to a known-good screen, which unmounts whatever
 * threw.
 */
import { act, render } from '@testing-library/react-native';
import React from 'react';

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  setParams: jest.fn(),
};

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
    useSegments: () => [],
    usePathname: () => '/',
  };
});

/**
 * `SafeAreaProvider` withholds its children until it has measured insets, and
 * `onLayout` never fires under the test renderer -- without this the boundary
 * below it would never mount at all.
 */
jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react') as typeof import('react');

  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement(ReactLib.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement(ReactLib.Fragment, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

/** Captures the `onReset` the layout hands to the boundary so we can fire it. */
let mockCapturedReset: (() => void) | null = null;

jest.mock('@/ui/components/ErrorBoundary', () => {
  const ReactLib = require('react') as typeof import('react');

  return {
    __esModule: true,
    ErrorBoundary: ({
      children,
      onReset,
    }: {
      children?: React.ReactNode;
      onReset?: () => void;
    }) => {
      mockCapturedReset = onReset ?? null;
      return ReactLib.createElement(ReactLib.Fragment, null, children);
    },
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

beforeEach(() => {
  jest.clearAllMocks();
  mockCapturedReset = null;

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

/** Mounts the layout in the given auth state and lets bootstrap settle. */
async function mountLayout(signedIn: boolean): Promise<void> {
  useAuthStore.setState({
    session: signedIn
      ? {
          accountId: 'acct-1',
          email: 'ada@example.com',
          displayName: 'Ada',
          signedInAt: '2026-01-01T10:00:00.000Z',
        }
      : null,
    status: signedIn ? 'signed_in' : 'signed_out',
    restore: jest.fn(async () => {
      if (signedIn) await useAppStore.getState().bootstrap();
    }),
  });

  render(<RootLayout />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('error boundary recovery', () => {
  it('gives the boundary a reset handler', async () => {
    await mountLayout(true);

    expect(typeof mockCapturedReset).toBe('function');
  });

  it('sends a signed-in user back to the tab root so the crashed screen unmounts', async () => {
    await mountLayout(true);
    mockRouter.replace.mockClear();

    await act(async () => {
      mockCapturedReset?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('sends a signed-out user to sign-in rather than into the gated stack', async () => {
    await mountLayout(false);
    mockRouter.replace.mockClear();

    await act(async () => {
      mockCapturedReset?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('does not navigate until the boundary has remounted the stack', async () => {
    await mountLayout(true);
    mockRouter.replace.mockClear();

    // The boundary calls `onReset` while the fallback is still on screen, so a
    // synchronous navigation would be aimed at an unmounted navigator.
    act(() => {
      mockCapturedReset?.();
    });

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('survives a navigator that throws while recovering', async () => {
    await mountLayout(true);
    mockRouter.replace.mockClear();
    mockRouter.replace.mockImplementationOnce(() => {
      throw new Error('navigator not mounted');
    });

    await expect(
      act(async () => {
        mockCapturedReset?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      })
    ).resolves.not.toThrow();
  });
});
