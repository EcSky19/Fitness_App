import type { Macros, Result } from '@/types';

export interface BarcodeProduct {
  barcode: string;
  name: string;
  brand: string | null;
  per100g: Macros;
  servingSizeG: number | null;
  imageUrl: string | null;
  source: 'local' | 'openfoodfacts' | 'mock';
}

export interface BarcodeProvider {
  id: string;
  label: string;
  lookup(barcode: string, signal?: AbortSignal): Promise<Result<BarcodeProduct | null>>;
}

export const OPENFOODFACTS_PROVIDER_ID = 'openfoodfacts';
export const MOCK_PROVIDER_ID = 'mock';
export const DEFAULT_BARCODE_PROVIDER_ID = OPENFOODFACTS_PROVIDER_ID;

export type BarcodeErrorCode = 'network' | 'timeout' | 'server' | 'parse' | 'bad_request' | 'unknown';

export class BarcodeError extends Error {
  readonly code: BarcodeErrorCode;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(code: BarcodeErrorCode, message: string, status: number | null = null, detail: string | null = null) {
    super(message);
    this.name = 'BarcodeError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    Object.setPrototypeOf(this, BarcodeError.prototype);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redact(text: string, barcode?: string | null): string {
  let output = typeof text === 'string' ? text : '';
  const trimmed = typeof barcode === 'string' ? barcode.trim() : '';
  if (trimmed.length >= 6) output = output.split(trimmed).join('[barcode]');
  return output.slice(0, 300);
}

export function safeLookupError(error: unknown, barcode?: string): string {
  if (error instanceof BarcodeError) return error.message;
  const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
  const message = error instanceof Error ? redact(error.message, barcode) : redact(String(error), barcode);
  if (name === 'AbortError' || /abort|timeout/i.test(message)) {
    return 'Product lookup timed out. Check your connection and try again.';
  }
  return 'Product lookup failed. Check your connection and try again.';
}

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}
