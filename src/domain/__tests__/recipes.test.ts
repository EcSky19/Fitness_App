import { perServing, recipeTotals, scaleRecipeItems } from '@/domain';
import type { RecipeItem } from '@/types';

const item: RecipeItem = {
  id: 'item-1',
  recipeId: 'recipe-1',
  foodId: null,
  name: 'Oats',
  quantity: 2,
  unit: 'serving',
  gramsTotal: 100,
  macros: { calories: 200, protein: 10, carbs: 30, fat: 4, fiber: 5 },
  sortOrder: 0,
};

describe('recipe domain math', () => {
  it('totals grams and macros while ignoring unusable numbers', () => {
    expect(recipeTotals([item, { macros: { calories: NaN, protein: 1, carbs: 2, fat: 3 }, gramsTotal: Infinity }])).toEqual({
      macros: { calories: 200, protein: 11, carbs: 32, fat: 7, fiber: 5 },
      grams: 100,
    });
  });

  it('computes per-serving values and guards bad serving counts', () => {
    expect(perServing(item.macros, item.gramsTotal, 2)).toEqual({
      macros: { calories: 100, protein: 5, carbs: 15, fat: 2, fiber: 2.5 },
      grams: 50,
    });
    expect(perServing(item.macros, item.gramsTotal, 0)).toEqual({
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      grams: 0,
    });
    expect(perServing(item.macros, item.gramsTotal, -1)).toEqual({
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      grams: 0,
    });
    expect(perServing(item.macros, item.gramsTotal, NaN)).toEqual({
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      grams: 0,
    });
  });

  it('scales recipe items with finite non-negative factors only', () => {
    expect(scaleRecipeItems([item], 1.5)[0]).toMatchObject({
      quantity: 3,
      gramsTotal: 150,
      macros: { calories: 300, protein: 15, carbs: 45, fat: 6, fiber: 7.5 },
    });
    expect(scaleRecipeItems([item], NaN)[0]).toMatchObject({
      quantity: 0,
      gramsTotal: 0,
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
    });
  });
});
