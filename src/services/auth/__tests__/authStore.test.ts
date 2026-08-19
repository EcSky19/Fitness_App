jest.mock('expo-crypto', () => require('@/services/auth/__tests__/nativeMocks').cryptoMock());
jest.mock('expo-secure-store', () =>
  require('@/services/auth/__tests__/nativeMocks').secureStoreMock()
);
jest.mock('@/services/foodSearch', () => ({ ensureFoodsSeeded: jest.fn(async () => 0) }));

import { setupTestDb, teardownTestDb } from '@/db/repositories/__tests__/testDb';
import { __resetAuthState, signUp } from '@/services/auth';
import { __resetSessionStorage } from '@/services/auth/sessionStorage';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
import type { SecureStoreMock } from '@/services/auth/__tests__/nativeMocks';

const secureStore = jest.requireMock('expo-secure-store') as SecureStoreMock;

/** The production `reset` action, captured before `beforeEach` swaps in a spy. */
const realReset = useAppStore.getState().reset;

const ADA = { email: 'ada@example.com', password: 'a very good password', displayName: 'Ada' };
const GRACE = { email: 'grace@example.com', password: 'another good password', displayName: 'Grace' };

let invalidate: jest.Mock;
let bootstrap: jest.Mock;
let reset: jest.Mock;

beforeEach(async () => {
  await setupTestDb();
  __resetAuthState();
  __resetSessionStorage();
  secureStore.__store.clear();
  secureStore.__fail.read = false;
  secureStore.__fail.write = false;

  useAuthStore.setState({
    session: null,
    accounts: [],
    status: 'loading',
    error: null,
    busy: false,
  });

  invalidate = jest.fn();
  bootstrap = jest.fn(async () => {});
  reset = jest.fn();
  realReset();
  useAppStore.setState({ invalidate, bootstrap, reset });
});

afterEach(async () => {
  await teardownTestDb();
});

describe('authStore — restore', () => {
  it('lands on signed_out with no persisted session', async () => {
    await useAuthStore.getState().restore();

    const state = useAuthStore.getState();
    expect(state.status).toBe('signed_out');
    expect(state.session).toBeNull();
    expect(state.busy).toBe(false);
    expect(state.accounts).toEqual([]);
  });

  it('restores a persisted session and reloads the app data layer', async () => {
    const created = await signUp(ADA);
    __resetAuthState();

    await useAuthStore.getState().restore();

    const state = useAuthStore.getState();
    expect(state.status).toBe('signed_in');
    expect(state.session?.accountId).toBe(created.data?.accountId);
    expect(state.accounts.map((a) => a.email)).toEqual(['ada@example.com']);
    expect(reset).toHaveBeenCalled();
    expect(bootstrap).toHaveBeenCalled();
  });
});

