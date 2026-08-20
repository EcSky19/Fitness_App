import type { Result } from '@/types';

import { parseOpenFoodFactsProduct } from './parse';
import type { BarcodeProduct, BarcodeProvider } from './types';
import { BarcodeError, OPENFOODFACTS_PROVIDER_ID, redact, safeLookupError } from './types';

export const OPENFOODFACTS_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';
export const OPENFOODFACTS_USER_AGENT = 'MacroTrack/1.0 (Expo; barcode product lookup; contact: local-first-app)';

const FIELDS = [
  'status',
  'code',
  'product_name',
  'product_name_en',
  'generic_name',
  'abbreviated_product_name',
  'brands',
  'serving_size',
  'serving_quantity',
  'image_url',
  'image_front_url',
  'nutriments',
].join(',');

let timeoutMs = 10_000;

export function __setOpenFoodFactsTimeoutMs(ms: number): void {
  timeoutMs = Math.max(1, ms);
}

function abortError(): Error {
  return Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

async function safeText(response: Response, barcode: string): Promise<string> {
  try {
    return redact(await response.text(), barcode);
  } catch {
    return '';
  }
}

function mapStatus(status: number): BarcodeError {
  if (status >= 500) {
    return new BarcodeError('server', 'Product lookup is temporarily unavailable. Try again in a moment.', status);
  }
  return new BarcodeError('bad_request', 'Product lookup failed. Try again in a moment.', status);
}

async function requestProduct(barcode: string, signal?: AbortSignal): Promise<BarcodeProduct | null> {
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${OPENFOODFACTS_ENDPOINT}${encodeURIComponent(barcode)}.json?fields=${encodeURIComponent(FIELDS)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': OPENFOODFACTS_USER_AGENT,
      },
      signal: controller.signal,
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      const mapped = mapStatus(response.status);
      throw new BarcodeError(mapped.code, mapped.message, mapped.status, await safeText(response, barcode));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BarcodeError('parse', 'Product lookup returned a malformed response.');
    }

    try {
      return parseOpenFoodFactsProduct(payload, barcode);
    } catch {
      throw new BarcodeError('parse', 'Product lookup returned an unexpected response.');
    }
  } catch (error) {
    if (error instanceof BarcodeError) throw error;
    const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name?: unknown }).name) : '';
    if (name === 'AbortError') {
      throw new BarcodeError('timeout', 'Product lookup timed out. Check your connection and try again.');
    }
    throw new BarcodeError('network', 'Product lookup failed. Check your connection and try again.', null, redact(error instanceof Error ? error.message : String(error), barcode));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const openFoodFactsProvider: BarcodeProvider = {
  id: OPENFOODFACTS_PROVIDER_ID,
  label: 'Open Food Facts',

  /**
   * Sends the scanned barcode to Open Food Facts over HTTPS. Barcodes are user
   * data; callers should only invoke this after local lookup misses and should
   * surface network failures separately from a genuine not-found result.
   */
  async lookup(barcode: string, signal?: AbortSignal): Promise<Result<BarcodeProduct | null>> {
    try {
      return { ok: true, data: await requestProduct(barcode, signal) };
    } catch (error) {
      return { ok: false, error: safeLookupError(error, barcode) };
    }
  },
};

export default openFoodFactsProvider;
