/* eslint-env jest */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { addFoodEntries, upsertFood } from '@/db/repositories';
import { addDaysISO, todayISO } from '@/domain';

import ScanReviewScreen from '../../../../app/scan-review';
import { encodePayload, makeVisionResult } from './testKit';

jest.mock('@/ui', () => require('./testKit').makeUiMock());
jest.mock('@/services/vision', () => require('./testKit').makeVisionServiceMock());
jest.mock('@/db/repositories', () => require('./testKit').makeRepositoriesMock());

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => React.createElement(Text, null, name),
  };
});

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    canDismiss: jest.fn(() => true),
    canGoBack: jest.fn(() => true),
  },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockedParams = useLocalSearchParams as unknown as jest.Mock;
const mockedAddFoodEntries = addFoodEntries as unknown as jest.Mock;
const mockedUpsertFood = upsertFood as unknown as jest.Mock;

const CHICKEN_TOGGLE = 'include-toggle-scan-item-0';
const RICE_TOGGLE = 'include-toggle-scan-item-1';

function renderReview(params: Record<string, string> = {}) {
  mockedParams.mockReturnValue({
    payload: encodePayload(makeVisionResult()),
    date: '2026-08-19',
    mealType: 'dinner',
    photoUri: 'file:///mock/photo.jpg',
    ...params,
  });
  return render(<ScanReviewScreen />);
}

