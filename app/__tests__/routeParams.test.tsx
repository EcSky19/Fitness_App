/**
 * Route-parameter and modal-dismissal hardening for the food-logging screens.
 *
 * Same harness as `flows.test.tsx`/`interactions.test.tsx` (real in-memory
 * SQLite, real design system, navigation stubbed) but aimed at the two ways a
 * screen mishandles the untrusted edges of navigation:
 *
 *   1. A `date` route param that is not a plain `YYYY-MM-DD` string. Every other
 *      logging screen runs it through `normalizeDateParam`; `scan-review` used
 *      the raw value and wrote it straight into `food_entries.date`, which the
 *      diary queries with an exact string match — so the meal silently vanished.
 *
 *   2. A one-tap log in `food-search` opened with nothing behind it (a deep
 *      link or a restored modal). `router.back()` is a no-op there, so the user
 *      was stranded on the picker after their food had already been logged.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { listEntriesByDate, toggleFavoriteFood, upsertFood } from '@/db/repositories';
import { setupTestDb, teardownTestDb, useTestAccount } from '@/db/repositories/__tests__/testDb';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import type { VisionResult } from '@/types';

const DATE = '2026-08-19';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  canDismiss: jest.fn(() => true),
  dismiss: jest.fn(),
  dismissAll: jest.fn(),
  setParams: jest.fn(),
};

let mockParams: Record<string, string | string[]> = {};

jest.mock('expo-router', () => ({
  __esModule: true,
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useSegments: () => [],
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/services/health', () => {
  const actual = jest.requireActual('@/services/health') as Record<string, unknown>;
  return {
    ...actual,
    isHealthSupported: jest.fn(() => false),
    syncHealthDay: jest.fn(async () => ({ ok: false, error: 'Health disabled in tests' })),
  };
});

import FoodSearchScreen from '../food-search';
import ScanReviewScreen from '../scan-review';

const VISION_RESULT: VisionResult = {
  mode: 'food_photo',
  items: [
    {
      name: 'Grilled chicken breast',
      brand: null,
      quantity: 1,
      unit: 'serving',
      servingLabel: '1 breast (150 g)',
      estimatedGrams: 150,
      macros: { calories: 248, protein: 46.5, carbs: 0, fat: 5.4 },
      confidence: 0.88,
      notes: null,
    },
    {
      name: 'Steamed white rice',
      brand: null,
      quantity: 1,
      unit: 'cup',
      servingLabel: '1 cup (180 g)',
      estimatedGrams: 180,
      macros: { calories: 234, protein: 4.3, carbs: 51.7, fat: 0.4 },
      confidence: 0.72,
      notes: null,
    },
  ],
  provider: 'mock',
  modelId: 'mock-vision-1',
  latencyMs: 420,
  rawText: null,
  warnings: [],
};

beforeEach(async () => {
  await setupTestDb();
  await useTestAccount('test-account-a');
  mockParams = {};
  mockRouter.canGoBack.mockReturnValue(true);
  mockRouter.canDismiss.mockReturnValue(true);
  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    selectedDate: DATE,
    isReady: true,
    dataVersion: 0,
  });
});

afterEach(async () => {
  await teardownTestDb();
});

describe('scan review with an untrusted date param', () => {
  it('logs to the current day when the date param is not a plain YYYY-MM-DD', async () => {
    // A restored navigation state / deep link can hand over a serialized Date
    // rather than an ISO day. The screen must not write it verbatim: the diary
    // filters on an exact `date` match, so `19-08-2026` would hide the meal.
    mockParams = {
      payload: encodeURIComponent(JSON.stringify(VISION_RESULT)),
      date: '19-08-2026',
      mealType: 'dinner',
      photoUri: 'file:///mock/photo.jpg',
    };

    render(<ScanReviewScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-button'));
    });

    await waitFor(async () => expect(await listEntriesByDate(DATE)).toHaveLength(2));
    // Nothing may be filed under the malformed string, where it would be invisible.
    expect(await listEntriesByDate('19-08-2026')).toHaveLength(0);
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/diary');
  });
});

describe('food search opened with no navigation history', () => {
  it('returns to the diary after a one-tap log when back() has nowhere to go', async () => {
    const food = await upsertFood({
      name: 'Greek yogurt',
      per100g: { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
    });
    await toggleFavoriteFood(food.id);

    mockRouter.canGoBack.mockReturnValue(false);
    mockParams = { date: DATE, mealType: 'lunch' };

    render(<FoodSearchScreen />);

    // Favorites is a one-tap log path (no editor hop), so it exercises the
    // dismissal that a deep-linked picker cannot satisfy with `back()`.
    fireEvent.press(screen.getByLabelText('Favorites'));

    const row = await waitFor(() => screen.getByTestId(`food-result-${food.id}`));

    await act(async () => {
      fireEvent.press(row);
    });

    await waitFor(async () => expect(await listEntriesByDate(DATE)).toHaveLength(1));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/diary');
  });
});
