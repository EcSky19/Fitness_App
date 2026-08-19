/**
 * Image helpers for the vision pipeline.
 *
 * SDK 54 ships the object-oriented `expo-file-system` API (`new File(uri).base64()`),
 * which is what we use. The pre-SDK-52 `readAsStringAsync` helper now lives in
 * `expo-file-system/legacy` and is only reached as a runtime fallback for
 * environments where the new class is unavailable.
 */
import { File } from 'expo-file-system';

import { MAX_IMAGE_BYTES, VisionError } from './types';

export { MAX_IMAGE_BYTES };

export interface EncodedImage {
  base64: string;
  mimeType: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export const DEFAULT_MIME_TYPE = 'image/jpeg';

/** Infers the MIME type from a file extension; defaults to `image/jpeg`. */
export function mimeTypeFromUri(uri: string): string {
  if (typeof uri !== 'string') return DEFAULT_MIME_TYPE;

  const dataMatch = uri.match(/^data:([^;,]+)[;,]/i);
  if (dataMatch?.[1]) return dataMatch[1].toLowerCase();

  const withoutQuery = uri.split('?')[0]?.split('#')[0] ?? '';
  const extension = withoutQuery.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? DEFAULT_MIME_TYPE;
}

/** Decoded byte size of a base64 payload, without allocating it. */
export function estimateBase64Bytes(base64: string): number {
  if (typeof base64 !== 'string' || base64.length === 0) return 0;
  const payload = base64.includes(',') ? (base64.split(',').pop() ?? '') : base64;
  const clean = payload.replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Throws when a payload exceeds the provider-friendly ceiling. */
export function assertImageSize(base64: string): void {
  const bytes = estimateBase64Bytes(base64);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new VisionError(
      'too_large',
      `Image too large (${formatBytes(bytes)}). Retake the photo at a lower resolution.`
    );
  }
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return commaIndex >= 0 && value.slice(0, commaIndex).includes('base64')
    ? value.slice(commaIndex + 1)
    : value;
}

interface LegacyFileSystem {
  readAsStringAsync?: (uri: string, options?: { encoding?: string }) => Promise<string>;
}

/** Pre-SDK-52 reader, only used when the `File` class is missing or fails. */
async function readWithLegacyApi(uri: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = require('expo-file-system/legacy') as LegacyFileSystem;
    if (typeof legacy?.readAsStringAsync !== 'function') return null;
    const base64 = await legacy.readAsStringAsync(uri, { encoding: 'base64' });
    return typeof base64 === 'string' && base64.length > 0 ? base64 : null;
  } catch {
    return null;
  }
}

/**
 * Reads a local image URI (or `data:` URL) and returns its base64 payload plus
 * MIME type. Throws a `VisionError` with a user-facing message on failure.
 */
export async function imageUriToBase64(uri: string): Promise<EncodedImage> {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new VisionError('bad_request', 'No photo was provided.');
  }

  const trimmed = uri.trim();
  const mimeType = mimeTypeFromUri(trimmed);

  if (trimmed.startsWith('data:')) {
    const base64 = stripDataUrlPrefix(trimmed);
    if (!base64) throw new VisionError('bad_request', "Couldn't read the photo. Try taking it again.");
    assertImageSize(base64);
    return { base64, mimeType };
  }

  let base64: string | null = null;
  let firstError: unknown = null;

  try {
    const file = new File(trimmed);
    base64 = await file.base64();
  } catch (error) {
    firstError = error;
  }

  if (!base64) {
    base64 = await readWithLegacyApi(trimmed);
  }

  if (!base64) {
    const reason = firstError instanceof Error ? firstError.message : '';
    throw new VisionError(
      'bad_request',
      "Couldn't read the photo. Try taking it again.",
      null,
      reason || null
    );
  }

  const payload = stripDataUrlPrefix(base64);
  assertImageSize(payload);
  return { base64: payload, mimeType };
}
