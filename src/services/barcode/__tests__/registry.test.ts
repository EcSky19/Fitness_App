import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';

import {
  __resetBarcodeProviderForTests,
  getBarcodeProviderId,
  listBarcodeProviders,
  lookupBarcode,
  resolveBarcodeProviderId,
  setBarcodeProvider,
} from '../registry';

const mockGetFoodByBarcode = jest.fn();

jest.mock('@/db/repositories', () => ({
  getFoodByBarcode: (...args: unknown[]) => mockGetFoodByBarcode(...args),
}));

const fetchMock = jest.fn();

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
  fetchMock.mockReset();
  mockGetFoodByBarcode.mockReset();
  __resetBarcodeProviderForTests();
  delete process.env.EXPO_PUBLIC_BARCODE_PROVIDER;
  jest.restoreAllMocks();
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, barcodeProvider: 'openfoodfacts' },
  });
});

describe('barcode registry', () => {
  it('lists providers', () => {
    expect(listBarcodeProviders()).toEqual([
      { id: 'openfoodfacts', label: 'Open Food Facts' },
      { id: 'mock', label: 'Demo (offline)' },
    ]);
  });

  it('prefers the persisted setting over the env default', () => {
    process.env.EXPO_PUBLIC_BARCODE_PROVIDER = 'openfoodfacts';
    useAppStore.getState().updateSettings({ barcodeProvider: 'mock' });

    expect(getBarcodeProviderId()).toBe('mock');
  });

  it('lets an explicit id win over the persisted setting', () => {
    useAppStore.getState().updateSettings({ barcodeProvider: 'mock' });

    expect(resolveBarcodeProviderId('openfoodfacts')).toBe('openfoodfacts');
  });

  it('falls back to a valid provider for an unknown persisted id', () => {
    useAppStore.getState().updateSettings({ barcodeProvider: 'removed-provider' });

    expect(getBarcodeProviderId()).toBe('openfoodfacts');
  });

  it('falls back to a valid provider when the store throws', () => {
    jest.spyOn(useAppStore, 'getState').mockImplementationOnce(() => {
      throw new Error('store unavailable');
    });

    expect(getBarcodeProviderId()).toBe('openfoodfacts');
  });

  it('setBarcodeProvider persists through the app store and round-trips', () => {
    setBarcodeProvider('mock');

    expect(useAppStore.getState().settings.barcodeProvider).toBe('mock');
    expect(getBarcodeProviderId()).toBe('mock');
  });

  it('setBarcodeProvider rejects unknown ids without persisting garbage', () => {
    setBarcodeProvider('mock');
    setBarcodeProvider('bogus');

    expect(useAppStore.getState().settings.barcodeProvider).toBe('mock');
    expect(getBarcodeProviderId()).toBe('mock');
  });

  it('returns a local food before making any provider call', async () => {
    mockGetFoodByBarcode.mockResolvedValueOnce({
      id: 'food-1',
      name: 'Local cereal',
      brand: 'Kitchen',
      per100g: { calories: 380, protein: 9, carbs: 72, fat: 5 },
      servingSizeG: 40,
      servingLabel: '40 g',
      barcode: '4006381333931',
      source: 'custom',
      isFavorite: false,
      usageCount: 0,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await lookupBarcode('4006381333931');

    expect(result).toMatchObject({
      ok: true,
      data: { barcode: '4006381333931', name: 'Local cereal', source: 'local' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back from GTIN-14 to the inner GTIN-13 for local lookup', async () => {
    mockGetFoodByBarcode
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'food-1',
        name: 'Inner cereal',
        brand: 'Kitchen',
        per100g: { calories: 380, protein: 9, carbs: 72, fat: 5 },
        servingSizeG: 40,
        servingLabel: '40 g',
        barcode: '4006381333931',
        source: 'custom',
        isFavorite: false,
        usageCount: 0,
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

    const result = await lookupBarcode('14006381333938');

    expect(mockGetFoodByBarcode).toHaveBeenNthCalledWith(1, '14006381333938');
    expect(mockGetFoodByBarcode).toHaveBeenNthCalledWith(2, '4006381333931');
    expect(result).toMatchObject({
      ok: true,
      data: { barcode: '4006381333931', name: 'Inner cereal', source: 'local' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the selected mock provider after a local miss', async () => {
    mockGetFoodByBarcode.mockResolvedValueOnce(null);
    setBarcodeProvider('mock');

    const first = await lookupBarcode('4006381333931');
    const second = await lookupBarcode('4006381333931');

    expect(first.ok).toBe(true);
    expect(first.data).toEqual(second.data);
    expect(first.data?.source).toBe('mock');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets the mock provider return a deterministic not-found result', async () => {
    mockGetFoodByBarcode.mockResolvedValueOnce(null);
    setBarcodeProvider('mock');

    await expect(lookupBarcode('00000000')).resolves.toEqual({ ok: true, data: null });
  });

  it('falls back from GTIN-14 to the inner GTIN-13 remotely and keeps not-found clean', async () => {
    mockGetFoodByBarcode.mockResolvedValue(null);
    fetchMock.mockResolvedValue(response(404, 'missing'));

    await expect(lookupBarcode('14006381333938')).resolves.toEqual({ ok: true, data: null });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[0])).toContain('14006381333938.json');
    expect(String((fetchMock.mock.calls[1] as [string, RequestInit])[0])).toContain('4006381333931.json');
  });

  it('rejects check-digit failures before local or remote lookup', async () => {
    const result = await lookupBarcode('4006381333932');

    expect(result.ok).toBe(false);
    expect(mockGetFoodByBarcode).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
