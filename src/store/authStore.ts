/**
 * Auth state (zustand).
 *
 * Usage:
 *   const session = useAuthStore((s) => s.session);
 *   const signIn  = useAuthStore((s) => s.signIn);
 *
 * Mirrors `@/store/appStore`: plain `create()`, async actions that swallow their
 * own failures, and a lazily `require()`d dependency on the other store.
 *
 * Whenever the signed-in account changes, the app data layer MUST be reset —
 * `useAppStore` still holds the previous account's profile, goal and settings.
 * `resetAppData()` bumps `dataVersion` (so every `useAsyncData` screen re-queries
 * against the new scope) and re-runs `bootstrap()` (so the store's own cached
 * profile/goal/settings are reloaded).
 */
import { create } from 'zustand';

import * as auth from '@/services/auth';
import type { Account, AuthResult, AuthSession, ID } from '@/types';

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in';

export interface AuthState {
  session: AuthSession | null;
  accounts: Account[];
  status: AuthStatus;
  error: string | null;
  busy: boolean;
  restore: () => Promise<void>;
  signUp: (input: auth.SignUpInput) => Promise<AuthResult<AuthSession>>;
  signIn: (input: auth.SignInInput) => Promise<AuthResult<AuthSession>>;
  signOut: () => Promise<void>;
  switchAccount: (accountId: ID, password: string) => Promise<AuthResult<AuthSession>>;
  refreshAccounts: () => Promise<void>;
  clearError: () => void;
}

interface AppStoreModule {
  useAppStore?: {
    getState: () => {
      reset?: () => void;
      invalidate?: () => void;
      bootstrap?: () => Promise<void>;
    };
  };
}

/**
 * `require()` — NOT `await import()`.
 *
 * The dynamic form resolves to a rejected promise under jest-expo and is fragile
 * in Metro, which silently left the app store un-reloaded. `@/store/appStore` is
 * a string literal so Metro can still resolve it statically.
 */
function loadAppStore(): AppStoreModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    return require('@/store/appStore') as AppStoreModule;
  } catch {
    return null;
  }
}

/**
 * Drops every cached row from the previous account and reloads the new one's.
 *
 * `reset()` is the important half: `invalidate()` alone bumps `dataVersion` but
 * KEEPS the loaded profile/goal/settings in memory, so account B would briefly
 * read account A's data — a real cross-account leak on a shared device.
 * `bootstrap()` cannot repair that by itself because it falls back to the
 * retained value when the new account has no row yet.
 *
 * Best effort: a data-layer failure must never break an otherwise valid sign-in.
 */
async function resetAppData(): Promise<void> {
  try {
    const state = loadAppStore()?.useAppStore?.getState();
    if (typeof state?.reset === 'function') state.reset();
    else state?.invalidate?.();
    if (typeof state?.bootstrap === 'function') await state.bootstrap();
  } catch {
    // Screens will recover on their next render.
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  accounts: [],
  status: 'loading',
  error: null,
  busy: false,

  restore: async () => {
    set({ busy: true, error: null });
    let session: AuthSession | null = null;
    try {
      session = await auth.restoreSession();
    } catch {
      session = null;
    }
    set({
      session,
      status: session ? 'signed_in' : 'signed_out',
      busy: false,
    });
    await get().refreshAccounts();
    if (session) await resetAppData();
  },

  signUp: async (input) => {
    set({ busy: true, error: null });
    const result = await auth.signUp(input);
    if (result.ok && result.data) {
      set({ session: result.data, status: 'signed_in', busy: false, error: null });
      await resetAppData();
      await get().refreshAccounts();
    } else {
      set({ busy: false, error: result.error ?? 'Sign up failed.' });
    }
    return result;
  },

  signIn: async (input) => {
    set({ busy: true, error: null });
    const result = await auth.signIn(input);
    if (result.ok && result.data) {
      set({ session: result.data, status: 'signed_in', busy: false, error: null });
      await resetAppData();
      await get().refreshAccounts();
    } else {
      set({ busy: false, error: result.error ?? 'Sign in failed.' });
    }
    return result;
  },

  signOut: async () => {
    set({ busy: true, error: null });
    try {
      await auth.signOut();
    } catch {
      // Signing out must always succeed locally.
    }
    set({ session: null, status: 'signed_out', busy: false, error: null });
    await resetAppData();
    await get().refreshAccounts();
  },

  switchAccount: async (accountId, password) => {
    set({ busy: true, error: null });
    const result = await auth.switchAccount(accountId, password);
    if (result.ok && result.data) {
      set({ session: result.data, status: 'signed_in', busy: false, error: null });
      await resetAppData();
      await get().refreshAccounts();
    } else {
      set({ busy: false, error: result.error ?? 'Could not switch account.' });
    }
    return result;
  },

  refreshAccounts: async () => {
    try {
      set({ accounts: await auth.listAccounts() });
    } catch {
      set({ accounts: [] });
    }
  },

  clearError: () => set({ error: null }),
}));
