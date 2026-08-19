/**
 * Shared internals for the vision service.
 *
 * Holds the constants, error type and hardened HTTP helper that the remote
 * providers (`openaiProvider`, `geminiProvider`) build on. Nothing in here
 * performs I/O on its own, and no API key is ever placed in an error message,
 * `rawText` or a log line.
 */

/** Hard ceiling for a single request. */
export const VISION_TIMEOUT_MS = 45_000;

/** Backoff before the single retry attempt. */
export const VISION_RETRY_DELAY_MS = 1_200;

/** Images larger than this are rejected before any network call. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

export const MOCK_PROVIDER_ID = 'mock';
export const OPENAI_PROVIDER_ID = 'openai';
export const GEMINI_PROVIDER_ID = 'gemini';

export type VisionErrorCode =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'too_large'
  | 'bad_request'
  | 'server'
  | 'parse'
  | 'not_configured'
  | 'unknown';

/** Row shape consumed by the Settings screen. */
export interface VisionProviderInfo {
  id: string;
  label: string;
  modelId: string;
  requiresApiKey: boolean;
  configured: boolean;
}

/** Error carrying a user-safe message; `detail` is always redacted. */
export class VisionError extends Error {
  readonly code: VisionErrorCode;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(code: VisionErrorCode, message: string, status: number | null = null, detail: string | null = null) {
    super(message);
    this.name = 'VisionError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, VisionError.prototype);
  }
}

export function messageForStatus(status: number): { code: VisionErrorCode; message: string } {
  if (status === 401 || status === 403) {
    return { code: 'auth', message: 'Invalid API key. Add a valid key in Settings.' };
  }
  if (status === 429) {
    return { code: 'rate_limit', message: 'Rate limited, try again in a moment.' };
  }
  if (status === 413) {
    return { code: 'too_large', message: 'Image too large.' };
  }
  if (status === 404) {
    return { code: 'bad_request', message: 'That model is not available for this API key. Pick another provider in Settings.' };
  }
  if (status === 400 || status === 422) {
    return { code: 'bad_request', message: 'The image could not be processed. Try a clearer photo.' };
  }
  if (status >= 500) {
    return { code: 'server', message: 'The vision service is temporarily unavailable. Try again in a moment.' };
  }
  return { code: 'unknown', message: `The vision service returned an error (${status}).` };
}

/** Removes any occurrence of a secret from text before it can reach the UI or a log. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let output = text;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 6) continue;
    output = output.split(secret).join('[redacted]');
  }
  return output.replace(/(sk-|AIza)[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface JsonRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** API key used for this request; scrubbed from every error surface. */
  secret?: string | null;
  timeoutMs?: number;
}

function toVisionError(error: unknown, secret?: string | null): VisionError {
  if (error instanceof VisionError) return error;

  const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redact(rawMessage, [secret]);

  if (name === 'AbortError' || /abort/i.test(message)) {
    return new VisionError('timeout', 'The request timed out. Check your connection and try again.', null, message);
  }
  return new VisionError('network', 'Network error. Check your connection and try again.', null, message);
}

function isRetryable(error: VisionError): boolean {
  return error.code === 'network' || error.code === 'rate_limit' || error.code === 'server';
}

async function safeText(response: Response, secret?: string | null): Promise<string> {
  try {
    const text = await response.text();
    return redact(typeof text === 'string' ? text : '', [secret]).slice(0, 300);
  } catch {
    return '';
  }
}

async function attemptJson(request: JsonRequest, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const mapped = messageForStatus(response.status);
      const detail = await safeText(response, request.secret);
      throw new VisionError(mapped.code, mapped.message, response.status, detail);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new VisionError('parse', 'The vision service returned a malformed response.');
    }

    if (!isRecord(payload)) {
      throw new VisionError('parse', 'The vision service returned an unexpected response.');
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POSTs JSON with a 45 s abort timeout and exactly one retry on a network
 * error, HTTP 429 or 5xx (after a ~1.2 s backoff). Always throws `VisionError`.
 */
export async function requestJson(request: JsonRequest): Promise<Record<string, unknown>> {
  const timeoutMs = request.timeoutMs ?? VISION_TIMEOUT_MS;
  const maxAttempts = 2;

  let lastError: VisionError = new VisionError('unknown', 'Something went wrong analyzing the photo.');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await sleep(VISION_RETRY_DELAY_MS);
    try {
      return await attemptJson(request, timeoutMs);
    } catch (error) {
      lastError = toVisionError(error, request.secret);
      if (!isRetryable(lastError) || attempt === maxAttempts - 1) throw lastError;
    }
  }

  throw lastError;
}
