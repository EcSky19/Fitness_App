import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import * as ImagePicker from 'expo-image-picker';

import RecipeEditScreen from '../../../../app/recipe-edit';
import RecipesScreen from '../../../../app/recipes';
import { RecipePicker } from '../RecipePicker';
import { useAppStore } from '@/store/appStore';
import type { FoodEntry, Macros, Recipe, RecipeItem } from '@/types';

jest.mock('@/ui', () => require('@/features/diary/__tests__/harness').uiMock());
jest.mock('@/hooks/useAsyncData', () => require('@/features/diary/__tests__/harness').asyncDataMock(), { virtual: true });
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-router', () => require('@/features/diary/__tests__/harness').routerMock());

jest.mock('@/domain', () => {
  const base = require('@/features/diary/__tests__/harness').domainMock();
  const emptyMacros = (): Macros => ({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const scaleMacrosSafe = (m: Macros, factor: number): Macros => ({
    calories: base.roundTo((m?.calories ?? 0) * factor, 2),
    protein: base.roundTo((m?.protein ?? 0) * factor, 2),
    carbs: base.roundTo((m?.carbs ?? 0) * factor, 2),
    fat: base.roundTo((m?.fat ?? 0) * factor, 2),
  });
  return {
    ...base,
    recipeTotals: (items: Array<Pick<RecipeItem, 'macros' | 'gramsTotal'>>) => ({
      macros: (items ?? []).reduce((acc, item) => ({
        calories: acc.calories + (item.macros?.calories ?? 0),
        protein: acc.protein + (item.macros?.protein ?? 0),
        carbs: acc.carbs + (item.macros?.carbs ?? 0),
        fat: acc.fat + (item.macros?.fat ?? 0),
      }), emptyMacros()),
      grams: (items ?? []).reduce((sum, item) => sum + (item.gramsTotal ?? 0), 0),
    }),
    perServing: (totals: Macros, grams: number, servings: number) => {
      const divisor = servings > 0 ? servings : 1;
      return { macros: scaleMacrosSafe(totals, 1 / divisor), grams: base.roundTo(grams / divisor, 2) };
    },
    scaleRecipeItems: (items: RecipeItem[], factor: number) => (items ?? []).map((item) => ({
      ...item,
      quantity: base.roundTo(item.quantity * factor, 2),
      gramsTotal: base.roundTo(item.gramsTotal * factor, 2),
      macros: scaleMacrosSafe(item.macros, factor),
    })),
  };
});

jest.mock('@/db/repositories', () => ({
  listRecipes: jest.fn(),
  getRecipe: jest.fn(),
  searchRecipes: jest.fn(),
  saveRecipe: jest.fn(),
  deleteRecipe: jest.fn(),
  toggleFavoriteRecipe: jest.fn(),
  logRecipe: jest.fn(),
}));

const mockRepoFns = jest.requireMock('@/db/repositories') as Record<string, jest.Mock>;
const mockedLibrary = ImagePicker.launchImageLibraryAsync as unknown as jest.Mock;

const routerModule = jest.requireMock('expo-router') as {
  __setParams: (params: Record<string, unknown>) => void;
  router: { back: jest.Mock; replace: jest.Mock; canGoBack: jest.Mock; push: jest.Mock };
};

const TODAY = '2026-08-19';
const NOW = '2026-08-19T12:00:00.000Z';

function macros(calories: number, protein: number, carbs: number, fat: number): Macros {
  return { calories, protein, carbs, fat };
}

function item(id: string, name: string, m: Macros, gramsTotal = 100): RecipeItem {
  return {
    id,
    recipeId: 'r1',
    foodId: null,
    name,
    quantity: 1,
    unit: 'serving',
    gramsTotal,
    macros: m,
    sortOrder: Number(id.replace(/\D/g, '')) || 0,
  };
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  const items = overrides.items ?? [
    item('i1', 'Oats', macros(300, 10, 50, 5), 80),
    item('i2', 'Milk', macros(120, 8, 12, 4), 240),
  ];
  const totals = items.reduce((acc, it) => ({
    calories: acc.calories + it.macros.calories,
    protein: acc.protein + it.macros.protein,
    carbs: acc.carbs + it.macros.carbs,
    fat: acc.fat + it.macros.fat,
  }), macros(0, 0, 0, 0));
  return {
    id: 'r1',
    name: 'Usual breakfast',
    kind: 'recipe',
    servings: 2,
    defaultMealType: 'breakfast',
    notes: null,
    photoUri: null,
    isFavorite: false,
    timesLogged: 3,
    lastLoggedAt: NOW,
    items,
    totals,
    totalGrams: items.reduce((sum, it) => sum + it.gramsTotal, 0),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function entryFromItem(it: RecipeItem, servingFactor = 1): FoodEntry {
  return {
    id: `e-${it.id}`,
    date: TODAY,
    mealType: 'breakfast',
    foodId: it.foodId,
    name: it.name,
    brand: null,
    quantity: it.quantity * servingFactor,
    unit: 'serving',
    servingLabel: `${it.gramsTotal * servingFactor} g`,
    gramsTotal: it.gramsTotal * servingFactor,
    macros: macros(
      it.macros.calories * servingFactor,
      it.macros.protein * servingFactor,
      it.macros.carbs * servingFactor,
      it.macros.fat * servingFactor
    ),
    photoUri: null,
    source: 'custom',
    visionConfidence: null,
    wasEdited: false,
    loggedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({ selectedDate: TODAY, dataVersion: 0 });
  routerModule.__setParams({});
  routerModule.router.canGoBack.mockReturnValue(true);
  mockRepoFns.listRecipes.mockResolvedValue([recipe()]);
  mockRepoFns.searchRecipes.mockResolvedValue([recipe()]);
  mockRepoFns.getRecipe.mockResolvedValue(null);
  mockRepoFns.saveRecipe.mockImplementation(async (input) => ({ ...recipe(), ...input }));
  mockRepoFns.deleteRecipe.mockResolvedValue(undefined);
  mockRepoFns.toggleFavoriteRecipe.mockResolvedValue(recipe({ isFavorite: true }));
  mockRepoFns.logRecipe.mockImplementation(async ({ servings = 1 }) => recipe().items.map((it) => entryFromItem(it, servings / recipe().servings)));
});

async function renderEdit(params: Record<string, unknown> = {}): Promise<void> {
  routerModule.__setParams(params);
  render(<RecipeEditScreen />);
  await act(async () => {});
  await screen.findByTestId('recipe-save');
}

describe('recipe browse and logging', () => {
  it('shows recipes with per-serving macros, kind filters, and a useful empty state', async () => {
    render(<RecipesScreen />);
    expect(await screen.findByTestId('recipe-card-r1')).toBeTruthy();
    expect(screen.getByTestId('recipe-macros-r1')).toHaveTextContent(/210 kcal/);
    expect(screen.getByTestId('recipe-kind-r1')).toHaveTextContent('Per serving');

    mockRepoFns.listRecipes.mockResolvedValueOnce([]);
    fireEvent.press(screen.getByTestId('recipe-filter-favorites'));
    expect(await screen.findByTestId('recipe-empty')).toHaveTextContent(/No favorites yet/);
    expect(screen.getByText(/Meals are combinations/)).toBeTruthy();
  });

  it('guards a double-tapped Log recipe confirmation so one set of entries is created', async () => {
    render(<RecipesScreen />);
    await screen.findByTestId('recipe-log-r1');
    fireEvent.press(screen.getByTestId('recipe-log-r1'));
    const confirm = await screen.findByTestId('recipe-log-confirm');

    fireEvent.press(confirm);
    fireEvent.press(confirm);

    await waitFor(() => expect(mockRepoFns.logRecipe).toHaveBeenCalledTimes(1));
    expect(mockRepoFns.logRecipe).toHaveBeenCalledWith({ recipeId: 'r1', date: TODAY, mealType: 'breakfast', servings: 1 });
  });

  it('previews scaled serving counts before logging', async () => {
    render(<RecipePicker date={TODAY} mealType="dinner" />);
    await screen.findByTestId('recipe-log-r1');
    fireEvent.press(screen.getByTestId('recipe-log-r1'));
    fireEvent.changeText(await screen.findByTestId('recipe-log-servings'), '2');

    expect(screen.getByTestId('recipe-log-preview-macros')).toHaveTextContent(/420 kcal/);
    fireEvent.press(screen.getByTestId('segment-dinner'));
    fireEvent.press(screen.getByTestId('recipe-log-confirm'));
    await waitFor(() => expect(mockRepoFns.logRecipe).toHaveBeenCalledWith(expect.objectContaining({ mealType: 'dinner', servings: 2 })));
  });

  it('surfaces list load errors', async () => {
    mockRepoFns.listRecipes.mockRejectedValueOnce(new Error('database unavailable'));
    render(<RecipePicker />);
    expect(await screen.findByTestId('recipe-list-error')).toHaveTextContent(/database unavailable/);
  });
});

describe('recipe editor', () => {
  it('creates a recipe with several items and verifies total and per-serving math', async () => {
    await renderEdit();
    fireEvent.changeText(screen.getByTestId('recipe-name'), 'Batch chilli');
    fireEvent.press(screen.getByTestId('segment-recipe'));
    fireEvent.changeText(screen.getByTestId('recipe-servings'), '4');

    fireEvent.press(screen.getByTestId('ingredient-add'));
    fireEvent.changeText(await screen.findByTestId('ingredient-name'), 'Beans');
    fireEvent.changeText(screen.getByTestId('ingredient-grams'), '400');
    fireEvent.changeText(screen.getByTestId('ingredient-calories'), '500');
    fireEvent.changeText(screen.getByTestId('ingredient-protein'), '30');
    fireEvent.changeText(screen.getByTestId('ingredient-carbs'), '80');
    fireEvent.changeText(screen.getByTestId('ingredient-fat'), '5');
    fireEvent.press(screen.getByTestId('ingredient-save'));

    fireEvent.press(screen.getByTestId('ingredient-add'));
    fireEvent.changeText(await screen.findByTestId('ingredient-name'), 'Beef');
    fireEvent.changeText(screen.getByTestId('ingredient-grams'), '600');
    fireEvent.changeText(screen.getByTestId('ingredient-calories'), '900');
    fireEvent.changeText(screen.getByTestId('ingredient-protein'), '120');
    fireEvent.changeText(screen.getByTestId('ingredient-carbs'), '0');
    fireEvent.changeText(screen.getByTestId('ingredient-fat'), '50');
    fireEvent.press(screen.getByTestId('ingredient-save'));

    expect(screen.getByTestId('recipe-total-macros')).toHaveTextContent(/1400 kcal/);
    expect(screen.getByTestId('recipe-per-serving')).toHaveTextContent(/350 kcal/);

    fireEvent.press(screen.getByTestId('recipe-save'));
    await waitFor(() => expect(mockRepoFns.saveRecipe).toHaveBeenCalledTimes(1));
    expect(mockRepoFns.saveRecipe).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Batch chilli',
      kind: 'recipe',
      servings: 4,
      items: expect.arrayContaining([
        expect.objectContaining({ name: 'Beans', gramsTotal: 400 }),
        expect.objectContaining({ name: 'Beef', gramsTotal: 600 }),
      ]),
    }));
  });

  it('edits by replacing the full item list rather than duplicating old ingredients', async () => {
    mockRepoFns.getRecipe.mockResolvedValue(recipe());
    await renderEdit({ recipeId: 'r1' });

    fireEvent.press(screen.getByTestId('ingredient-remove-i1'));
    fireEvent.press(screen.getByTestId('ingredient-add'));
    fireEvent.changeText(await screen.findByTestId('ingredient-name'), 'Banana');
    fireEvent.changeText(screen.getByTestId('ingredient-grams'), '120');
    fireEvent.changeText(screen.getByTestId('ingredient-calories'), '105');
    fireEvent.changeText(screen.getByTestId('ingredient-protein'), '1');
    fireEvent.changeText(screen.getByTestId('ingredient-carbs'), '27');
    fireEvent.changeText(screen.getByTestId('ingredient-fat'), '0');
    fireEvent.press(screen.getByTestId('ingredient-save'));
    fireEvent.press(screen.getByTestId('recipe-save'));

    await waitFor(() => expect(mockRepoFns.saveRecipe).toHaveBeenCalledTimes(1));
    const saved = mockRepoFns.saveRecipe.mock.calls[0][0];
    expect(saved.items).toHaveLength(2);
    expect(saved.items.map((it: { name: string }) => it.name)).toEqual(['Milk', 'Banana']);
  });

  /**
   * The photo used to be a raw "Photo URI" text box asking people to type
   * `file:///…`, which no real user can do. It has to be a picker.
   */
  it('attaches a photo through the image picker rather than a typed path', async () => {
    mockRepoFns.getRecipe.mockResolvedValue(recipe());
    await renderEdit({ recipeId: 'r1' });

    expect(screen.queryByTestId('recipe-photo-uri')).toBeNull();
    expect(screen.queryByTestId('recipe-photo')).toBeNull();

    mockedLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///library/chilli.jpg' }],
    });
    fireEvent.press(screen.getByTestId('recipe-photo-pick'));

    await waitFor(() => expect(screen.getByTestId('recipe-photo')).toBeTruthy());
    fireEvent.press(screen.getByTestId('recipe-save'));

    await waitFor(() => expect(mockRepoFns.saveRecipe).toHaveBeenCalledTimes(1));
    expect(mockRepoFns.saveRecipe.mock.calls[0][0].photoUri).toBe('file:///library/chilli.jpg');
  });

  it('lets an attached photo be removed again', async () => {
    mockRepoFns.getRecipe.mockResolvedValue({ ...recipe(), photoUri: 'file:///photos/old.jpg' });
    await renderEdit({ recipeId: 'r1' });

    expect(screen.getByTestId('recipe-photo')).toBeTruthy();
    fireEvent.press(screen.getByTestId('recipe-photo-remove'));

    expect(screen.queryByTestId('recipe-photo')).toBeNull();
    fireEvent.press(screen.getByTestId('recipe-save'));

    await waitFor(() => expect(mockRepoFns.saveRecipe).toHaveBeenCalledTimes(1));
    expect(mockRepoFns.saveRecipe.mock.calls[0][0].photoUri).toBeNull();
  });

  it('reports a photo library failure instead of failing silently', async () => {
    mockRepoFns.getRecipe.mockResolvedValue(recipe());
    await renderEdit({ recipeId: 'r1' });

    mockedLibrary.mockRejectedValueOnce(new Error('no permission'));
    fireEvent.press(screen.getByTestId('recipe-photo-pick'));

    expect(await screen.findByTestId('recipe-photo-error')).toBeTruthy();
  });

  it('asks for confirmation before deleting', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Delete')?.onPress?.();
    });
    mockRepoFns.getRecipe.mockResolvedValue(recipe());
    await renderEdit({ recipeId: 'r1' });

    fireEvent.press(screen.getByTestId('recipe-delete'));

    await waitFor(() => expect(mockRepoFns.deleteRecipe).toHaveBeenCalledWith('r1'));
    alertSpy.mockRestore();
  });
});
