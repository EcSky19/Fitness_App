/**
 * Interaction-sequence tests.
 *
 * Same setup as `flows.test.tsx` (real SQLite, real design system, stubbed
 * navigation) but aimed at the things a single-screen unit test cannot see:
 * pull-to-refresh lifecycles, closing a modal that has no history behind it and
 * double taps on a save button.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { addFoodEntry, listEntriesByDate } from '@/db/repositories';
import { setupTestDb, teardownTestDb, useTestAccount } from '@/db/repositories/__tests__/testDb';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import type { VisionResult } from '@/types';

const DATE = '2026-08-19';
const YESTERDAY = '2026-08-18';

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
  ],
  provider: 'mock',
  modelId: 'mock-vision-1',
  latencyMs: 420,
  rawText: null,
  warnings: [],
};

function refreshControl(): RefreshControl {
  return screen.UNSAFE_getByType(RefreshControl);
}

/** Fires the ScrollView's pull-to-refresh gesture. */
function pullToRefresh(): void {
  const { onRefresh } = refreshControl().props;
  if (!onRefresh) throw new Error('Screen is missing an onRefresh handler');
  onRefresh();
}

const SNACK: Parameters<typeof addFoodEntry>[0] = {
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

describe('diary pull to refresh', () => {
  it('stops the spinner once the reload finishes', async () => {
    await addFoodEntry(SNACK);
    render(<DiaryScreen />);
    // Waiting for the entry proves the *initial* load already settled, so the
    // spinner can only be cleared by the reload itself.
    await screen.findByText('Greek yogurt');
    expect(refreshControl().props.refreshing).toBe(false);

    await act(async () => {
      pullToRefresh();
    });

    await waitFor(() => expect(refreshControl().props.refreshing).toBe(false));
  });

  it('can be pulled twice in a row', async () => {
    render(<DiaryScreen />);
    await waitFor(() => expect(screen.getByTestId('day-consumed')).toBeTruthy());

    await act(async () => {
      pullToRefresh();
    });
    await waitFor(() => expect(refreshControl().props.refreshing).toBe(false));

    await act(async () => {
      await addFoodEntry(SNACK);
    });
    await act(async () => {
      pullToRefresh();
    });

    await waitFor(() => expect(screen.getByText('Greek yogurt')).toBeTruthy());
    await waitFor(() => expect(refreshControl().props.refreshing).toBe(false));
  });
});

describe('food editor without navigation history', () => {
  async function renderQuickAdd(): Promise<void> {
    mockParams = { quickAdd: '1', date: DATE, mealType: 'snack' };
    render(<FoodEditScreen />);
    await screen.findByTestId('entry-save');
    fireEvent.changeText(screen.getByTestId('entry-name'), 'Protein shake');
    fireEvent.changeText(screen.getByTestId('macro-calories'), '160');
  }

  it('falls back to the diary when a deep link left nothing to go back to', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await renderQuickAdd();

    await act(async () => {
      fireEvent.press(screen.getByTestId('entry-save'));
    });

    await waitFor(async () => expect(await listEntriesByDate(DATE)).toHaveLength(1));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/diary');
  });

  it('still goes back normally when there is history', async () => {
    await renderQuickAdd();

    await act(async () => {
      fireEvent.press(screen.getByTestId('entry-save'));
    });

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('never logs the same entry twice when save is double tapped', async () => {
    await renderQuickAdd();

    const save = screen.getByTestId('entry-save');
    await act(async () => {
      fireEvent.press(save);
      fireEvent.press(save);
    });

    await waitFor(async () => expect(await listEntriesByDate(DATE)).toHaveLength(1));
    expect(await listEntriesByDate(DATE)).toHaveLength(1);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('scan review', () => {
  function renderReview(): void {
    mockParams = {
      payload: encodeURIComponent(JSON.stringify(VISION_RESULT)),
      date: DATE,
      mealType: 'dinner',
      photoUri: 'file:///mock/photo.jpg',
    };
    render(<ScanReviewScreen />);
  }

  it('gives the date sheet exactly one scroll container', async () => {
    renderReview();
    await screen.findByTestId('log-button');

    const baseline = screen.UNSAFE_queryAllByType(ScrollView).length;

    fireEvent.press(screen.getByLabelText(/^Change date, currently/));

    // The Sheet scrolls its own content; a second ScrollView here would nest
    // two same-axis scrollers and swallow the row taps.
    expect(screen.getByTestId(`date-option-${DATE}`)).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(baseline + 1);
  });

  it('still picks a date from the sheet', async () => {
    renderReview();
    await screen.findByTestId('log-button');

    fireEvent.press(screen.getByLabelText(/^Change date, currently/));
    fireEvent.press(screen.getByTestId(`date-option-${YESTERDAY}`));

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-button'));
    });

    await waitFor(async () => expect(await listEntriesByDate(YESTERDAY)).toHaveLength(1));
    expect(await listEntriesByDate(DATE)).toHaveLength(0);
  });

  it('never logs the batch twice when the log button is double tapped', async () => {
    renderReview();
    const logButton = await screen.findByTestId('log-button');

    await act(async () => {
      fireEvent.press(logButton);
      fireEvent.press(logButton);
    });

    await waitFor(async () => expect(await listEntriesByDate(DATE)).toHaveLength(1));
    expect(await listEntriesByDate(DATE)).toHaveLength(1);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  });
});
