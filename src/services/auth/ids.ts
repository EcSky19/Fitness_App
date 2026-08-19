/**
 * Cryptographically-secure identifiers for security-bearing values.
 *
 * `newId()` in `@/db/client` is backed by `nanoid/non-secure`, i.e.
 * `Math.random()`. That is fine for ordinary row ids, which are never secrets
 * and are always reachable only through an already-authorised query — but it
 * must NEVER generate an account id, a salt or anything that ends up in a
 * session descriptor. `Math.random()` state is recoverable from a handful of
 * outputs, so ids minted with it are predictable.
 *
 * Everything here draws from `Crypto.getRandomBytesAsync`, the CSPRNG expo-crypto
 * exposes (SecRandomCopyBytes / java.security.SecureRandom).
 */
import * as Crypto from 'expo-crypto';

/** 16 bytes = 128 bits of entropy, hex encoded to 32 characters. */
export const SECURE_ID_BYTES = 16;

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    out += HEX[(byte >> 4) & 0x0f] + HEX[byte & 0x0f];
  }
  return out;
}

/**
 * A fresh CSPRNG identifier.
 *
 * Deliberately has no `Math.random()` fallback: if the platform CSPRNG is
 * unavailable this throws rather than silently minting a guessable id.
 */
export async function newSecureId(bytes: number = SECURE_ID_BYTES): Promise<string> {
  const size = Number.isFinite(bytes) && bytes >= SECURE_ID_BYTES ? Math.trunc(bytes) : SECURE_ID_BYTES;
  const random = await Crypto.getRandomBytesAsync(size);
  const view = random instanceof Uint8Array ? random : Uint8Array.from(random);
  if (view.length < size) {
    throw new Error('Secure random source returned too few bytes.');
  }
  return toHex(view);
}
