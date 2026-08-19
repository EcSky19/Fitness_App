/**
 * API key storage for the vision providers.
 *
 * Keys live in `expo-secure-store` under `macrotrack.vision.<providerId>` with a
 * process-lifetime in-memory cache so `VisionProvider.isConfigured()` can stay
 * synchronous. When SecureStore is unavailable (web, some Expo Go paths) the
 * cache becomes the only store for the current session, and writes report that
 * the key was not persisted permanently.
 */
import * as SecureStore from 'expo-secure-store';

import { GEMINI_PROVIDER_ID, OPENAI_PROVIDER_ID } from './types';

export const API_KEY_PREFIX = 'macrotrack.vision.';

/** `null` means "known to be absent"; a missing entry means "not read yet". */
const cache = new Map<string, string | null>();

export interface ApiKeyWriteResult {
  persisted: boolean;
  error?: unknown;
}

export function apiKeyStorageKey(providerId: string): string {
  return `${API_KEY_PREFIX}${providerId}`;
}

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `EXPO_PUBLIC_*` variables are inlined at build time, so each one must be
 * referenced literally — a computed `process.env[name]` lookup would be empty
 * in a release bundle. They are development-only fallbacks: release builds must
 * not read inlined client-bundle values as secrets.
 */
export function envApiKey(providerId: string): string | null {
  const dev = typeof __DEV__ === 'undefined' ? process.env.NODE_ENV !== 'production' : __DEV__;
  if (!dev) return null;

  switch (providerId) {
    case OPENAI_PROVIDER_ID:
      return normalize(process.env.EXPO_PUBLIC_OPENAI_API_KEY);
    case GEMINI_PROVIDER_ID:
      return normalize(process.env.EXPO_PUBLIC_GEMINI_API_KEY);
    default:
      return null;
  }
}

function readSecureSync(providerId: string): string | null {
  try {
    if (typeof SecureStore.getItem !== 'function') return null;
    return normalize(SecureStore.getItem(apiKeyStorageKey(providerId)));
  } catch {
    return null;
  }
}

async function readSecureAsync(providerId: string): Promise<string | null> {
  try {
    if (typeof SecureStore.getItemAsync !== 'function') return null;
    return normalize(await SecureStore.getItemAsync(apiKeyStorageKey(providerId)));
  } catch {
    return null;
  }
}

/** Stores a key. An empty string clears it. Reports when SecureStore persistence failed. */
export async function setApiKey(providerId: string, key: string): Promise<ApiKeyWriteResult> {
  const value = normalize(key);
  cache.set(providerId, value);

  try {
    if (value === null) {
      if (typeof SecureStore.deleteItemAsync === 'function') {
        await SecureStore.deleteItemAsync(apiKeyStorageKey(providerId));
        return { persisted: true };
      }
      return { persisted: false };
    }
    if (typeof SecureStore.setItemAsync === 'function') {
      await SecureStore.setItemAsync(apiKeyStorageKey(providerId), value);
      return { persisted: true };
    }
    return { persisted: false };
  } catch (error) {
    // Secure storage unavailable: the in-memory cache still serves this session.
    return { persisted: false, error };
  }
}

/** Resolves the usable key: SecureStore (or cache) first, then the env var. */
export async function getApiKey(providerId: string): Promise<string | null> {
  const stored = await getStoredApiKey(providerId);
  return stored ?? envApiKey(providerId);
}

/** Only the user-entered key, ignoring env fallbacks. Used by Settings. */
export async function getStoredApiKey(providerId: string): Promise<string | null> {
  if (cache.has(providerId)) return cache.get(providerId) ?? null;
  const stored = await readSecureAsync(providerId);
  cache.set(providerId, stored);
  return stored;
}

export async function clearApiKey(providerId: string): Promise<ApiKeyWriteResult> {
  return setApiKey(providerId, '');
}

/** Synchronous resolution used by `isConfigured()`. */
export function getApiKeySync(providerId: string): string | null {
  if (!cache.has(providerId)) {
    cache.set(providerId, readSecureSync(providerId));
  }
  return (cache.get(providerId) ?? null) ?? envApiKey(providerId);
}

export function hasApiKey(providerId: string): boolean {
  return getApiKeySync(providerId) !== null;
}

/** Warms the cache so later synchronous checks are cheap. Never throws. */
export async function hydrateApiKeys(
  providerIds: string[] = [OPENAI_PROVIDER_ID, GEMINI_PROVIDER_ID]
): Promise<void> {
  await Promise.all(providerIds.map((id) => getStoredApiKey(id)));
}

/** Test helper: drops the in-memory cache. */
export function __resetApiKeyCache(): void {
  cache.clear();
}