describe('authStore — signUp', () => {
  it('signs the new account in and resets the app data layer', async () => {
    const result = await useAuthStore.getState().signUp(ADA);

    expect(result.ok).toBe(true);
    const state = useAuthStore.getState();
    expect(state.status).toBe('signed_in');
    expect(state.session?.email).toBe('ada@example.com');
    expect(state.error).toBeNull();
    expect(state.busy).toBe(false);
    expect(state.accounts).toHaveLength(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('surfaces the failure message and stays signed out', async () => {
    const result = await useAuthStore.getState().signUp({ ...ADA, password: 'short' });

    expect(result.ok).toBe(false);
    const state = useAuthStore.getState();
    expect(state.status).not.toBe('signed_in');
    expect(state.session).toBeNull();
    expect(state.error).toContain('8 characters');
    expect(state.busy).toBe(false);
    expect(bootstrap).not.toHaveBeenCalled();
  });
});

describe('authStore — signIn / signOut', () => {
  it('signs in and resets the app data layer', async () => {
    await signUp(ADA);
    __resetAuthState();
    invalidate.mockClear();
    bootstrap.mockClear();
    reset.mockClear();

    const result = await useAuthStore.getState().signIn({
      email: 'ADA@Example.com',
      password: ADA.password,
    });

    expect(result.ok).toBe(true);
    expect(useAuthStore.getState().status).toBe('signed_in');
    expect(reset).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('records a generic error on bad credentials', async () => {
    await signUp(ADA);
    __resetAuthState();

    const result = await useAuthStore.getState().signIn({ email: ADA.email, password: 'wrong pw!' });

    expect(result.ok).toBe(false);
    const state = useAuthStore.getState();
    expect(state.error).toBe('Incorrect email or password.');
    expect(state.session).toBeNull();
    expect(state.busy).toBe(false);
  });

  it('signs out, clears the session and resets the app data layer', async () => {
    await useAuthStore.getState().signUp(ADA);
    invalidate.mockClear();
    bootstrap.mockClear();
    reset.mockClear();

    await useAuthStore.getState().signOut();

    const state = useAuthStore.getState();
    expect(state.status).toBe('signed_out');
    expect(state.session).toBeNull();
    expect(state.busy).toBe(false);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    // Accounts stay listed so the picker still works while signed out.
    expect(state.accounts).toHaveLength(1);
  });
});

describe('authStore — switchAccount', () => {
  it('switches account and resets the app data layer', async () => {
    const ada = await signUp(ADA);
    await signUp(GRACE);
    await useAuthStore.getState().restore();
    invalidate.mockClear();
    bootstrap.mockClear();
    reset.mockClear();

    const result = await useAuthStore
      .getState()
      .switchAccount(ada.data!.accountId, ADA.password);

    expect(result.ok).toBe(true);
    expect(useAuthStore.getState().session?.accountId).toBe(ada.data?.accountId);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('keeps the current session and reports the error on a wrong password', async () => {
    const ada = await signUp(ADA);
    const grace = await signUp(GRACE);
    await useAuthStore.getState().restore();
    invalidate.mockClear();
    bootstrap.mockClear();
    reset.mockClear();

    const result = await useAuthStore.getState().switchAccount(ada.data!.accountId, 'nope nope!');

    expect(result.ok).toBe(false);
    expect(useAuthStore.getState().session?.accountId).toBe(grace.data?.accountId);
    expect(useAuthStore.getState().error).toBe('Incorrect email or password.');
    expect(bootstrap).not.toHaveBeenCalled();
  });
});

describe('authStore — accounts and errors', () => {
  it('refreshes the account list, most recently used first', async () => {
    await signUp(ADA);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await signUp(GRACE);

    await useAuthStore.getState().refreshAccounts();

    expect(useAuthStore.getState().accounts.map((a) => a.email)).toEqual([
      'grace@example.com',
      'ada@example.com',
    ]);
  });

  it('clears the error', async () => {
    await useAuthStore.getState().signUp({ ...ADA, email: 'nope' });
    expect(useAuthStore.getState().error).not.toBeNull();

    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('never lets a broken app store break a sign-in', async () => {
    useAppStore.setState({
      reset: () => {
        throw new Error('boom');
      },
    });

    const result = await useAuthStore.getState().signUp(ADA);

    expect(result.ok).toBe(true);
    expect(useAuthStore.getState().status).toBe('signed_in');
  });
});

describe('authStore — cross-account data leak (regression)', () => {
  /**
   * `invalidate()` bumps `dataVersion` but RETAINS profile/goal/settings, and
   * `bootstrap()` falls back to the retained value when the new account has no
   * row (`profile ?? state.profile`). Without `appStore.reset()` account B would
   * read account A's profile and goal on a shared device.
   */
  function useRealReset(): void {
    useAppStore.setState({ reset: realReset, bootstrap });
  }

  it('clears the previous account profile, goal and settings on sign-out', async () => {
    await useAuthStore.getState().signUp(ADA);
    useRealReset();
    useAppStore.setState({
      profile: { id: 'me', sex: 'female', birthDate: '1815-12-10', heightCm: 170, activityLevel: 'moderate', createdAt: 'x', updatedAt: 'x' } as never,
      goal: { id: 'g1', type: 'lose', targetWeightKg: 60, rateKgPerWeek: 0.5, calorieTarget: 1800, proteinG: 120, carbsG: 180, fatG: 60, isActive: true, createdAt: 'x', updatedAt: 'x' } as never,
      settings: { ...useAppStore.getState().settings, weightUnit: 'kg' },
    });

    await useAuthStore.getState().signOut();

    const app = useAppStore.getState();
    expect(app.profile).toBeNull();
    expect(app.goal).toBeNull();
    expect(app.settings.weightUnit).toBe(DEFAULT_SETTINGS.weightUnit);
  });

  it('clears the previous account data when switching accounts', async () => {
    const ada = await signUp(ADA);
    await signUp(GRACE);
    await useAuthStore.getState().restore();
    useRealReset();
    useAppStore.setState({ profile: { id: 'me' } as never });

    const result = await useAuthStore.getState().switchAccount(ada.data!.accountId, ADA.password);

    expect(result.ok).toBe(true);
    expect(useAppStore.getState().profile).toBeNull();
  });

  it('bumps dataVersion so every screen re-queries under the new scope', async () => {
    await useAuthStore.getState().signUp(ADA);
    useRealReset();
    const before = useAppStore.getState().dataVersion;

    await useAuthStore.getState().signOut();

    expect(useAppStore.getState().dataVersion).toBeGreaterThan(before);
  });
});
