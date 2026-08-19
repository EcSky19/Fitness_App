/**
 * Session persistence for the auth service.
 *
 * The signed-in descriptor lives in `expo-secure-store` under
 * `macrotrack.auth.session`. Only the descriptor — account id, email, display
 * name, timestamp — is written. The password, its hash and its salt NEVER leave
 * the `accounts` table.
 *
 * SecureStore is unavailable on web and on some Expo Go paths, so every call is
 * guarded and falls back to a process-lifetime in-memory slot. Nothing here
 * throws: losing persistence must degrade to "signed out on next launch", never
 * to a crash.
 */
import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from '@/types';

export const SESSION_STORAGE_KEY = 'macrotrack.auth.session';

/** Used whenever SecureStore is missing or refuses to read/write. */
let memoryFallback: string | null = null;

function isSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<AuthSession>;
  return (
    typeof s.accountId === 'string' &&
    s.accountId.length > 0 &&
    typeof s.email === 'string' &&
    typeof s.displayName === 'string' &&
    typeof s.signedInAt === 'string'
  );
}

/** Reads the persisted descriptor. Returns `null` when absent or corrupt. */
export async function loadStoredSession(): Promise<AuthSession | null> {
  let raw: string | null = memoryFallback;

  try {
    if (typeof SecureStore.getItemAsync === 'function') {
      raw = (await SecureStore.getItemAsync(SESSION_STORAGE_KEY)) ?? memoryFallback;
    }
  } catch {
    raw = memoryFallback;
  }

  if (typeof raw !== 'string' || raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists the descriptor. Never throws. */
export async function saveStoredSession(session: AuthSession): Promise<void> {
  const raw = JSON.stringify(session);
  memoryFallback = raw;
  try {
    if (typeof SecureStore.setItemAsync === 'function') {
      await SecureStore.setItemAsync(SESSION_STORAGE_KEY, raw);
    }
  } catch {
    // In-memory fallback still serves this session.
  }
}

/** Removes the descriptor from both stores. Never throws. */
export async function clearStoredSession(): Promise<void> {
  memoryFallback = null;
  try {
    if (typeof SecureStore.deleteItemAsync === 'function') {
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
    }
  } catch {
    // Nothing to do — the in-memory slot is already cleared.
  }
}

/** Test hook: drops the in-memory fallback slot. */
export function __resetSessionStorage(): void {
  memoryFallback = null;
}
