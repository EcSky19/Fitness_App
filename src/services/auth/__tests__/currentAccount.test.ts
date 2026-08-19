/**
 * Contract tests for the synchronous scoping accessor the repository layer
 * depends on.
 *
 * Note what this file deliberately does NOT do: it never mocks `expo-crypto` or
 * `expo-secure-store`. If `@/services/auth/currentAccount` ever grows a runtime
 * import it will stop being importable from a bare repository module (and from
 * `@/db/repositories/admin`, which sits inside `@/db/repositories/index`), and
 * these tests will fail.
 */
import {
  getCurrentAccountId,
  getCurrentSession,
  setCurrentSession,
} from '@/services/auth/currentAccount';
import type { AuthSession } from '@/types';

const SESSION: AuthSession = {
  accountId: 'acc-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  signedInAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  setCurrentSession(null);
});

describe('auth/currentAccount', () => {
  it('returns null for both accessors when nobody is signed in', () => {
    setCurrentSession(null);

    expect(getCurrentSession()).toBeNull();
    expect(getCurrentAccountId()).toBeNull();
  });

  it('returns the signed-in account id synchronously', () => {
    setCurrentSession(SESSION);

    const id = getCurrentAccountId();
    expect(id).toBe('acc-1');
    // Synchronous by contract: the value is a plain string, never a promise.
    expect(typeof id).toBe('string');
    expect(id).not.toBeInstanceOf(Promise);
  });

  it('never throws and never awaits, so it is safe on every query path', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(() => getCurrentAccountId()).not.toThrow();
    }
  });

  it('has no runtime dependency on a native module', () => {
    // Loading in a fresh registry must not require expo-crypto / expo-secure-store
    // / expo-sqlite, which are not mocked in this file.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
      const mod = require('@/services/auth/currentAccount') as {
        getCurrentAccountId: () => string | null;
      };
      expect(mod.getCurrentAccountId()).toBeNull();
    });
  });

  it('is the same module instance the auth service writes to', () => {
    // The service re-exports these; a second copy of the module would silently
    // give repositories a session that never changes.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const leaf = require('@/services/auth/currentAccount') as {
      setCurrentSession: (s: AuthSession | null) => void;
      getCurrentAccountId: () => string | null;
    };

    leaf.setCurrentSession(SESSION);
    expect(getCurrentAccountId()).toBe('acc-1');
  });
});
