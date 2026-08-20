/**
 * `useEntryDraft` — the maths and mode handling behind `app/food-edit.tsx`.
 *
 * Collaborators owned by other agents (`@/domain`, `@/services/foodSearch`,
 * `@/db/repositories`) are replaced with faithful doubles from `./harness`.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  amountRatio,
  buildCustomFoodInput,
  buildEntryInput,
  calorieCheck,
  entryDraftReducer,
  inferMealType,
  initialEntryDraftState,
  parseDraftParam,
  useEntryDraft,
  validateEntryDraft,
  type EntryDraftState,
} from '../useEntryDraft';
import { makeEntry, makeFood, makeMacros, TODAY } from './harness';
import type { ServingUnit } from '@/types';

jest.mock('@/domain', () => require('./harness').domainMock());
jest.mock('@/services/foodSearch', () => require('./harness').foodSearchMock(), { virtual: true });
jest.mock('@/db/repositories', () => require('./harness').repositoriesMock());

const repos = jest.requireMock('@/db/repositories') as Record<string, jest.Mock>;

const DRAFT_PAYLOAD = {
  date: TODAY,
  mealType: 'lunch' as const,
  foodId: null,
  name: 'Chicken bowl',
  brand: null,
  quantity: 1,
  unit: 'serving' as ServingUnit,
  servingLabel: '1 bowl (350 g)',
  gramsTotal: 350,
  macros: { calories: 520, protein: 42, carbs: 55, fat: 14 },
  photoUri: 'file:///photo.jpg',
  source: 'vision' as const,
  visionConfidence: 0.82,
  wasEdited: false,
  loggedAt: '2026-08-19T12:00:00.000Z',
};

const DEFAULTS = { date: TODAY, mealType: 'snack' as const };

function draftState(): EntryDraftState {
  return initialEntryDraftState(
    { draft: encodeURIComponent(JSON.stringify(DRAFT_PAYLOAD)) },
    DEFAULTS
  );
}

beforeEach(() => {
  repos.getFoodEntry.mockResolvedValue(null);
  repos.getFood.mockResolvedValue(null);
  repos.addFoodEntry.mockResolvedValue(undefined);
  repos.updateFoodEntry.mockResolvedValue(undefined);
  repos.deleteFoodEntry.mockResolvedValue(undefined);
  repos.bumpFoodUsage.mockResolvedValue(undefined);
  repos.upsertFood.mockResolvedValue(null);
});

describe('parseDraftParam', () => {
  it('parses a uri-encoded payload handed over by the scan flow', () => {
    const parsed = parseDraftParam(encodeURIComponent(JSON.stringify(DRAFT_PAYLOAD)));

    expect(parsed.error).toBeNull();
    expect(parsed.value).toMatchObject({
      name: 'Chicken bowl',
      quantity: 1,
      unit: 'serving',
      gramsTotal: 350,
      source: 'vision',
      visionConfidence: 0.82,
      photoUri: 'file:///photo.jpg',
    });
    expect(parsed.value?.macros).toMatchObject({ calories: 520, protein: 42 });
  });

  it('also accepts an already-decoded payload', () => {
    const parsed = parseDraftParam(JSON.stringify(DRAFT_PAYLOAD));
    expect(parsed.error).toBeNull();
    expect(parsed.value?.name).toBe('Chicken bowl');
  });

  it('falls back safely on a malformed payload instead of throwing', () => {
    expect(() => parseDraftParam('{not json%%%')).not.toThrow();

    const parsed = parseDraftParam('{not json%%%');
    expect(parsed.value).toBeNull();
    expect(parsed.error).toMatch(/quick add/i);
  });

  it('rejects payloads with neither a name nor macros', () => {
    const parsed = parseDraftParam(JSON.stringify({ quantity: 2 }));
    expect(parsed.value).toBeNull();
    expect(parsed.error).not.toBeNull();
  });
});

describe('initialEntryDraftState', () => {
  it('enters draft mode with the AI values pre-filled', () => {
    const state = draftState();

    expect(state.mode).toBe('draft');
    expect(state.name).toBe('Chicken bowl');
    expect(state.mealType).toBe('lunch');
    expect(state.visionConfidence).toBe(0.82);
    expect(state.warning).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('degrades a malformed draft to quick add plus a warning', () => {
    const state = initialEntryDraftState({ draft: '%%%not-json', date: TODAY }, DEFAULTS);

    expect(state.mode).toBe('quick_add');
    expect(state.warning).toMatch(/quick add/i);
    expect(state.macros).toMatchObject({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('honours explicit date and mealType params', () => {
    const state = initialEntryDraftState(
      { quickAdd: '1', date: '2026-01-05', mealType: 'dinner' },
      DEFAULTS
    );

    expect(state.mode).toBe('quick_add');
    expect(state.date).toBe('2026-01-05');
    expect(state.mealType).toBe('dinner');
  });

  it('ignores an invalid mealType and falls back to the default', () => {
    const state = initialEntryDraftState({ quickAdd: '1', mealType: 'brunch' }, DEFAULTS);
    expect(state.mealType).toBe('snack');
  });
});

describe('quantity and unit recompute the macros', () => {
  it('scales an AI draft proportionally when the quantity changes', () => {
    const next = entryDraftReducer(draftState(), { type: 'setQuantity', value: 2 });

    expect(next.gramsTotal).toBe(700);
    expect(next.macros.calories).toBe(1040);
    expect(next.macros.protein).toBe(84);
    expect(next.macros.carbs).toBe(110);
    expect(next.macros.fat).toBe(28);
  });

  it('scales down for a fractional quantity', () => {
    const next = entryDraftReducer(draftState(), { type: 'setQuantity', value: 0.5 });

    expect(next.gramsTotal).toBe(175);
    expect(next.macros.calories).toBe(260);
    expect(next.macros.protein).toBe(21);
  });

  it('recomputes grams and macros when the unit changes', () => {
    const inGrams = entryDraftReducer(draftState(), { type: 'setUnit', value: 'g' });

    expect(inGrams.unit).toBe('g');
    expect(inGrams.gramsTotal).toBe(1);
    expect(inGrams.macros.calories).toBeLessThan(520);

    // 350 g of the same item is the original amount again.
    const backToFull = entryDraftReducer(inGrams, { type: 'setQuantity', value: 350 });
    expect(backToFull.gramsTotal).toBe(350);
    expect(backToFull.macros.calories).toBe(520);
    expect(backToFull.macros.protein).toBe(42);
  });

  it('uses the food record when one is known', () => {
    const food = makeFood({ servingSizeG: 150, per100g: { calories: 100, protein: 10, carbs: 4, fat: 5 } });
    const hydrated = entryDraftReducer(
      initialEntryDraftState({ foodId: food.id }, DEFAULTS),
      { type: 'hydrate', patch: { loading: false, food, name: food.name, quantity: 1, unit: 'serving' } }
    );

    const next = entryDraftReducer(hydrated, { type: 'setQuantity', value: 2 });

    expect(next.gramsTotal).toBe(300);
    expect(next.macros.calories).toBe(300);
    expect(next.macros.protein).toBe(30);
  });

  it('keeps user-corrected macros as the anchor for later scaling', () => {
    const corrected = entryDraftReducer(draftState(), { type: 'setMacro', key: 'calories', value: 600 });
    const doubled = entryDraftReducer(corrected, { type: 'setQuantity', value: 2 });

    expect(doubled.macros.calories).toBe(1200);
  });

  it('never divides by zero when the anchor has no grams', () => {
    const quickAdd = initialEntryDraftState({ quickAdd: '1' }, DEFAULTS);
    const withCalories = entryDraftReducer(quickAdd, {
      type: 'setMacro',
      key: 'calories',
      value: 250,
    });
    const doubled = entryDraftReducer(withCalories, { type: 'setQuantity', value: 2 });

    expect(Number.isFinite(doubled.macros.calories)).toBe(true);
    expect(doubled.macros.calories).toBe(500);
    expect(amountRatio({ grams: 0, quantity: 0, unit: 'serving', macros: withCalories.macros }, 0, 0)).toBe(1);
  });
});

describe('calorie mismatch', () => {
  it('stays quiet while the typed calories agree with 4/4/9', () => {
    const check = calorieCheck({ calories: 520, protein: 42, carbs: 55, fat: 14 });

    expect(check.computed).toBe(514);
    expect(check.isMismatch).toBe(false);
  });

  it('flags a mismatch after the user edits protein', () => {
    const edited = entryDraftReducer(draftState(), { type: 'setMacro', key: 'protein', value: 80 });
    const check = calorieCheck(edited.macros);

    expect(check.computed).toBe(666);
    expect(check.isMismatch).toBe(true);
  });

  it('applies the computed value only when explicitly asked', () => {
    const edited = entryDraftReducer(draftState(), { type: 'setMacro', key: 'protein', value: 80 });
    expect(edited.macros.calories).toBe(520); // never silently rewritten

    const fixed = entryDraftReducer(edited, { type: 'useComputedCalories' });
    expect(fixed.macros.calories).toBe(666);
    expect(calorieCheck(fixed.macros).isMismatch).toBe(false);
  });

  it('does not nag on a calories-only quick add', () => {
    const check = calorieCheck({ calories: 300, protein: 0, carbs: 0, fat: 0 });
    expect(check.isMismatch).toBe(false);
  });
});

describe('wasEdited', () => {
  it('stays false when a value is re-set to the same content', () => {
    const state = draftState();
    const same = entryDraftReducer(state, { type: 'setName', value: 'Chicken bowl' });

    expect(same.dirty).toBe(false);
    expect(buildEntryInput(same).wasEdited).toBe(false);
  });

  it('flips to true as soon as a value actually changes', () => {
    const changed = entryDraftReducer(draftState(), { type: 'setName', value: 'Chicken salad' });

    expect(changed.dirty).toBe(true);
    expect(buildEntryInput(changed).wasEdited).toBe(true);
  });

  it('flips back to false when the change is undone', () => {
    const changed = entryDraftReducer(draftState(), { type: 'setMacro', key: 'protein', value: 80 });
    const undone = entryDraftReducer(changed, { type: 'setMacro', key: 'protein', value: 42 });

    expect(changed.dirty).toBe(true);
    expect(undone.dirty).toBe(false);
  });

  it('keeps an already edited entry marked as edited', () => {
    const state = entryDraftReducer(initialEntryDraftState({ entryId: 'e1' }, DEFAULTS), {
      type: 'hydrate',
      patch: { loading: false, wasEditedInitially: true, name: 'Oatmeal', quantity: 1 },
    });

    expect(buildEntryInput(state).wasEdited).toBe(true);
  });
});

describe('validation', () => {
  it('rejects a blank name', () => {
    const state = entryDraftReducer(draftState(), { type: 'setName', value: '   ' });
    expect(validateEntryDraft(state).name).toBeDefined();
  });

  it('rejects a quantity of zero or null', () => {
    expect(validateEntryDraft(entryDraftReducer(draftState(), { type: 'setQuantity', value: 0 })).quantity).toBeDefined();
    expect(validateEntryDraft(entryDraftReducer(draftState(), { type: 'setQuantity', value: null })).quantity).toBeDefined();
  });

  it('accepts a filled in draft', () => {
    expect(validateEntryDraft(draftState())).toEqual({});
  });
});

describe('buildCustomFoodInput', () => {
  it('converts the corrected absolute macros back to per 100 g', () => {
    const food = buildCustomFoodInput(draftState());

    expect(food.servingSizeG).toBe(350);
    expect(food.source).toBe('custom');
    expect(food.per100g.calories).toBe(149);
    expect(food.per100g.protein).toBe(12);
  });
});

describe('useEntryDraft', () => {
  it('hydrates edit mode from the repository and saves an update', async () => {
    repos.getFoodEntry.mockResolvedValue(
      makeEntry({ id: 'e1', foodId: 'food-1', name: 'Oatmeal', mealType: 'breakfast' })
    );
    repos.getFood.mockResolvedValue(makeFood({ id: 'food-1' }));

    const { result } = renderHook(() => useEntryDraft({ entryId: 'e1' }));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.mode).toBe('edit');
    expect(result.current.state.name).toBe('Oatmeal');
    expect(result.current.wasEdited).toBe(false);

    act(() => result.current.setMacro('protein', 30));

    await act(async () => {
      await result.current.save();
    });

    expect(repos.updateFoodEntry).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ name: 'Oatmeal', wasEdited: true })
    );
    expect(repos.bumpFoodUsage).toHaveBeenCalledWith('food-1');
    expect(repos.addFoodEntry).not.toHaveBeenCalled();
  });

  it('keeps a hand-corrected macro as the anchor when an edited food entry is re-scaled', async () => {
    // Logged earlier: the user overrode the food's numbers to 300 kcal / 30 g
    // protein for one 150 g serving, so the entry is flagged `wasEdited`.
    repos.getFoodEntry.mockResolvedValue(
      makeEntry({
        id: 'e1',
        foodId: 'food-1',
        name: 'Greek yogurt',
        quantity: 1,
        unit: 'serving',
        gramsTotal: 150,
        macros: makeMacros(300, 30, 12, 15),
        wasEdited: true,
      })
    );
    // The food record itself only knows 100 kcal / 10 g protein per 100 g,
    // i.e. 150 kcal for one serving — half of what the user corrected it to.
    repos.getFood.mockResolvedValue(
      makeFood({ id: 'food-1', servingSizeG: 150, per100g: { calories: 100, protein: 10, carbs: 4, fat: 5 } })
    );

    const { result } = renderHook(() => useEntryDraft({ entryId: 'e1' }));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.macros.calories).toBe(300);

    act(() => result.current.setQuantity(2));

    // Two servings of a 300 kcal correction must be 600 kcal, not the food's 300.
    expect(result.current.state.macros.calories).toBe(600);
    expect(result.current.state.macros.protein).toBe(60);
  });

  it('warns instead of crashing when the entry is gone', async () => {
    repos.getFoodEntry.mockResolvedValue(null);

    const { result } = renderHook(() => useEntryDraft({ entryId: 'missing' }));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.warning).toMatch(/no longer exists/i);
  });

  it('adds a new entry in quick add mode and blocks an invalid save', async () => {
    const { result } = renderHook(() =>
      useEntryDraft({ quickAdd: '1', date: TODAY, mealType: 'snack' })
    );

    expect(result.current.canSave).toBe(false); // name is still blank

    await act(async () => {
      await result.current.save();
    });
    expect(repos.addFoodEntry).not.toHaveBeenCalled();

    act(() => result.current.setName('Latte'));
    act(() => result.current.setMacro('calories', 180));
    expect(result.current.canSave).toBe(true);

    await act(async () => {
      await result.current.save();
    });

    expect(repos.addFoodEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Latte', mealType: 'snack', date: TODAY })
    );
    expect(repos.bumpFoodUsage).not.toHaveBeenCalled();
  });

  it('deletes through the repository', async () => {
    repos.getFoodEntry.mockResolvedValue(makeEntry({ id: 'e9' }));

    const { result } = renderHook(() => useEntryDraft({ entryId: 'e9' }));
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    await act(async () => {
      await result.current.remove();
    });

    expect(repos.deleteFoodEntry).toHaveBeenCalledWith('e9');
  });

  it('saves an AI corrected item as a reusable custom food', async () => {
    const { result } = renderHook(() =>
      useEntryDraft({ draft: encodeURIComponent(JSON.stringify(DRAFT_PAYLOAD)) })
    );

    await act(async () => {
      await result.current.saveAsCustomFood();
    });

    expect(repos.upsertFood).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Chicken bowl', source: 'custom', servingSizeG: 350 })
    );
  });
});

describe('inferMealType', () => {
  it('maps the clock to a sensible meal', () => {
    expect(inferMealType(new Date(2026, 0, 5, 8))).toBe('breakfast');
    expect(inferMealType(new Date(2026, 0, 5, 12))).toBe('lunch');
    expect(inferMealType(new Date(2026, 0, 5, 19))).toBe('dinner');
    expect(inferMealType(new Date(2026, 0, 5, 22))).toBe('snack');
  });
});
