/**
 * End-to-end flow tests.
 *
 * These drive the real screens against a REAL in-memory SQLite database and the
 * real design system — only navigation and the vision/health platforms are
 * stubbed. They prove the hand-offs between screens (route params), the writes
 * (foreign keys included) and the `invalidate()` -> `useAsyncData` refresh
 * cycle all line up.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { addFoodEntry, listEntriesByDate } from '@/db/repositories';
import { setupTestDb, teardownTestDb } from '@/db/repositories/__tests__/testDb';
import { ensureFoodsSeeded } from '@/services/foodSearch';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import type { FoodEntry, VisionResult } from '@/types';

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

let mockParams: Record<string, string> = {};

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

import DiaryScreen from '../(tabs)/diary';
import FoodEditScreen from '../food-edit';
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

/** Exactly the href `app/scan.tsx` builds when it hands off to the review screen. */
function scanReviewParams(): Record<string, string> {
  return {
    payload: encodeURIComponent(JSON.stringify(VISION_RESULT)),
    date: DATE,
    mealType: 'dinner',
    photoUri: 'file:///mock/photo.jpg',
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  await setupTestDb();
  mockParams = {};
  // `clearMocks` wipes implementations between tests.
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

describe('scan -> review -> log', () => {
  it('logs every detected item to the requested date and meal, then shows them in the diary', async () => {
    mockParams = scanReviewParams();

    render(<ScanReviewScreen />);
    await flush();

    expect(screen.getByText('Log 2 items')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-button'));
    });

    const entries = await waitFor(async () => {
      const rows = await listEntriesByDate(DATE);
      expect(rows).toHaveLength(2);
      return rows;
    });

    expect(entries.map((e: FoodEntry) => e.name).sort()).toEqual([
      'Grilled chicken breast',
      'Steamed white rice',
    ]);
    expect(entries.every((e: FoodEntry) => e.mealType === 'dinner')).toBe(true);
    expect(entries.every((e: FoodEntry) => e.source === 'vision')).toBe(true);
    expect(entries.find((e: FoodEntry) => e.name === 'Grilled chicken breast')?.macros.calories).toBe(
      248
    );

    // The review screen sends the user back to the diary for the same day.
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/diary');

    screen.unmount();
    mockParams = {};
    render(<DiaryScreen />);
    await waitFor(() => expect(screen.getByText('Grilled chicken breast')).toBeTruthy());
    expect(screen.getByText('Steamed white rice')).toBeTruthy();
    expect(screen.getByTestId('meal-section-dinner')).toBeTruthy();
  });

  it('hands a single item to the full editor with a draft the editor can read', async () => {
    mockParams = scanReviewParams();

    render(<ScanReviewScreen />);
    await flush();

    await act(async () => {
      fireEvent.press(screen.getAllByTestId(/^open-editor-/)[0]);
    });

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    const href = mockRouter.push.mock.calls[0][0] as string;
    expect(href.startsWith('/food-edit?draft=')).toBe(true);

    const query = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    mockParams = {
      draft: query.get('draft') ?? '',
      date: query.get('date') ?? '',
      mealType: query.get('mealType') ?? '',
    };

    screen.unmount();
    render(<FoodEditScreen />);
    await waitFor(() => expect(screen.getByTestId('entry-name').props.value).toBe(
      'Grilled chicken breast'
    ));

    await act(async () => {
      fireEvent.press(screen.getByTestId('entry-save'));
    });

    await waitFor(async () => {
      const rows = await listEntriesByDate(DATE);
      expect(rows).toHaveLength(1);
      expect(rows[0].mealType).toBe('dinner');
      expect(rows[0].name).toBe('Grilled chicken breast');
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('food search -> editor -> log', () => {
  it('passes the picked food to the editor, which saves it to the diary', async () => {
    await ensureFoodsSeeded();

    mockParams = { date: DATE, mealType: 'lunch' };
    render(<FoodSearchScreen />);

    fireEvent.changeText(screen.getByTestId('food-search-input'), 'chicken breast');

    const results = await waitFor(() => {
      const rows = screen.getAllByTestId(/^food-result-/);
      expect(rows.length).toBeGreaterThan(0);
      return rows;
    });

    await act(async () => {
      fireEvent.press(results[0]);
    });

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/food-edit',
      params: { foodId: expect.any(String), date: DATE, mealType: 'lunch' },
    });

    const pushed = mockRouter.push.mock.calls[0][0] as {
      params: { foodId: string; date: string; mealType: string };
    };
    // A picked food resolves to a persisted row, never a synthetic seed id.
    expect(pushed.params.foodId.startsWith('seed:')).toBe(false);

    screen.unmount();
    mockParams = pushed.params;
    render(<FoodEditScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('entry-name').props.value.length).toBeGreaterThan(0)
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('entry-save'));
    });

    const entries = await waitFor(async () => {
      const rows = await listEntriesByDate(DATE);
      expect(rows).toHaveLength(1);
      return rows;
    });
    expect(entries[0].mealType).toBe('lunch');
    expect(entries[0].foodId).toBe(pushed.params.foodId);
    expect(entries[0].macros.calories).toBeGreaterThan(0);

    screen.unmount();
    mockParams = {};
    render(<DiaryScreen />);
    await waitFor(() => expect(screen.getByTestId('meal-section-lunch')).toBeTruthy());
    expect(screen.getByText(entries[0].name)).toBeTruthy();
  });

  it('can log a seed food that has not been imported into SQLite yet', async () => {
    // No `ensureFoodsSeeded()` here: search falls back to the built-in
    // catalogue, whose ids (`seed:...`) have no row to reference yet.
    mockParams = { date: DATE, mealType: 'breakfast' };
    render(<FoodSearchScreen />);

    fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');

    const results = await waitFor(() => {
      const rows = screen.getAllByTestId(/^food-result-seed:/);
      expect(rows.length).toBeGreaterThan(0);
      return rows;
    });

    await act(async () => {
      fireEvent.press(results[0]);
    });

    const pushed = mockRouter.push.mock.calls[0][0] as {
      params: { foodId: string; date: string; mealType: string };
    };
    expect(pushed.params.foodId.startsWith('seed:')).toBe(true);

    screen.unmount();
    mockParams = pushed.params;
    render(<FoodEditScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('entry-name').props.value.length).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('food-edit-error')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('entry-save'));
    });

    const entries = await waitFor(async () => {
      const rows = await listEntriesByDate(DATE);
      expect(rows).toHaveLength(1);
      return rows;
    });
    expect(entries[0].mealType).toBe('breakfast');
    expect(entries[0].macros.calories).toBeGreaterThan(0);
  });
});

describe('data flow', () => {
  it('refreshes an open screen when a write bumps dataVersion', async () => {
    render(<DiaryScreen />);
    await waitFor(() => expect(screen.getByTestId('day-consumed')).toBeTruthy());
    expect(screen.queryByText('Greek yogurt')).toBeNull();

    // A repository write invalidates the store; no manual reload happens here.
    await act(async () => {
      await addFoodEntry({
        date: DATE,
        mealType: 'snack',
        foodId: null,
        name: 'Greek yogurt',
        brand: null,
        quantity: 1,
        unit: 'serving',
        servingLabel: '1 cup (245 g)',
        gramsTotal: 245,
        macros: { calories: 146, protein: 25, carbs: 8, fat: 1 },
        photoUri: null,
        source: 'quick_add',
        visionConfidence: null,
        wasEdited: false,
      });
    });

    await waitFor(() => expect(screen.getByText('Greek yogurt')).toBeTruthy());
    expect(useAppStore.getState().dataVersion).toBeGreaterThan(0);
  });
});
