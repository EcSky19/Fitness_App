/* eslint-env jest */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';

import BarcodeScanScreen from '../../../../app/barcode-scan';
import { isValidBarcode, lookupBarcode } from '@/services/barcode';
import { getFoodByBarcode, upsertFood } from '@/db/repositories';
import type { BarcodeProduct } from '@/features/barcode/types';
import type { Food } from '@/types';

jest.mock('@/ui', () => require('../../scan/__tests__/testKit').makeUiMock());
jest.mock('@/domain', () => require('../../diary/__tests__/harness').domainMock());

jest.mock('@/services/barcode', () => ({
  isValidBarcode: jest.fn(() => true),
  lookupBarcode: jest.fn(async () => ({ ok: true, data: null })),
  listBarcodeProviders: jest.fn(() => [{ id: 'mock', label: 'Mock' }]),
  setBarcodeProvider: jest.fn(),
  getBarcodeProviderId: jest.fn(() => 'mock'),
}));

jest.mock('@/db/repositories', () => ({
  getFoodByBarcode: jest.fn(async () => null),
  upsertFood: jest.fn(async (input) => ({
    id: 'saved-food',
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
    ...input,
  })),
}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockedParams = useLocalSearchParams as unknown as jest.Mock;
const mockedPermissions = useCameraPermissions as unknown as jest.Mock;
const mockedValid = isValidBarcode as unknown as jest.Mock;
const mockedLookup = lookupBarcode as unknown as jest.Mock;
const mockedGetFoodByBarcode = getFoodByBarcode as unknown as jest.Mock;
const mockedUpsertFood = upsertFood as unknown as jest.Mock;

const PRODUCT: BarcodeProduct = {
  barcode: '4006381333931',
  name: 'Crunchy oats',
  brand: 'Macro Co',
  per100g: { calories: 410, protein: 12, carbs: 62, fat: 11 },
  servingSizeG: 45,
  imageUrl: null,
  source: 'openfoodfacts',
};

function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id: 'food-local',
    name: 'Local oats',
    brand: 'Macro Co',
    per100g: { calories: 410, protein: 12, carbs: 62, fat: 11 },
    servingSizeG: 45,
    servingLabel: '45 g',
    barcode: '4006381333931',
    source: 'custom',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
    ...overrides,
  };
}

function scan(rendered: ReturnType<typeof render>, code: string): void {
  const camera = (rendered as any).UNSAFE_getByType('CameraView');
  act(() => {
    camera.props.onBarcodeScanned({ type: 'ean13', data: code });
  });
}

beforeEach(() => {
  mockedParams.mockReturnValue({ date: '2026-08-19', mealType: 'lunch' });
  mockedPermissions.mockImplementation(() => [
    { granted: true, canAskAgain: true, status: 'granted' },
    jest.fn(),
  ]);
  mockedValid.mockReturnValue(true);
  mockedLookup.mockResolvedValue({ ok: true, data: null });
  mockedGetFoodByBarcode.mockResolvedValue(null);
  mockedUpsertFood.mockImplementation(async (input) => ({
    id: 'saved-food',
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
    ...input,
  }));
});

describe('barcode scanner', () => {
  it('locks a rapid burst of scan events to exactly one lookup', async () => {
    mockedLookup.mockResolvedValue(new Promise(() => {}));
    const rendered = render(<BarcodeScanScreen />);
    const camera = (rendered as any).UNSAFE_getByType('CameraView');

    act(() => {
      camera.props.onBarcodeScanned({ type: 'ean13', data: '4006381333931' });
      camera.props.onBarcodeScanned({ type: 'ean13', data: '4006381333931' });
      camera.props.onBarcodeScanned({ type: 'ean13', data: '4006381333931' });
    });

    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid barcode without a lookup', async () => {
    mockedValid.mockReturnValue(false);
    const rendered = render(<BarcodeScanScreen />);

    scan(rendered, '1234567890123');

    await waitFor(() => expect(screen.getByTestId('barcode-feedback')).toBeTruthy());
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('routes a local catalogue hit straight to food-edit', async () => {
    mockedLookup.mockResolvedValue({ ok: true, data: { ...PRODUCT, source: 'local' } });
    mockedGetFoodByBarcode.mockResolvedValue(makeFood());
    const rendered = render(<BarcodeScanScreen />);

    scan(rendered, PRODUCT.barcode);

    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining('/food-edit?foodId=food-local')
    );
  });

  it('shows a remote product, saves it locally, then routes to food-edit', async () => {
    mockedLookup.mockResolvedValue({ ok: true, data: PRODUCT });
    const rendered = render(<BarcodeScanScreen />);

    scan(rendered, PRODUCT.barcode);

    await screen.findByTestId('barcode-product-card');
    expect(screen.getByTestId('barcode-product-macros')).toHaveTextContent(/410 kcal/);

    fireEvent.press(screen.getByTestId('save-barcode-food'));

    await waitFor(() => expect(mockedUpsertFood).toHaveBeenCalledTimes(1));
    expect(mockedUpsertFood).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: PRODUCT.barcode, name: PRODUCT.name })
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(expect.stringContaining('foodId=saved-food'))
    );
  });

  it('treats not-found as create-food, not as an error', async () => {
    mockedLookup.mockResolvedValue({ ok: true, data: null });
    const rendered = render(<BarcodeScanScreen />);

    scan(rendered, PRODUCT.barcode);

    await screen.findByTestId('barcode-not-found');
    expect(screen.queryByTestId('barcode-error')).toBeNull();

    fireEvent.press(screen.getByTestId('create-barcode-food'));

    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining(`barcode=${encodeURIComponent(PRODUCT.barcode)}`)
    );
  });

  it('distinguishes offline/errors from not-found', async () => {
    mockedLookup.mockResolvedValue({ ok: false, error: 'You appear to be offline.' });
    const rendered = render(<BarcodeScanScreen />);

    scan(rendered, PRODUCT.barcode);

    await screen.findByTestId('barcode-error');
    expect(screen.getByText('You appear to be offline.')).toBeTruthy();
    expect(screen.queryByTestId('barcode-not-found')).toBeNull();
  });

  it('looks up a manually entered barcode', async () => {
    render(<BarcodeScanScreen />);

    fireEvent.press(screen.getByTestId('manual-barcode'));
    fireEvent.changeText(screen.getByLabelText('Barcode'), PRODUCT.barcode);
    fireEvent.press(screen.getByTestId('manual-barcode-submit'));

    await waitFor(() => expect(mockedLookup).toHaveBeenCalledWith(PRODUCT.barcode));
  });
});
