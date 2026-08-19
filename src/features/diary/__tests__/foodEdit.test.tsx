/**
 * `app/food-edit.tsx` — the universal entry editor and its four route modes.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import FoodEditScreen from '../../../../app/food-edit';
import { makeEntry, makeFood, TODAY } from './harness';
import { useAppStore } from '@/store/appStore';

jest.mock('@/ui', () => require('./harness').uiMock());
jest.mock('@/domain', () => require('./harness').domainMock());
jest.mock('@/db/repositories', () => require('./harness').repositoriesMock());
jest.mock('@/hooks/useAsyncData', () => require('./harness').asyncDataMock(), { virtual: true });
jest.mock('@/services/foodSearch', () => require('./harness').foodSearchMock(), { virtual: true });
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => require('./harness').routerMock());

const repos = jest.requireMock('@/db/repositories') as Record<string, jest.Mock>;
const routerModule = jest.requireMock('expo-router') as {
  router: { push: jest.Mock; back: jest.Mock };
  __setParams: (params: Record<string, unknown>) => void;
};

const DRAFT_PAYLOAD = {
  date: TODAY,
  mealType: 'lunch',
  name: 'Chicken bowl',
  brand: null,
  quantity: 1,
  unit: 'serving',
  servingLabel: '1 bowl (350 g)',
  gramsTotal: 350,
  macros: { calories: 520, protein: 42, carbs: 55, fat: 14 },
  photoUri: 'file:///plate.jpg',
  source: 'vision',
  visionConfidence: 0.82,
};

const DRAFT_PARAM = encodeURIComponent(JSON.stringify(DRAFT_PAYLOAD));

async function renderScreen(params: Record<string, unknown>): Promise<void> {
  routerModule.__setParams(params);
  render(<FoodEditScreen />);
  await act(async () => {});
  await screen.findByTestId('entry-save');
}

beforeEach(() => {
  useAppStore.setState({ selectedDate: TODAY, dataVersion: 0 });
  repos.listEntriesByDate.mockResolvedValue([]);
  repos.listExercisesByDate.mockResolvedValue([]);
  repos.getActiveGoal.mockResolvedValue({
    id: 'goal-1',
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 67 },
  });
  repos.getFoodEntry.mockResolvedValue(null);
  repos.getFood.mockResolvedValue(null);
  repos.addFoodEntry.mockResolvedValue(undefined);
  repos.updateFoodEntry.mockResolvedValue(undefined);
  repos.deleteFoodEntry.mockResolvedValue(undefined);
  repos.bumpFoodUsage.mockResolvedValue(undefined);
  repos.upsertFood.mockResolvedValue(null);
});

describe('draft mode (scan hand-off)', () => {
  it('parses `/food-edit?draft=` and pre-fills the AI values', async () => {
    await renderScreen({ draft: DRAFT_PARAM, date: TODAY, mealType: 'lunch' });

    expect(screen.queryByTestId('food-edit-warning')).toBeNull();
    expect(screen.getByTestId('ai-confidence-badge')).toHaveTextContent('AI · 82% confident');
    expect(screen.getByText('Tap any value to correct it.')).toBeTruthy();
    expect(screen.getByTestId('entry-name').props.value).toBe('Chicken bowl');
    expect(screen.getByTestId('macro-calories').props.value).toBe('520');
    expect(screen.getByTestId('preview-calories')).toHaveTextContent('520 kcal');
    expect(screen.getByTestId('quantity-summary')).toHaveTextContent(/350 g total/);
  });

  it('falls back to quick add with a banner when the payload is malformed', async () => {
    await renderScreen({ draft: '%%%not-json', date: TODAY, mealType: 'lunch' });

    expect(screen.getByTestId('food-edit-warning')).toBeTruthy();
    expect(screen.getByTestId('entry-name').props.value).toBe('');
    expect(screen.getByTestId('macro-calories').props.value).toBe('0');
    expect(screen.getByTestId('entry-save')).toBeDisabled();
    expect(screen.queryByTestId('entry-save-as-food')).toBeNull();
  });

  it('shows the photo full screen when the thumbnail is tapped', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    expect(screen.queryByTestId('entry-photo-sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('entry-photo'));
    expect(screen.getByTestId('entry-photo-sheet')).toBeTruthy();
  });

  it('saves the corrected item and marks it edited', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.changeText(screen.getByTestId('entry-name'), 'Chicken burrito bowl');
    fireEvent.press(screen.getByTestId('entry-save'));

    await waitFor(() => expect(repos.addFoodEntry).toHaveBeenCalledTimes(1));
    expect(repos.addFoodEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chicken burrito bowl',
        mealType: 'lunch',
        date: TODAY,
        source: 'vision',
        visionConfidence: 0.82,
        photoUri: 'file:///plate.jpg',
        wasEdited: true,
      })
    );
    await waitFor(() => expect(routerModule.router.back).toHaveBeenCalled());
  });

  it('leaves `wasEdited` false when nothing was corrected', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.press(screen.getByTestId('entry-save'));

    await waitFor(() => expect(repos.addFoodEntry).toHaveBeenCalledTimes(1));
    expect(repos.addFoodEntry).toHaveBeenCalledWith(
      expect.objectContaining({ wasEdited: false })
    );
  });

  it('offers saving the corrected item as a reusable custom food', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.press(screen.getByTestId('entry-save-as-food'));

    await waitFor(() => expect(repos.upsertFood).toHaveBeenCalledTimes(1));
    expect(repos.upsertFood).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chicken bowl',
        source: 'custom',
        servingSizeG: 350,
        per100g: expect.objectContaining({ calories: 149, protein: 12 }),
      })
    );
    alertSpy.mockRestore();
  });
});

describe('macro editing', () => {
  it('warns when the typed calories disagree with 4/4/9 and fixes them on request', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    expect(screen.queryByTestId('calorie-mismatch')).toBeNull();

    fireEvent.changeText(screen.getByTestId('macro-protein'), '80');

    expect(screen.getByTestId('calorie-mismatch')).toBeTruthy();
    expect(screen.getByTestId('macro-computed-hint')).toHaveTextContent('From macros: 666 kcal');
    expect(screen.getByTestId('macro-calories').props.value).toBe('520');

    fireEvent.press(screen.getByTestId('use-computed-calories'));

    expect(screen.getByTestId('macro-calories').props.value).toBe('666');
    expect(screen.queryByTestId('calorie-mismatch')).toBeNull();
  });

  it('never rewrites the macros when only calories are edited', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.changeText(screen.getByTestId('macro-calories'), '900');

    expect(screen.getByTestId('macro-protein').props.value).toBe('42');
    expect(screen.getByTestId('macro-carbs').props.value).toBe('55');
    expect(screen.getByTestId('macro-fat').props.value).toBe('14');
    expect(screen.getByTestId('preview-calories')).toHaveTextContent('900 kcal');
  });

  it('reveals fiber, sugar and sodium behind "More"', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    expect(screen.queryByTestId('macro-more')).toBeNull();
    fireEvent.press(screen.getByTestId('macro-toggle-more'));

    expect(screen.getByTestId('macro-fiber')).toBeTruthy();
    expect(screen.getByTestId('macro-sugar')).toBeTruthy();
    expect(screen.getByTestId('macro-sodium')).toBeTruthy();
  });
});

describe('amount editing', () => {
  it('rescales the macros when the quantity changes', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.changeText(screen.getByTestId('quantity-field'), '2');

    expect(screen.getByTestId('preview-calories')).toHaveTextContent('1040 kcal');
    expect(screen.getByTestId('macro-protein').props.value).toBe('84');
    expect(screen.getByTestId('quantity-summary')).toHaveTextContent(/700 g total/);
  });

  it('rescales when the unit changes', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.press(screen.getByTestId('unit-chip-g'));
    fireEvent.changeText(screen.getByTestId('quantity-field'), '175');

    expect(screen.getByTestId('quantity-summary')).toHaveTextContent(/175 g total/);
    expect(screen.getByTestId('preview-calories')).toHaveTextContent('260 kcal');
  });
});

describe('validation', () => {
  it('blocks saving with an empty name', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.changeText(screen.getByTestId('entry-name'), '');

    expect(screen.getByTestId('entry-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('entry-save'));
    expect(repos.addFoodEntry).not.toHaveBeenCalled();
  });

  it('blocks saving with a quantity of zero and explains why', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.changeText(screen.getByTestId('quantity-field'), '0');

    expect(screen.getByTestId('quantity-error')).toHaveTextContent(/more than 0/);
    expect(screen.getByTestId('entry-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('entry-save'));
    expect(repos.addFoodEntry).not.toHaveBeenCalled();
  });
});

describe('edit mode', () => {
  it('loads the entry and updates it on save', async () => {
    repos.getFoodEntry.mockResolvedValue(
      makeEntry({ id: 'e1', name: 'Oatmeal', mealType: 'breakfast', foodId: 'food-1' })
    );
    repos.getFood.mockResolvedValue(makeFood({ id: 'food-1' }));

    await renderScreen({ entryId: 'e1' });

    expect(screen.getByTestId('entry-name').props.value).toBe('Oatmeal');
    expect(screen.queryByTestId('ai-confidence-badge')).toBeNull();

    fireEvent.changeText(screen.getByTestId('macro-carbs'), '45');
    fireEvent.press(screen.getByTestId('entry-save'));

    await waitFor(() => expect(repos.updateFoodEntry).toHaveBeenCalledTimes(1));
    expect(repos.updateFoodEntry).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ name: 'Oatmeal', wasEdited: true })
    );
    expect(repos.bumpFoodUsage).toHaveBeenCalledWith('food-1');
    await waitFor(() => expect(routerModule.router.back).toHaveBeenCalled());
  });

  it('asks for confirmation before deleting', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    repos.getFoodEntry.mockResolvedValue(makeEntry({ id: 'e1', name: 'Oatmeal' }));

    await renderScreen({ entryId: 'e1' });

    fireEvent.press(screen.getByTestId('entry-delete'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(repos.deleteFoodEntry).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] ?? [];
    const confirm = buttons.find((button) => button.style === 'destructive');
    expect(confirm).toBeDefined();

    await act(async () => {
      confirm?.onPress?.();
    });

    expect(repos.deleteFoodEntry).toHaveBeenCalledWith('e1');
    await waitFor(() => expect(routerModule.router.back).toHaveBeenCalled());
    alertSpy.mockRestore();
  });

  it('warns without crashing when the entry has disappeared', async () => {
    repos.getFoodEntry.mockResolvedValue(null);

    await renderScreen({ entryId: 'gone' });

    expect(screen.getByTestId('food-edit-warning')).toHaveTextContent(/no longer exists/);
  });
});

describe('food and quick add modes', () => {
  it('logs a food picked in the search screen', async () => {
    repos.getFood.mockResolvedValue(makeFood({ id: 'food-1', name: 'Greek yogurt' }));

    await renderScreen({ foodId: 'food-1', date: TODAY, mealType: 'breakfast' });

    expect(screen.getByTestId('entry-name').props.value).toBe('Greek yogurt');
    expect(screen.getByTestId('macro-calories').props.value).toBe('150');
    expect(screen.queryByTestId('entry-delete')).toBeNull();

    fireEvent.press(screen.getByTestId('entry-save'));

    await waitFor(() => expect(repos.addFoodEntry).toHaveBeenCalledTimes(1));
    expect(repos.addFoodEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        foodId: 'food-1',
        name: 'Greek yogurt',
        mealType: 'breakfast',
        date: TODAY,
        gramsTotal: 150,
      })
    );
    expect(repos.bumpFoodUsage).toHaveBeenCalledWith('food-1');
  });

  it('supports a quick add with no food record', async () => {
    await renderScreen({ quickAdd: '1', date: TODAY, mealType: 'snack' });

    expect(screen.getByTestId('entry-save')).toBeDisabled();

    fireEvent.changeText(screen.getByTestId('entry-name'), 'Protein shake');
    fireEvent.changeText(screen.getByTestId('macro-calories'), '160');

    expect(screen.queryByTestId('calorie-mismatch')).toBeNull();
    fireEvent.press(screen.getByTestId('entry-save'));

    await waitFor(() => expect(repos.addFoodEntry).toHaveBeenCalledTimes(1));
    expect(repos.addFoodEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Protein shake',
        foodId: null,
        mealType: 'snack',
        source: 'quick_add',
        macros: expect.objectContaining({ calories: 160 }),
      })
    );
  });

  it('lets the user move the entry to a different meal', async () => {
    await renderScreen({ draft: DRAFT_PARAM });

    fireEvent.press(screen.getByTestId('segment-dinner'));
    fireEvent.press(screen.getByTestId('entry-save'));

    await waitFor(() => expect(repos.addFoodEntry).toHaveBeenCalledTimes(1));
    expect(repos.addFoodEntry).toHaveBeenCalledWith(
      expect.objectContaining({ mealType: 'dinner', wasEdited: true })
    );
  });
});