describe('scan review screen', () => {
  it('renders every detected item with its confidence', () => {
    renderReview();

    expect(screen.getByDisplayValue('Grilled chicken breast')).toBeTruthy();
    expect(screen.getByDisplayValue('Steamed white rice')).toBeTruthy();
    expect(screen.getByText('High 88%')).toBeTruthy();
    expect(screen.getByText('Low 30%')).toBeTruthy();
    expect(screen.getByText('Low confidence, please check')).toBeTruthy();
    expect(screen.getByTestId('review-totals-footer')).toBeTruthy();
    expect(screen.getByText('482 kcal')).toBeTruthy();
    expect(screen.getByTestId('provider-line')).toHaveTextContent('Demo (on-device) · mock-vision-1');
  });

  it('shows an error state instead of crashing on a malformed payload', () => {
    renderReview({ payload: 'not-json-at-all' });

    expect(screen.getByText("We couldn't read that scan")).toBeTruthy();
    expect(screen.queryByTestId('review-totals-footer')).toBeNull();

    fireEvent.press(screen.getByLabelText('Scan again'));
    expect(router.replace).toHaveBeenCalledWith('/scan');
  });

  it('disables logging when no item is included', () => {
    renderReview();

    fireEvent.press(screen.getByTestId(CHICKEN_TOGGLE));
    fireEvent.press(screen.getByTestId(RICE_TOGGLE));

    const logButton = screen.getByTestId('log-button');
    expect(screen.getByText('Log 0 items')).toBeTruthy();
    expect(logButton).toBeDisabled();

    fireEvent.press(logButton);
    expect(mockedAddFoodEntries).not.toHaveBeenCalled();
  });

  it('excludes an item from the totals', () => {
    renderReview();

    fireEvent.press(screen.getByTestId(RICE_TOGGLE));

    expect(screen.getByText('248 kcal')).toBeTruthy();
    expect(screen.getByText('Log 1 item')).toBeTruthy();
  });

  it('rescales an item inline when its grams change', () => {
    renderReview();

    fireEvent.changeText(screen.getAllByLabelText('Grams')[0], '300');

    expect(screen.getAllByLabelText('Calories')[0].props.value).toBe('496');
  });

  it('logs the included items in one call and returns to the diary', async () => {
    renderReview();

    fireEvent.changeText(screen.getAllByLabelText('Grams')[0], '300');
    fireEvent.press(screen.getByTestId('log-button'));

    await waitFor(() => expect(mockedAddFoodEntries).toHaveBeenCalledTimes(1));

    const drafts = mockedAddFoodEntries.mock.calls[0][0];
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      date: '2026-08-19',
      mealType: 'dinner',
      source: 'vision',
      gramsTotal: 300,
      wasEdited: true,
      photoUri: 'file:///mock/photo.jpg',
    });
    expect(drafts[1].wasEdited).toBe(false);
    expect(mockedUpsertFood).not.toHaveBeenCalled();
    expect(router.dismissAll).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/diary');
  });

  it('also stores custom foods when the option is ticked', async () => {
    renderReview();

    fireEvent.press(screen.getByTestId('save-custom-toggle'));
    fireEvent.press(screen.getByTestId('log-button'));

    await waitFor(() => expect(mockedUpsertFood).toHaveBeenCalledTimes(2));

    const food = mockedUpsertFood.mock.calls[0][0];
    expect(food).toMatchObject({ name: 'Grilled chicken breast', servingSizeG: 150 });
    expect(food.per100g.calories).toBe(165);
  });

  it('blocks logging until an added item gets a name', () => {
    renderReview();

    fireEvent.press(screen.getByTestId('add-item'));

    expect(screen.getByTestId('log-button')).toBeDisabled();
    expect(screen.getByText('Every item needs a name.')).toBeTruthy();

    fireEvent.changeText(screen.getAllByLabelText('Item 3')[0], 'Olive oil');

    expect(screen.getByTestId('log-button')).not.toBeDisabled();
  });

  it('deletes an item from the review', () => {
    renderReview();

    fireEvent.press(screen.getByTestId('delete-scan-item-1'));

    expect(screen.queryByDisplayValue('Steamed white rice')).toBeNull();
    expect(screen.getByText('Log 1 item')).toBeTruthy();
  });

  it('offers a one-tap fix when the macros do not match the calories', () => {
    const mismatched = makeVisionResult();
    mismatched.items[0].macros = { calories: 900, protein: 10, carbs: 20, fat: 8 };
    renderReview({ payload: encodePayload(mismatched) });

    expect(screen.getByTestId('mismatch-scan-item-0')).toBeTruthy();

    fireEvent.press(screen.getByTestId('fix-calories-scan-item-0'));

    expect(screen.queryByTestId('mismatch-scan-item-0')).toBeNull();
    expect(screen.getAllByLabelText('Calories')[0].props.value).toBe('192');
  });

  it('hands an item to the full editor with an encoded draft', () => {
    renderReview();

    fireEvent.press(screen.getByTestId('open-editor-scan-item-0'));

    const href = (router.push as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(href.startsWith('/food-edit?draft=')).toBe(true);

    const encoded = href.slice('/food-edit?draft='.length).split('&')[0];
    const draft = JSON.parse(decodeURIComponent(encoded));
    expect(draft).toMatchObject({
      name: 'Grilled chicken breast',
      mealType: 'dinner',
      date: '2026-08-19',
      source: 'vision',
    });
    expect(href).toContain('mealType=dinner');
  });

  it('shows dismissible warnings with a settings shortcut', () => {
    renderReview({
      payload: encodePayload(
        makeVisionResult({ warnings: ['Using simulated data — add an API key in Settings'] })
      ),
    });

    expect(screen.getByTestId('warnings-card')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open Settings'));
    expect(router.push).toHaveBeenCalledWith('/settings');

    fireEvent.press(screen.getByTestId('dismiss-warnings'));
    expect(screen.queryByTestId('warnings-card')).toBeNull();
  });

  it('lets the meal and the date be changed before logging', async () => {
    renderReview();
    const yesterday = addDaysISO(todayISO(), -1);

    fireEvent.press(screen.getByLabelText('Breakfast'));
    fireEvent.press(screen.getByTestId('date-picker'));
    fireEvent.press(screen.getByTestId(`date-option-${yesterday}`));
    fireEvent.press(screen.getByTestId('log-button'));

    await waitFor(() => expect(mockedAddFoodEntries).toHaveBeenCalledTimes(1));

    const drafts = mockedAddFoodEntries.mock.calls[0][0];
    expect(drafts[0]).toMatchObject({ mealType: 'breakfast', date: yesterday });
  });

  it('surfaces a save failure without losing the edits', async () => {
    mockedAddFoodEntries.mockRejectedValueOnce(new Error('database is locked'));
    renderReview();

    fireEvent.press(screen.getByTestId('log-button'));

    await waitFor(() => expect(screen.getByTestId('log-error')).toBeTruthy());
    expect(screen.getByText('database is locked')).toBeTruthy();
    expect(screen.getByDisplayValue('Grilled chicken breast')).toBeTruthy();
  });
});
