/**
 * Behavioural tests for the persistent auth sheets/sections in AuthUI.
 *
 * These mount the real components against a REAL in-memory SQLite database and
 * the real auth service (only the native crypto/secure-store boundary and
 * navigation/haptics are stubbed), so a regression in production logic actually
 * fails a test rather than sailing past a lying mock.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-crypto', () => require('@/services/auth/__tests__/nativeMocks').cryptoMock());
jest.mock('expo-secure-store', () =>
  require('@/services/auth/__tests__/nativeMocks').secureStoreMock()
);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
};
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
  router: mockRouter,
}));

const mockHaptic = jest.fn(async (_type?: unknown) => undefined);
jest.mock('expo-haptics', () => ({
  __esModule: true,
  notificationAsync: (type?: unknown) => mockHaptic(type),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import { getAccountByEmail, listAccounts as listAccountRows } from '@/db/repositories/accounts';
import { setupTestDb, teardownTestDb } from '@/db/repositories/__tests__/testDb';
import {
  __resetAuthState,
  getCurrentAccountId,
  INVALID_CREDENTIALS_MESSAGE,
  verifyPassword,
} from '@/services/auth';
import { __resetSessionStorage } from '@/services/auth/sessionStorage';
import type { SecureStoreMock } from '@/services/auth/__tests__/nativeMocks';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
import type { AuthResult, AuthSession } from '@/types';

import { AccountSection, AccountSwitcherSheet, ForgotPasswordForm, SignUpForm } from '../AuthUI';

const secureStore = jest.requireMock('expo-secure-store') as SecureStoreMock;

const ADA = { email: 'ada@example.com', password: 'a very good password', displayName: 'Ada' };
const GRACE = { email: 'grace@example.com', password: 'another fine password', displayName: 'Grace' };

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function signUpViaStore(input: {
  email: string;
  password: string;
  displayName: string;
  securityQuestion?: string;
  securityAnswer?: string;
}): Promise<AuthResult<AuthSession>> {
  let result!: AuthResult<AuthSession>;
  await act(async () => {
    result = await useAuthStore.getState().signUp(input);
  });
  return result;
}

beforeEach(async () => {
  await setupTestDb({ withAccount: false });
  __resetAuthState();
  __resetSessionStorage();
  secureStore.__store.clear();
  secureStore.__fail.read = false;
  secureStore.__fail.write = false;
  useAuthStore.setState({
    session: null,
    accounts: [],
    status: 'signed_out',
    error: null,
    busy: false,
  });
  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    isReady: true,
    dataVersion: 0,
  });
});

afterEach(async () => {
  await teardownTestDb();
});

describe('AccountSection — delete account', () => {
  it('shows the signed-in account', async () => {
    await signUpViaStore(ADA);
    render(<AccountSection />);
    expect(screen.getByTestId('account-current')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('does not delete the account when the delete sheet is dismissed and reopened', async () => {
    await signUpViaStore(ADA);
    render(<AccountSection />);

    // Arm the destructive sheet: correct password + the confirmation word.
    await act(async () => {
      fireEvent.press(screen.getByTestId('account-delete'));
    });
    fireEvent.changeText(screen.getByTestId('delete-password'), ADA.password);
    fireEvent.changeText(screen.getByTestId('delete-confirm-word'), 'DELETE');

    // The user changes their mind and dismisses the sheet without submitting.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Close sheet'));
    });

    // They reopen it later (e.g. to read the warning) and a stray tap lands on
    // the delete button. Reopening MUST require re-confirmation.
    await act(async () => {
      fireEvent.press(screen.getByTestId('account-delete'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('delete-account-submit'));
    });
    await flush();

    await expect(listAccountRows()).resolves.toHaveLength(1);
    expect(getCurrentAccountId()).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/(auth)/sign-in');
  });
});

describe('AccountSection — change password', () => {
  it('does not silently change the password when the sheet is dismissed and reopened', async () => {
    await signUpViaStore(ADA);
    render(<AccountSection />);

    const newPassword = 'a brand new strong password';

    await act(async () => {
      fireEvent.press(screen.getByTestId('account-change-password'));
    });
    fireEvent.changeText(screen.getByTestId('change-current-password'), ADA.password);
    fireEvent.changeText(screen.getByTestId('change-new-password'), newPassword);
    fireEvent.changeText(screen.getByTestId('change-confirm-password'), newPassword);

    // Dismissed without saving.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Close sheet'));
    });

    // Reopened later; a stray tap on "Save new password" must not go through
    // with the previously typed (but abandoned) values.
    await act(async () => {
      fireEvent.press(screen.getByTestId('account-change-password'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('change-password-submit'));
    });
    await flush();

    const record = await getAccountByEmail(ADA.email);
    await expect(verifyPassword(newPassword, record!.password)).resolves.toBe(false);
    await expect(verifyPassword(ADA.password, record!.password)).resolves.toBe(true);
  });
});

describe('AccountSwitcherSheet', () => {
  it('switches to another local account with its password', async () => {
    await signUpViaStore(ADA);
    await signUpViaStore(GRACE); // Grace is now the signed-in account.

    const onClose = jest.fn();
    render(<AccountSwitcherSheet visible onClose={onClose} />);
    await flush();

    const adaIndex = useAuthStore.getState().accounts.findIndex((a) => a.email === ADA.email);
    expect(adaIndex).toBeGreaterThanOrEqual(0);

    await act(async () => {
      fireEvent.press(screen.getByTestId(`switch-account-${adaIndex}`));
    });
    fireEvent.changeText(screen.getByTestId('switch-password'), ADA.password);
    await act(async () => {
      fireEvent.press(screen.getByTestId('switch-submit'));
    });
    await flush();

    await waitFor(() => expect(getCurrentAccountId()).toBe(useAuthStore.getState().session?.accountId));
    expect(useAuthStore.getState().session?.email).toBe(ADA.email);
    expect(onClose).toHaveBeenCalled();
  });

  it('starts fresh after being dismissed — no stale error or armed password survives a reopen', async () => {
    await signUpViaStore(ADA);
    await signUpViaStore(GRACE); // Grace is the signed-in account.

    const onClose = jest.fn();
    const { rerender } = render(<AccountSwitcherSheet visible onClose={onClose} />);
    await flush();

    const adaIndex = useAuthStore.getState().accounts.findIndex((a) => a.email === ADA.email);
    await act(async () => {
      fireEvent.press(screen.getByTestId(`switch-account-${adaIndex}`));
    });
    fireEvent.changeText(screen.getByTestId('switch-password'), 'the wrong password');
    await act(async () => {
      fireEvent.press(screen.getByTestId('switch-submit'));
    });
    await waitFor(() => expect(screen.getByText(INVALID_CREDENTIALS_MESSAGE)).toBeTruthy());

    // Dismiss and reopen the same (still-mounted) sheet.
    await act(async () => {
      rerender(<AccountSwitcherSheet visible={false} onClose={onClose} />);
    });
    await act(async () => {
      rerender(<AccountSwitcherSheet visible onClose={onClose} />);
    });
    await flush();

    expect(screen.queryByText(INVALID_CREDENTIALS_MESSAGE)).toBeNull();
    expect(screen.queryByTestId('switch-password')).toBeNull();
  });
});

describe('ForgotPasswordForm', () => {
  it('reveals the saved security question for a known account', async () => {
    await signUpViaStore({ ...ADA, securityQuestion: 'First pet?', securityAnswer: 'Fluffy' });

    render(<ForgotPasswordForm />);
    await flush();

    fireEvent.changeText(screen.getByTestId('recovery-email'), ADA.email);
    await waitFor(() => expect(screen.getByTestId('security-question-card')).toBeTruthy());
    expect(screen.getByText('First pet?')).toBeTruthy();
  });
});

describe('SignUpForm — security question validation', () => {
  it('surfaces the "both or neither" error on the security answer, not the password field', async () => {
    render(<SignUpForm />);

    fireEvent.changeText(screen.getByTestId('sign-up-name'), 'Ada');
    fireEvent.changeText(screen.getByTestId('sign-up-email'), 'ada@example.com');
    fireEvent.changeText(screen.getByTestId('sign-up-password'), 'a very good password');
    fireEvent.changeText(screen.getByTestId('sign-up-confirm'), 'a very good password');
    // A question with no answer: the recovery pair is half-filled.
    fireEvent.changeText(screen.getByTestId('security-question'), 'First pet?');

    await act(async () => {
      fireEvent.press(screen.getByTestId('sign-up-submit'));
    });

    const message = 'Enter both a security question and answer, or leave both blank.';
    expect(screen.getByText(message)).toBeTruthy();
    // The message is about the security pair, so it must flag the security answer
    // field — not turn the (valid) password field red with an unrelated error.
    expect(screen.getByTestId('security-answer').props.accessibilityHint).toBe(message);
    expect(screen.getByTestId('sign-up-password').props.accessibilityHint).not.toBe(message);
  });
});
