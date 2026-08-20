import type { Food, Result } from '@/types';

import { isValidBarcode, normalizeBarcode } from './barcode';
import { mockBarcodeProvider } from './mockProvider';
import { openFoodFactsProvider } from './openFoodFactsProvider';
import type { BarcodeProduct, BarcodeProvider } from './types';
import { DEFAULT_BARCODE_PROVIDER_ID, MOCK_PROVIDER_ID, OPENFOODFACTS_PROVIDER_ID, safeLookupError } from './types';

interface RepositoriesShape {
  getFoodByBarcode?: (barcode: string) => Promise<Food | null>;
}

interface StoreShape {
  useAppStore?: {
    getState: () => {
      settings?: { barcodeProvider?: unknown };
      updateSettings?: (patch: { barcodeProvider: string }) => unknown;
    };
  };
}

const PROVIDERS: BarcodeProvider[] = [openFoodFactsProvider, mockBarcodeProvider];
const BY_ID = new Map<string, BarcodeProvider>(PROVIDERS.map((provider) => [provider.id, provider]));
const PROVIDER_IDS = [OPENFOODFACTS_PROVIDER_ID, MOCK_PROVIDER_ID];

/**
 * Read lazily so the barcode service never hard-depends on the store (and so a
 * store/database failure can never break barcode scanning).
 */
function providerIdFromSettings(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('@/store/appStore') as StoreShape;
    const selected = store.useAppStore?.getState().settings?.barcodeProvider;
    return typeof selected === 'string' && selected.trim() ? selected.trim() : null;
  } catch {
    return null;
  }
}

function providerIdFromEnv(): string | null {
  const configured = process.env.EXPO_PUBLIC_BARCODE_PROVIDER;
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  return trimmed || null;
}

export function resolveBarcodeProviderId(id?: string): string {
  const explicit = typeof id === 'string' ? id.trim() : '';
  const candidate = explicit || providerIdFromSettings() || providerIdFromEnv() || DEFAULT_BARCODE_PROVIDER_ID;
  return BY_ID.has(candidate) ? candidate : DEFAULT_BARCODE_PROVIDER_ID;
}

function getProvider(): BarcodeProvider {
  return BY_ID.get(resolveBarcodeProviderId()) ?? openFoodFactsProvider;
}

function foodToProduct(food: Food, barcode: string): BarcodeProduct {
  return {
    barcode,
    name: food.name,
    brand: food.brand,
    per100g: { ...food.per100g },
    servingSizeG: food.servingSizeG ?? null,
    imageUrl: null,
    source: 'local',
  };
}

async function localLookup(barcode: string): Promise<BarcodeProduct | null> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const repos = require('@/db/repositories') as RepositoriesShape;
  const food = await repos.getFoodByBarcode?.(barcode);
  return food ? foodToProduct(food, barcode) : null;
}

export { isValidBarcode } from './barcode';
export type { BarcodeProduct, BarcodeProvider } from './types';

/**
 * Looks up a barcode locally first, then (on a local miss) sends the barcode to
 * the selected provider. The default provider is Open Food Facts, so a barcode
 * may leave the device over HTTPS; network failures are returned as safe
 * `{ ok: false }` results and never expose raw provider responses.
 */
export async function lookupBarcode(barcode: string): Promise<Result<BarcodeProduct | null>> {
  const normalized = normalizeBarcode(barcode);
  if (!isValidBarcode(normalized)) return { ok: false, error: 'Invalid barcode. Try scanning again.' };

  try {
    const local = await localLookup(normalized);
    if (local) return { ok: true, data: local };
  } catch (error) {
    return { ok: false, error: safeLookupError(error, normalized) };
  }

  return getProvider().lookup(normalized);
}

export function listBarcodeProviders(): Array<{ id: string; label: string }> {
  return PROVIDERS.map((provider) => ({ id: provider.id, label: provider.label }));
}

export function setBarcodeProvider(id: string): void {
  if (!PROVIDER_IDS.includes(id)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('@/store/appStore') as StoreShape;
    const result = store.useAppStore?.getState().updateSettings?.({ barcodeProvider: id });
    void Promise.resolve(result).catch(() => {
      // Best effort: an unwritable settings store must not create an unhandled rejection.
    });
  } catch {
    // Best effort: an unavailable store/database must not break scanning.
  }
}

export function getBarcodeProviderId(): string {
  return resolveBarcodeProviderId();
}

export function __resetBarcodeProviderForTests(): void {
  // Kept for older focused tests; provider selection now lives in app settings.
}
