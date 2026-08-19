/* eslint-env jest */
import { act, renderHook } from '@testing-library/react-native';

import {
  buildDrafts,
  calorieCheck,
  itemToFoodDraft,
  parseVisionPayload,
  perHundredGrams,
  rescaleFromBasis,
  totalsOf,
  useScanReview,
  type ReviewItem,
} from '../useScanReview';

import { encodePayload, makeMacros, makeVisionItem, makeVisionResult } from './testKit';

jest.mock('@/services/vision', () => require('./testKit').makeVisionServiceMock());

const CHICKEN = 'scan-item-0';
const RICE = 'scan-item-1';

function setup(result = makeVisionResult()) {
  return renderHook(() => useScanReview(result));
}

function byId(items: ReviewItem[], id: string): ReviewItem {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`missing item ${id}`);
  return found;
}

describe('useScanReview - portion rescaling', () => {
  it('rescales macros proportionally when grams change', () => {
    const { result } = setup();

    act(() => result.current.setGrams(CHICKEN, 300));

    const item = byId(result.current.items, CHICKEN);
    expect(item.grams).toBe(300);
    expect(item.macros.calories).toBe(496);
    expect(item.macros.protein).toBeCloseTo(93, 1);
    expect(item.macros.fat).toBeCloseTo(10.8, 1);
  });

  it('rescales grams and macros when the quantity changes', () => {
    const { result } = setup();

    act(() => result.current.setQuantity(CHICKEN, 2));

    const item = byId(result.current.items, CHICKEN);
    expect(item.quantity).toBe(2);
    expect(item.grams).toBe(300);
    expect(item.macros.calories).toBe(496);
  });

  it('never produces NaN when the model returned zero grams', () => {
    const zeroGrams = makeVisionResult({
      items: [makeVisionItem({ estimatedGrams: 0, macros: makeMacros({ calories: 120 }) })],
    });
    const { result } = setup(zeroGrams);

    act(() => result.current.setGrams(CHICKEN, 50));

    const item = byId(result.current.items, CHICKEN);
    expect(item.grams).toBe(50);
    expect(Number.isNaN(item.macros.calories)).toBe(false);
    expect(item.macros.calories).toBe(120);
    expect(Number.isNaN(result.current.totals.calories)).toBe(false);
  });

  it('clears macros safely when grams are cleared', () => {
    const { result } = setup();

    act(() => result.current.setGrams(CHICKEN, null));

    const item = byId(result.current.items, CHICKEN);
    expect(item.grams).toBe(0);
    expect(item.macros.calories).toBe(0);
    expect(Number.isNaN(item.macros.protein)).toBe(false);
  });

  it('applies quick portion multipliers relative to the original portion', () => {
    const { result } = setup();

    act(() => result.current.applyMultiplier(CHICKEN, 0.5));

    const half = byId(result.current.items, CHICKEN);
    expect(half.grams).toBe(75);
    expect(half.macros.calories).toBe(124);

    act(() => result.current.applyMultiplier(CHICKEN, 2));

    const double = byId(result.current.items, CHICKEN);
    expect(double.grams).toBe(300);
    expect(double.macros.calories).toBe(496);
  });

  it('rescaleFromBasis passes macros through for a zero basis', () => {
    const macros = makeMacros();
    expect(rescaleFromBasis(macros, 0, 250)).toEqual(macros);
  });

  it('restores the portion after the quantity field is cleared and retyped', () => {
    const { result } = setup();

    // Clearing the numeric field emits null, which the reducer reads as 0.
    act(() => result.current.setQuantity(CHICKEN, null));
    expect(byId(result.current.items, CHICKEN).grams).toBe(0);

    act(() => result.current.setQuantity(CHICKEN, 2));

    const item = byId(result.current.items, CHICKEN);
    expect(item.quantity).toBe(2);
    expect(item.grams).toBe(300);
    expect(item.macros.calories).toBe(496);
  });

  it('keeps the quantity anchored to the hand-typed grams', () => {
    const { result } = setup();

    act(() => result.current.setGrams(CHICKEN, 200));
    act(() => result.current.setQuantity(CHICKEN, null));
    act(() => result.current.setQuantity(CHICKEN, 1));

    // 200 g was 1 serving, so one serving must come back as 200 g.
    expect(byId(result.current.items, CHICKEN).grams).toBe(200);
  });
});

