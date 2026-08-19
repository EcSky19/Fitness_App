/**
 * Native-module shims for the auth test suites.
 *
 * `expo-crypto` is replaced by a REAL SHA-256 (node:crypto) behind the same
 * async surface, and `expo-secure-store` by an in-memory map. The hashing,
 * salting, verification and lockout logic under test is the production code —
 * only the native boundary is swapped.
 *
 * Usage (the factory must not close over anything, hence the inner require):
 *   jest.mock('expo-crypto', () => require('@/services/auth/__tests__/nativeMocks').cryptoMock());
 *   jest.mock('expo-secure-store', () => require('@/services/auth/__tests__/nativeMocks').secureStoreMock());
 */
import { createHash, randomBytes } from 'node:crypto';

export interface CryptoMock {
  /**
   * REQUIRED. Without it Babel's `_interopRequireWildcard` hands
   * `import * as Crypto from 'expo-crypto'` a COPY of this object, so
   * `jest.spyOn(requireMock('expo-crypto'), ...)` would silently observe
   * nothing and any digest-counting assertion would pass vacuously.
   */
  __esModule: true;
  CryptoDigestAlgorithm: { SHA256: string; SHA512: string };
  CryptoEncoding: { HEX: string; BASE64: string };
  digestStringAsync(algorithm: string, data: string, options?: { encoding?: string }): Promise<string>;
  getRandomBytesAsync(byteCount: number): Promise<Uint8Array>;
  getRandomBytes(byteCount: number): Uint8Array;
}

export function cryptoMock(): CryptoMock {
  return {
    __esModule: true,
    CryptoDigestAlgorithm: { SHA256: 'SHA-256', SHA512: 'SHA-512' },
    CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
    async digestStringAsync(algorithm, data, options): Promise<string> {
      const nodeAlgorithm = algorithm === 'SHA-512' ? 'sha512' : 'sha256';
      const encoding = options?.encoding === 'base64' ? 'base64' : 'hex';
      return createHash(nodeAlgorithm).update(data, 'utf8').digest(encoding);
    },
    async getRandomBytesAsync(byteCount): Promise<Uint8Array> {
      return new Uint8Array(randomBytes(byteCount));
    },
    getRandomBytes(byteCount): Uint8Array {
      return new Uint8Array(randomBytes(byteCount));
    },
  };
}

export interface SecureStoreMock {
  /** See {@link CryptoMock.__esModule} — keeps the module identity spy-able. */
  __esModule: true;
  __store: Map<string, string>;
  __fail: { read: boolean; write: boolean };
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
  getItem(key: string): string | null;
}

export function secureStoreMock(): SecureStoreMock {
  const store = new Map<string, string>();
  const failures = { read: false, write: false };

  return {
    __esModule: true,
    __store: store,
    __fail: failures,
    async getItemAsync(key): Promise<string | null> {
      if (failures.read) throw new Error('SecureStore unavailable');
      return store.get(key) ?? null;
    },
    async setItemAsync(key, value): Promise<void> {
      if (failures.write) throw new Error('SecureStore unavailable');
      store.set(key, value);
    },
    async deleteItemAsync(key): Promise<void> {
      store.delete(key);
    },
    getItem(key): string | null {
      return store.get(key) ?? null;
    },
  };
}
