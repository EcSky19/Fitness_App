/**
 * `app/food-search.tsx` — picking, filtering, favouriting and creating foods.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import FoodSearchScreen from '../../../../app/food-search';
import { makeFood, TODAY } from './harness';
import { useAppStore } from '@/store/appStore';
import type { Food } from '@/types';

jest.mock('@/ui', () => require('./harness').uiMock());
jest.mock('@/domain', () => require('./harness').domainMock());
jest.mock('@/db/repositories', () => require('./harness').repositoriesMock());
jest.mock('@/hooks/useAsyncData', () => require('./harness').asyncDataMock(), { virtual: true });
jest.mock('@/services/foodSearch', () => require('./harness').foodSearchMock(), { virtual: true });
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => require('./harness').routerMock());

const repos = jest.requireMock('@/db/repositories') as Record<string, jest.Mock>;
const foodSearch = jest.requireMock('@/services/foodSearch') as Record<string, jest.Mock>;
const routerModule = jest.requireMock('expo-router') as {
  router: { push: jest.Mock };
  __setParams: (params: Record<string, unknown>) => void;
};

const YOGURT: Food = makeFood({ id: 'f1', name: 'Greek yogurt', brand: 'Fage' });
const CHICKEN: Food = makeFood({
  id: 'f2',
  name: 'Chicken breast',
  brand: null,
  isFavorite: true,
  servingSizeG: 120,
  servingLabel: '1 fillet (120 g)',
  per100g: { calories: 165, protein: 31, carbs: 0, fat: 4 },
});

async function renderScreen(
  params: Record<string, unknown> = { date: TODAY, mealType: 'lunch' }
): Promise<void> {
  routerModule.__setParams(params);
  render(<FoodSearchScreen />);
  await act(async () => {});
  await screen.findByTestId('food-search-input');
}

beforeEach(() => {
  useAppStore.setState({ selectedDate: TODAY, dataVersion: 0 });
  foodSearch.searchAllFoods.mockResolvedValue([YOGURT, CHICKEN]);
  foodSearch.ensureFoodsSeeded.mockResolvedValue(2);
  repos.listRecentFoods.mockResolvedValue([YOGURT]);
  repos.listFavoriteFoods.mockResolvedValue([CHICKEN]);
  repos.toggleFavoriteFood.mockResolvedValue(undefined);
  repos.upsertFood.mockResolvedValue(null);
});

describe('food search screen', () => {
  it('seeds the catalog and lists results with their per-serving calories', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('food-result-f1')).toBeTruthy());
    expect(foodSearch.ensureFoodsSeeded).toHaveBeenCalled();
    expect(screen.getByText('Greek yogurt')).toBeTruthy();
    expect(screen.getByText('Fage')).toBeTruthy();
    expect(screen.getByText('150 kcal per 1 pot (150 g)')).toBeTruthy();
    expect(screen.getByText('198 kcal per 1 fillet (120 g)')).toBeTruthy();
  });

  it('debounces the query before hitting the search service', async () => {
    await renderScreen();
    foodSearch.searchAllFoods.mockClear();

    fireEvent.changeText(screen.getByTestId('food-search-input'), 'chick');
    expect(foodSearch.searchAllFoods).not.toHaveBeenCalledWith('chick', expect.anything());
    expect(screen.getByTestId('search-spinner')).toBeTruthy();

    await waitFor(() => expect(foodSearch.searchAllFoods).toHaveBeenCalledWith('chick', 40));
  });

  it('switches between all, recent and favorites', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('segment-recent'));
    await waitFor(() => expect(repos.listRecentFoods).toHaveBeenCalledWith(40));

    fireEvent.press(screen.getByTestId('segment-favorites'));
    await waitFor(() => expect(repos.listFavoriteFoods).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('food-result-f2')).toBeTruthy());
  });

  it('stars a food without leaving the list', async () => {
    await renderScreen();
    await screen.findByTestId('food-favorite-f1');

    fireEvent.press(screen.getByTestId('food-favorite-f1'));

    await waitFor(() => expect(repos.toggleFavoriteFood).toHaveBeenCalledWith('f1'));
    expect(routerModule.router.push).not.toHaveBeenCalled();
  });

  it('opens the editor with the food, date and meal', async () => {
    await renderScreen({ date: '2026-01-05', mealType: 'dinner' });
    await screen.findByTestId('food-result-f1');

    fireEvent.press(screen.getByTestId('food-result-f1'));

    expect(routerModule.router.push).toHaveBeenCalledWith({
      pathname: '/food-edit',
      params: { foodId: 'f1', date: '2026-01-05', mealType: 'dinner' },
    });
  });

  it('exposes scan and quick add in the header', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('food-search-scan'));
    expect(routerModule.router.push).toHaveBeenCalledWith({
      pathname: '/scan',
      params: { date: TODAY, mealType: 'lunch' },
    });

    fireEvent.press(screen.getByTestId('food-search-quick-add'));
    expect(routerModule.router.push).toHaveBeenCalledWith({
      pathname: '/food-edit',
      params: { quickAdd: '1', date: TODAY, mealType: 'lunch' },
    });
  });

  it('offers creating the searched term when nothing matches', async () => {
    foodSearch.searchAllFoods.mockResolvedValue([]);
    await renderScreen();

    fireEvent.changeText(screen.getByTestId('food-search-input'), 'kimchi pancake');
    await waitFor(() =>
      expect(foodSearch.searchAllFoods).toHaveBeenCalledWith('kimchi pancake', 40)
    );
    await waitFor(() => expect(screen.getByTestId('food-search-empty')).toBeTruthy());

    expect(screen.getByText('No matches for "kimchi pancake"')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Create "kimchi pancake"'));

    expect(screen.getByTestId('custom-food-sheet')).toBeTruthy();
    expect(screen.getByTestId('custom-food-name').props.value).toBe('kimchi pancake');
  });

  it('creates a custom food from per-serving macros and opens the editor', async () => {
    repos.upsertFood.mockResolvedValue({ id: 'new-food' });
    await renderScreen();

    fireEvent.press(screen.getByTestId('food-search-create-custom'));
    expect(screen.getByTestId('custom-food-sheet')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('custom-food-name'), 'Homemade granola');
    fireEvent.changeText(screen.getByTestId('custom-food-serving-size'), '50');
    fireEvent.changeText(screen.getByTestId('custom-food-calories'), '220');
    fireEvent.changeText(screen.getByTestId('custom-food-protein'), '6');
    fireEvent.press(screen.getByTestId('custom-food-save'));

    await waitFor(() => expect(repos.upsertFood).toHaveBeenCalledTimes(1));
    expect(repos.upsertFood).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Homemade granola',
        source: 'custom',
        servingSizeG: 50,
        servingLabel: '1 serving (50 g)',
        per100g: expect.objectContaining({ calories: 440, protein: 12 }),
      })
    );

    await waitFor(() =>
      expect(routerModule.router.push).toHaveBeenCalledWith({
        pathname: '/food-edit',
        params: { foodId: 'new-food', date: TODAY, mealType: 'lunch' },
      })
    );
  });

  it('keeps per-100 g macros as typed when that basis is chosen', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('food-search-create-custom'));
    fireEvent.changeText(screen.getByTestId('custom-food-name'), 'Olive oil');
    fireEvent.press(screen.getByTestId('segment-per100'));
    fireEvent.changeText(screen.getByTestId('custom-food-calories'), '884');
    fireEvent.changeText(screen.getByTestId('custom-food-fat'), '100');
    fireEvent.press(screen.getByTestId('custom-food-save'));

    await waitFor(() => expect(repos.upsertFood).toHaveBeenCalledTimes(1));
    expect(repos.upsertFood).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Olive oil',
        per100g: expect.objectContaining({ calories: 884, fat: 100 }),
      })
    );
  });

  it('blocks saving a custom food without a name', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('food-search-create-custom'));

    expect(screen.getByTestId('custom-food-error')).toHaveTextContent('Name is required.');
    expect(screen.getByTestId('custom-food-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('custom-food-save'));
    expect(repos.upsertFood).not.toHaveBeenCalled();
  });
});