describe('useScanReview - include / exclude', () => {
  it('drops excluded items from the totals', () => {
    const { result } = setup();
    const both = result.current.totals.calories;
    expect(both).toBe(482);

    act(() => result.current.toggleIncluded(RICE));

    expect(result.current.includedCount).toBe(1);
    expect(result.current.totals.calories).toBe(248);
    expect(byId(result.current.items, RICE).included).toBe(false);

    act(() => result.current.toggleIncluded(RICE));
    expect(result.current.totals.calories).toBe(both);
  });

  it('keeps totals equal to the sum of the included items', () => {
    const { result } = setup();

    act(() => result.current.setGrams(RICE, 90));

    const expected = result.current.items
      .filter((i) => i.included)
      .reduce(
        (acc, i) => ({
          calories: acc.calories + i.macros.calories,
          protein: acc.protein + i.macros.protein,
          carbs: acc.carbs + i.macros.carbs,
          fat: acc.fat + i.macros.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );

    expect(result.current.totals.calories).toBeCloseTo(expected.calories, 2);
    expect(result.current.totals.protein).toBeCloseTo(expected.protein, 2);
    expect(result.current.totals.carbs).toBeCloseTo(expected.carbs, 2);
    expect(result.current.totals.fat).toBeCloseTo(expected.fat, 2);
  });

  it('blocks logging when nothing is included', () => {
    const { result } = setup();

    act(() => result.current.toggleIncluded(CHICKEN));
    act(() => result.current.toggleIncluded(RICE));

    expect(result.current.includedCount).toBe(0);
    expect(result.current.canLog).toBe(false);
    expect(result.current.validationError).toMatch(/at least one item/i);
    expect(totalsOf(result.current.items).calories).toBe(0);
  });
});

describe('useScanReview - wasEdited tracking', () => {
  it('marks only the edited item', () => {
    const { result } = setup();

    act(() => result.current.setMacro(CHICKEN, 'protein', 50));

    expect(byId(result.current.items, CHICKEN).wasEdited).toBe(true);
    expect(byId(result.current.items, RICE).wasEdited).toBe(false);
  });

  it('marks an item edited when its name changes and clears it when undone', () => {
    const { result } = setup();
    const originalName = byId(result.current.items, RICE).name;

    act(() => result.current.setName(RICE, 'Brown rice'));
    expect(byId(result.current.items, RICE).wasEdited).toBe(true);

    act(() => result.current.setName(RICE, originalName));
    expect(byId(result.current.items, RICE).wasEdited).toBe(false);
  });

  it('does not treat include / exclude as an edit', () => {
    const { result } = setup();

    act(() => result.current.toggleIncluded(CHICKEN));

    expect(byId(result.current.items, CHICKEN).wasEdited).toBe(false);
  });

  it('rescales from the corrected value after a macro edit', () => {
    const { result } = setup();

    act(() => result.current.setMacro(CHICKEN, 'calories', 300));
    act(() => result.current.setGrams(CHICKEN, 300));

    expect(byId(result.current.items, CHICKEN).macros.calories).toBe(600);
  });
});

describe('useScanReview - adding and deleting', () => {
  it('adds a blank editable item that needs a name', () => {
    const { result } = setup();

    act(() => result.current.addItem());

    expect(result.current.items).toHaveLength(3);
    const added = result.current.items[2];
    expect(added.original).toBeNull();
    expect(added.wasEdited).toBe(true);
    expect(added.included).toBe(true);
    expect(result.current.canLog).toBe(false);
    expect(result.current.validationError).toMatch(/name/i);

    act(() => result.current.setName(added.id, 'Olive oil'));
    expect(result.current.canLog).toBe(true);
  });

  it('deletes an item and updates the totals', () => {
    const { result } = setup();

    act(() => result.current.removeItem(RICE));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.totals.calories).toBe(248);
  });
});

describe('useScanReview - calorie mismatch', () => {
  it('flags a 4/4/9 mismatch and fixes it in one tap', () => {
    const mismatched = makeVisionResult({
      items: [
        makeVisionItem({
          macros: makeMacros({ calories: 900, protein: 10, carbs: 20, fat: 8 }),
        }),
      ],
    });
    const { result } = setup(mismatched);

    const before = calorieCheck(byId(result.current.items, CHICKEN).macros);
    expect(before.expected).toBe(192);
    expect(before.mismatch).toBe(true);

    act(() => result.current.fixCalories(CHICKEN));

    const after = calorieCheck(byId(result.current.items, CHICKEN).macros);
    expect(after.mismatch).toBe(false);
    expect(byId(result.current.items, CHICKEN).macros.calories).toBe(192);
  });

  it('stays quiet for macros that already add up', () => {
    const { result } = setup();
    expect(calorieCheck(byId(result.current.items, CHICKEN).macros).mismatch).toBe(false);
  });
});

describe('drafts and custom foods', () => {
  it('builds one draft per included item with the corrections applied', () => {
    const { result } = setup();

    act(() => result.current.setName(CHICKEN, 'Chicken thigh'));
    act(() => result.current.toggleIncluded(RICE));

    const drafts = buildDrafts(result.current.items, {
      date: '2026-08-19',
      mealType: 'dinner',
      photoUri: 'file:///photo.jpg',
      mode: 'food_photo',
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      date: '2026-08-19',
      mealType: 'dinner',
      name: 'Chicken thigh',
      source: 'vision',
      wasEdited: true,
      photoUri: 'file:///photo.jpg',
      visionConfidence: 0.88,
    });
  });

  it('logs nutrition-label scans with the label source', () => {
    const { result } = setup(makeVisionResult({ mode: 'nutrition_label' }));

    const drafts = buildDrafts(result.current.items, {
      date: '2026-08-19',
      mealType: 'snack',
      photoUri: null,
      mode: 'nutrition_label',
    });

    expect(drafts.map((d) => d.source)).toEqual(['label', 'label']);
    expect(drafts[0].wasEdited).toBe(false);
  });

  it('converts an item back to per-100 g for the food library', () => {
    const { result } = setup();
    const draft = itemToFoodDraft(byId(result.current.items, CHICKEN), 'food_photo');

    expect(draft.servingSizeG).toBe(150);
    expect(draft.per100g.calories).toBe(165);
    expect(draft.per100g.protein).toBeCloseTo(31, 1);
    expect(draft.source).toBe('vision');
  });

  it('perHundredGrams tolerates a zero portion', () => {
    const macros = makeMacros();
    expect(perHundredGrams(macros, 0)).toEqual(macros);
  });
});

describe('parseVisionPayload', () => {
  it('parses the encoded payload produced by the scan screen', () => {
    const parsed = parseVisionPayload(encodePayload(makeVisionResult()));
    expect(parsed?.items).toHaveLength(2);
    expect(parsed?.provider).toBe('mock');
  });

  it('parses a payload the router already decoded', () => {
    const parsed = parseVisionPayload(JSON.stringify(makeVisionResult()));
    expect(parsed?.items).toHaveLength(2);
  });

  it('returns null for malformed input instead of throwing', () => {
    expect(parseVisionPayload('not-json')).toBeNull();
    expect(parseVisionPayload(undefined)).toBeNull();
    expect(parseVisionPayload('')).toBeNull();
    expect(parseVisionPayload('{"provider":"mock"}')).toBeNull();
    expect(parseVisionPayload('%E0%A4%A')).toBeNull();
  });

  it('drops junk items and coerces broken numbers', () => {
    const parsed = parseVisionPayload(
      JSON.stringify({
        mode: 'nutrition_label',
        items: [
          null,
          { name: 'Mystery bar', estimatedGrams: 'oops', macros: { calories: 'x', protein: 3 } },
        ],
      })
    );

    expect(parsed?.mode).toBe('nutrition_label');
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].estimatedGrams).toBe(0);
    expect(parsed?.items[0].macros.calories).toBe(0);
    expect(parsed?.items[0].macros.protein).toBe(3);
  });
});
