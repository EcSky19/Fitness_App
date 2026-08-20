/**
 * `app/(tabs)/diary.tsx` — grouping, totals, navigation and the long-press menu.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import DiaryScreen from '../../../../app/(tabs)/diary';
import { makeEntry, makeMacros, makeRecipe, TODAY, YESTERDAY } from './harness';
import { useAppStore } from '@/store/appStore';
import type { FoodEntry } from '@/types';

jest.mock('@/ui', () => require('./harness').uiMock());
jest.mock('@/domain', () => require('./harness').domainMock());
jest.mock('@/db/repositories', () => require('./harness').repositoriesMock());
jest.mock('@/hooks/useAsyncData', () => require('./harness').asyncDataMock(), { virtual: true });
jest.mock('@/services/foodSearch', () => require('./harness').foodSearchMock(), { virtual: true });
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => require('./harness').routerMock());
jest.mock(
  '@/features/recipes/RecipePicker',
  () => {
    const ReactLib = require('react');
    const { Pressable, Text, View } = require('react-native');
    const recipe = require('./harness').makeRecipe({ id: 'meal-1', name: 'Saved breakfast' });
    return {
      RecipePicker: ({ title, kind, onSelectRecipe }: any) =>
        ReactLib.createElement(View, { testID: 'recipe-picker', accessibilityLabel: title }, [
              ReactLib.createElement(Text, { key: 'kind' }, kind),
              ReactLib.createElement(
                Pressable,
                {
                  key: 'select',
                  testID: 'recipe-picker-select',
                  accessibilityRole: 'button',
                  accessibilityLabel: recipe.name,
                  onPress: () => onSelectRecipe(recipe),
                },
                ReactLib.createElement(Text, null, recipe.name)
              ),
            ])
    };
  },
  { virtual: true }
);

const repos = jest.requireMock('@/db/repositories') as Record<string, jest.Mock>;
const routerModule = jest.requireMock('expo-router') as {
  router: { push: jest.Mock; back: jest.Mock };
};

const TODAY_ENTRIES: FoodEntry[] = [
  makeEntry({ id: 'b1', mealType: 'breakfast', name: 'Oatmeal', macros: makeMacros(300, 10, 50, 6) }),
  makeEntry({ id: 'b2', mealType: 'breakfast', name: 'Flat white', macros: makeMacros(120, 6, 10, 6) }),
  makeEntry({
    id: 'l1',
    mealType: 'lunch',
    name: 'Chicken salad',
    macros: makeMacros(450, 40, 20, 18),
    source: 'vision',
    photoUri: 'file:///plate.jpg',
    wasEdited: true,
  }),
];

const YESTERDAY_ENTRIES: FoodEntry[] = [
  makeEntry({ id: 'y1', date: YESTERDAY, mealType: 'dinner', name: 'Pasta bake' }),
];

function mockDay(today: FoodEntry[], yesterday: FoodEntry[] = []): void {
  repos.listEntriesByDate.mockImplementation(async (date: string) =>
    date === TODAY ? today : yesterday
  );
}

async function renderDiary(): Promise<void> {
  render(<DiaryScreen />);
  await act(async () => {});
  await waitFor(() => expect(repos.listEntriesByDate).toHaveBeenCalledWith(TODAY));
  await screen.findByTestId('day-totals');
}

beforeEach(() => {
  useAppStore.setState({ selectedDate: TODAY, dataVersion: 0 });
  repos.listExercisesByDate.mockResolvedValue([]);
  repos.getActiveGoal.mockResolvedValue({
    id: 'goal-1',
    targets: { calories: 2200, protein: 160, carbs: 220, fat: 70 },
  });
  repos.addFoodEntry.mockResolvedValue(undefined);
  repos.addFoodEntries.mockResolvedValue(undefined);
  repos.repeatEntries.mockResolvedValue([]);
  repos.deleteFoodEntry.mockResolvedValue(undefined);
  repos.createRecipeFromEntries.mockResolvedValue(makeRecipe());
  repos.logRecipe.mockResolvedValue([]);
  mockDay(TODAY_ENTRIES, YESTERDAY_ENTRIES);
});

describe('diary screen', () => {
  it('groups entries under their meal and totals each section', async () => {
    await renderDiary();

    const breakfast = screen.getByTestId('meal-section-breakfast');
    expect(within(breakfast).getByTestId('entry-row-b1')).toBeTruthy();
    expect(within(breakfast).getByTestId('entry-row-b2')).toBeTruthy();
    expect(within(breakfast).queryByTestId('entry-row-l1')).toBeNull();

    const lunch = screen.getByTestId('meal-section-lunch');
    expect(within(lunch).getByTestId('entry-row-l1')).toBeTruthy();

    expect(screen.getByTestId('meal-total-breakfast')).toHaveTextContent('420 kcal');
    expect(screen.getByTestId('meal-total-lunch')).toHaveTextContent('450 kcal');
    expect(screen.getByTestId('meal-total-dinner')).toHaveTextContent('0 kcal');
    expect(screen.getByTestId('meal-total-snack')).toHaveTextContent('0 kcal');
  });

  it('shows the day totals against the active goal', async () => {
    await renderDiary();

    expect(screen.getByTestId('day-consumed')).toHaveTextContent('870 kcal');
    expect(screen.getByTestId('day-target')).toHaveTextContent('2200 kcal');
    expect(screen.getByTestId('day-burned')).toHaveTextContent('0 kcal');
    expect(screen.getByTestId('macro-bar')).toHaveTextContent('56|80|30');
  });

  it('renders the entry details, macros and provenance badges', async () => {
    await renderDiary();

    expect(screen.getByText('Chicken salad')).toBeTruthy();
    expect(
      screen.getByText('1 serving (100 g) · P 40 g · C 20 g · F 18 g')
    ).toBeTruthy();
    expect(screen.getByTestId('entry-badge-ai-l1')).toBeTruthy();
    expect(screen.getByTestId('entry-badge-photo-l1')).toBeTruthy();
    expect(screen.getByTestId('entry-badge-edited-l1')).toBeTruthy();
    expect(screen.queryByTestId('entry-badge-ai-b1')).toBeNull();
  });

  it('shows the whole-day empty state with a scan call to action', async () => {
    mockDay([], []);
    await renderDiary();

    expect(screen.getByTestId('diary-empty')).toBeTruthy();
    expect(screen.getByText('Nothing logged for breakfast yet.')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Scan food'));
    expect(routerModule.router.push).toHaveBeenCalledWith({
      pathname: '/scan',
      params: { date: TODAY },
    });
  });

  it('hides the day empty state once something is logged', async () => {
    await renderDiary();
    expect(screen.queryByTestId('diary-empty')).toBeNull();
  });

  it('opens the food picker for the tapped meal', async () => {
    await renderDiary();

    fireEvent.press(screen.getByTestId('meal-add-dinner'));

    expect(routerModule.router.push).toHaveBeenCalledWith({
      pathname: '/food-search',
      params: { date: TODAY, mealType: 'dinner' },
    });
  });

  it('opens the editor for a tapped entry', async () => {
    await renderDiary();

    fireEvent.press(screen.getByTestId('entry-row-b1'));

    expect(routerModule.router.push).toHaveBeenCalledWith({
      pathname: '/food-edit',
      params: { entryId: 'b1' },
    });
  });

  it('asks for confirmation before deleting a long-pressed entry', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderDiary();

    fireEvent(screen.getByTestId('entry-row-b1'), 'longPress');
    expect(screen.getByTestId('entry-action-sheet')).toBeTruthy();

    fireEvent.press(screen.getByTestId('entry-action-delete'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(repos.deleteFoodEntry).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] ?? [];
    const confirm = buttons.find((button) => button.style === 'destructive');
    expect(confirm).toBeDefined();

    confirm?.onPress?.();
    await waitFor(() => expect(repos.deleteFoodEntry).toHaveBeenCalledWith('b1'));

    alertSpy.mockRestore();
  });

  it('duplicates an entry from the long-press menu', async () => {
    await renderDiary();

    fireEvent(screen.getByTestId('entry-row-l1'), 'longPress');
    fireEvent.press(screen.getByTestId('entry-action-duplicate'));

    await waitFor(() => expect(repos.repeatEntries).toHaveBeenCalledTimes(1));
    expect(repos.repeatEntries).toHaveBeenCalledWith({ entryIds: ['l1'], date: TODAY });
  });

  it('warns instead of failing silently when a duplicate write fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    repos.repeatEntries.mockRejectedValueOnce(new Error('db is locked'));
    await renderDiary();

    fireEvent(screen.getByTestId('entry-row-l1'), 'longPress');
    fireEvent.press(screen.getByTestId('entry-action-duplicate'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toBe('Could not update your diary');
    alertSpy.mockRestore();
  });

  it('copies an entry to another meal', async () => {
    await renderDiary();

    fireEvent(screen.getByTestId('entry-row-l1'), 'longPress');
    fireEvent.press(screen.getByTestId('entry-action-copy'));
    fireEvent.press(screen.getByTestId('entry-action-copy-dinner'));

    await waitFor(() => expect(repos.repeatEntries).toHaveBeenCalledTimes(1));
    expect(repos.repeatEntries).toHaveBeenCalledWith({
      entryIds: ['l1'],
      date: TODAY,
      mealType: 'dinner',
    });
  });

  it("repeats yesterday's meal into an empty section in one transaction", async () => {
    await renderDiary();

    expect(screen.queryByTestId('meal-copy-yesterday-breakfast')).toBeNull();
    fireEvent.press(screen.getByTestId('meal-copy-yesterday-dinner'));

    await waitFor(() => expect(repos.repeatEntries).toHaveBeenCalledTimes(1));
    expect(repos.repeatEntries).toHaveBeenCalledWith({
      entryIds: ['y1'],
      date: TODAY,
      mealType: 'dinner',
    });
  });

  it('guards a double-tapped meal repeat so exactly one copy is created', async () => {
    await renderDiary();

    fireEvent.press(screen.getByTestId('meal-copy-yesterday-dinner'));
    fireEvent.press(screen.getByTestId('meal-copy-yesterday-dinner'));

    await waitFor(() => expect(repos.repeatEntries).toHaveBeenCalledTimes(1));
    expect(repos.repeatEntries).toHaveBeenCalledWith({
      entryIds: ['y1'],
      date: TODAY,
      mealType: 'dinner',
    });
  });

  it('copies the whole previous day from the header menu', async () => {
    await renderDiary();

    fireEvent.press(screen.getByTestId('diary-menu-button'));
    fireEvent.press(screen.getByTestId('diary-menu-copy-day'));

    await waitFor(() => expect(repos.repeatEntries).toHaveBeenCalledTimes(1));
    expect(repos.repeatEntries).toHaveBeenCalledWith({ entryIds: ['y1'], date: TODAY });
  });

  it('saves the current meal as a reusable saved meal', async () => {
    await renderDiary();

    fireEvent.press(screen.getByTestId('meal-save-breakfast'));
    fireEvent.changeText(screen.getByTestId('save-meal-name'), 'Workday breakfast');
    fireEvent.press(screen.getByTestId('save-meal-submit'));

    await waitFor(() => expect(repos.createRecipeFromEntries).toHaveBeenCalledTimes(1));
    expect(repos.createRecipeFromEntries).toHaveBeenCalledWith({
      name: 'Workday breakfast',
      kind: 'meal',
      entryIds: ['b1', 'b2'],
      servings: 1,
    });
  });

  it('logs a saved meal from an empty diary meal section', async () => {
    await renderDiary();

    fireEvent.press(screen.getByTestId('meal-log-recipe-snack'));
    expect(screen.getByTestId('recipe-picker')).toBeTruthy();
    fireEvent.press(screen.getByTestId('recipe-picker-select'));

    await waitFor(() => expect(repos.logRecipe).toHaveBeenCalledTimes(1));
    expect(repos.logRecipe).toHaveBeenCalledWith({
      recipeId: 'meal-1',
      date: TODAY,
      mealType: 'snack',
    });
  });

  it('routes to quick add from the header menu', async () => {
    await renderDiary();

    fireEvent.press(screen.getByTestId('diary-menu-button'));
    fireEvent.press(screen.getByTestId('diary-menu-quick-add'));

    expect(routerModule.router.push).toHaveBeenCalledWith({
      pathname: '/food-edit',
      params: { quickAdd: '1', date: TODAY, mealType: 'snack' },
    });
  });

  it('reloads the day on pull to refresh', async () => {
    await renderDiary();
    const before = repos.listEntriesByDate.mock.calls.length;

    fireEvent.press(screen.getByTestId('screen-refresh'));

    await waitFor(() =>
      expect(repos.listEntriesByDate.mock.calls.length).toBeGreaterThan(before)
    );
  });

  it('follows the store when the selected date changes', async () => {
    await renderDiary();

    fireEvent.press(screen.getByLabelText('Previous day'));

    await waitFor(() => expect(useAppStore.getState().selectedDate).toBe(YESTERDAY));
    await waitFor(() => expect(repos.listEntriesByDate).toHaveBeenCalledWith(YESTERDAY));
  });
});
