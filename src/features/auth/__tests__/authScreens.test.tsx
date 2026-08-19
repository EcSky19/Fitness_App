import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
import { INVALID_CREDENTIALS_MESSAGE } from '@/services/auth';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@/services/auth', () => {
  const actual = jest.requireActual('@/services/auth');
  return {
    ...actual,
    lockRemainingMs: jest.fn(() => 0),
    resetPasswordWithSecurityAnswer: jest.fn(async () => ({ ok: true })),
    changePassword: jest.fn(async () => ({ ok: true })),
    deleteCurrentAccount: jest.fn(async () => ({ ok: true })),
  };
});

import SignInScreen from '../../../../app/(auth)/sign-in';
import SignUpScreen from '../../../../app/(auth)/sign-up';

const SESSION = {
  accountId: 'acct-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  signedInAt: '2026-01-01T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    isReady: true,
    dataVersion: 0,
  });
  useAuthStore.setState({
    session: null,
    accounts: [],
    status: 'signed_out',
    busy: false,
    error: null,
    signUp: jest.fn(async () => ({ ok: true, data: SESSION })),
    signIn: jest.fn(async () => ({ ok: true, data: SESSION })),
    switchAccount: jest.fn(async () => ({ ok: true, data: SESSION })),
    refreshAccounts: jest.fn(async () => undefined),
    clearError: jest.fn(),
  });
});

describe('auth screens', () => {
  it('creates one account when sign-up is double-tapped', async () => {
    let resolveSignUp: (value: { ok: true; data: typeof SESSION }) => void = () => undefined;
    const signUp = jest.fn(
      () =>
        new Promise<{ ok: true; data: typeof SESSION }>((resolve) => {
          resolveSignUp = resolve;
        })
    );
    useAuthStore.setState({ signUp });

    render(<SignUpScreen />);

    fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ada');
    fireEvent.changeText(screen.getByTestId('sign-up-email'), 'ada@example.com');
    fireEvent.changeText(screen.getByTestId('sign-up-password'), 'correct horse battery staple!');
    fireEvent.changeText(screen.getByTestId('sign-up-confirm'), 'correct horse battery staple!');

    fireEvent.press(screen.getByTestId('sign-up-submit'));
    fireEvent.press(screen.getByTestId('sign-up-submit'));

    expect(signUp).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignUp({ ok: true, data: SESSION });
      await Promise.resolve();
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('sends an existing signed-in account with a profile straight to tabs', async () => {
    useAppStore.setState({
      profile: {
        id: 'profile-1',
        name: 'Ada',
        sex: 'female',
        birthDate: '1990-01-01',
        heightCm: 165,
        currentWeightKg: 62,
        goalWeightKg: null,
        activityLevel: 'moderate',
        weightUnit: 'kg',
        heightUnit: 'cm',
        onboardedAt: '2026-01-01T10:00:00.000Z',
        createdAt: '2026-01-01T10:00:00.000Z',
        updatedAt: '2026-01-01T10:00:00.000Z',
      },
    });
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ada@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'password');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)'));
  });

  it('shows the generic credentials error for a wrong password', async () => {
    const signIn = jest.fn(async () => ({
      ok: false,
      code: 'invalid_credentials' as const,
      error: 'No account found with that email.',
    }));
    useAuthStore.setState({ signIn });
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'ada@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'wrong-password');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => expect(screen.getByText(INVALID_CREDENTIALS_MESSAGE)).toBeTruthy());
    expect(screen.queryByText(/No account found/i)).toBeNull();
  });
});
