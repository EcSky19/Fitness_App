import { SEED_FOODS } from '@/data/foods.seed';
import {
  QUICK_ADD_UNITS,
  buildQuickAddFood,
  cupGramsFor,
  ensureFoodsSeeded,
  gramsFor,
  scaleFoodToEntry,
  searchAllFoods,
  searchSeedFoods,
  seedFoodToFood,
  suggestUnitsForFood,
  unitLabel,
} from '@/services/foodSearch';
import type { Food, Macros, ServingUnit } from '@/types';

jest.mock('@/db/repositories', () => ({
  searchFoods: jest.fn(),
  countFoods: jest.fn(),
  seedFoods: jest.fn(),
}));

import * as repositoriesModule from '@/db/repositories';

const repo = repositoriesModule as unknown as {
  searchFoods: jest.Mock;
  countFoods: jest.Mock;
  seedFoods: jest.Mock;
};

function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id: 'test-food',
    name: 'Test food',
    brand: null,
    per100g: { calories: 200, protein: 10, carbs: 20, fat: 8, fiber: 2, sugar: 4, sodium: 100 },
    servingSizeG: 120,
    servingLabel: '1 serving (120 g)',
    barcode: null,
    source: 'custom',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seedByName(name: string): Food {
  const seed = SEED_FOODS.find((f) => f.name === name);
  if (!seed) throw new Error(`Seed food not found: ${name}`);
  return seedFoodToFood(seed);
}

function indexOfName(results: { name: string }[], name: string): number {
  return results.findIndex((f) => f.name === name);
}

beforeEach(() => {
  repo.searchFoods.mockReset();
  repo.countFoods.mockReset();
  repo.seedFoods.mockReset();
});

describe('gramsFor', () => {
  const food = makeFood();

  it('treats g and ml as grams one-to-one', () => {
    expect(gramsFor(food, 150, 'g')).toBe(150);
    expect(gramsFor(food, 250, 'ml')).toBe(250);
  });

  it('converts oz using 28.3495 g', () => {
    expect(gramsFor(food, 1, 'oz')).toBeCloseTo(28.35, 2);
    expect(gramsFor(food, 4, 'oz')).toBeCloseTo(113.4, 2);
  });

  it('multiplies servings and pieces by servingSizeG', () => {
    expect(gramsFor(food, 2, 'serving')).toBe(240);
    expect(gramsFor(food, 3, 'piece')).toBe(360);
    expect(gramsFor(food, 0.5, 'serving')).toBe(60);
  });

  it('falls back to 100 g when servingSizeG is missing or zero', () => {
    const broken = makeFood({ servingSizeG: 0 });
    expect(gramsFor(broken, 2, 'serving')).toBe(200);
    expect(gramsFor(broken, 1, 'piece')).toBe(100);
  });

  it('uses a 240 g water cup for foods with no known density', () => {
    expect(gramsFor(food, 1, 'cup')).toBe(240);
    expect(gramsFor(food, 0.5, 'cup')).toBe(120);
  });

  it('derives tbsp as cup/16 and tsp as cup/48', () => {
    expect(gramsFor(food, 1, 'tbsp')).toBe(15);
    expect(gramsFor(food, 1, 'tsp')).toBe(5);
    expect(gramsFor(food, 3, 'tsp')).toBe(15);
  });

  it('uses a per-category cup density for known seed foods', () => {
    const almonds = seedByName('Almonds');
    const milk = seedByName('Milk, 2%');
    const spinach = SEED_FOODS.find((f) => f.category === 'vegetable');
    expect(spinach).toBeDefined();

    expect(cupGramsFor(almonds)).toBe(139);
    expect(gramsFor(almonds, 1, 'cup')).toBe(139);
    expect(gramsFor(almonds, 1, 'tbsp')).toBeCloseTo(8.69, 2);

    expect(cupGramsFor(milk)).toBe(245);
    expect(cupGramsFor(seedFoodToFood(spinach!))).toBe(96);
  });

  it('returns 0 for zero or non-finite quantities', () => {
    expect(gramsFor(food, 0, 'g')).toBe(0);
    expect(gramsFor(food, Number.NaN, 'cup')).toBe(0);
    expect(gramsFor(food, Number.POSITIVE_INFINITY, 'serving')).toBe(0);
  });

  it('covers every ServingUnit in QUICK_ADD_UNITS', () => {
    const units: ServingUnit[] = ['g', 'ml', 'oz', 'serving', 'piece', 'cup', 'tbsp', 'tsp'];
    for (const unit of units) {
      const grams = gramsFor(food, 1, unit);
      expect(Number.isFinite(grams)).toBe(true);
      expect(grams).toBeGreaterThan(0);
    }
    expect([...QUICK_ADD_UNITS].sort()).toEqual([...units].sort());
  });
});

describe('scaleFoodToEntry', () => {
  const chicken = seedByName('Chicken breast, cooked');

  it('scales macros proportionally to grams', () => {
    const half = scaleFoodToEntry(chicken, 50, 'g');
    const double = scaleFoodToEntry(chicken, 200, 'g');

    expect(half.gramsTotal).toBe(50);
    expect(half.macros.calories).toBeCloseTo(chicken.per100g.calories / 2, 0);
    expect(half.macros.protein).toBeCloseTo(chicken.per100g.protein / 2, 0);

    expect(double.gramsTotal).toBe(200);
    expect(double.macros.calories).toBeCloseTo(330, 0);
    expect(double.macros.protein).toBeCloseTo(62, 0);
    expect(double.macros.fat).toBeCloseTo(7.2, 0);
  });

  it('rounds macros to at most two decimals and stays proportional', () => {
    const { gramsTotal, macros } = scaleFoodToEntry(chicken, 37, 'g');
    const isRounded = (value: number): boolean =>
      Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

    expect(gramsTotal).toBe(37);
    expect(isRounded(macros.calories)).toBe(true);
    expect(isRounded(macros.protein)).toBe(true);
    expect(isRounded(macros.carbs)).toBe(true);
    expect(isRounded(macros.fat)).toBe(true);
    expect(macros.calories).toBeCloseTo((chicken.per100g.calories * 37) / 100, 2);
    expect(macros.protein).toBeCloseTo((chicken.per100g.protein * 37) / 100, 2);
  });

  it('produces a plain gram label for weight units', () => {
    expect(scaleFoodToEntry(chicken, 200, 'g').servingLabel).toBe('200 g');
    expect(scaleFoodToEntry(chicken, 150, 'ml').servingLabel).toBe('150 ml');
  });

  it('produces a household label with a gram figure for portion units', () => {
    const food = makeFood();
    expect(scaleFoodToEntry(food, 1.5, 'serving').servingLabel).toBe('1.5 servings (180 g)');
    expect(scaleFoodToEntry(food, 1, 'serving').servingLabel).toBe('1 serving (120 g)');
    expect(scaleFoodToEntry(food, 2, 'cup').servingLabel).toBe('2 cups (480 g)');
    expect(scaleFoodToEntry(food, 3, 'piece').servingLabel).toBe('3 pieces (360 g)');
  });

  it('keeps optional macro fields when present and omits them otherwise', () => {
    const withExtras = scaleFoodToEntry(makeFood(), 200, 'g');
    expect(withExtras.macros.fiber).toBeCloseTo(4, 5);
    expect(withExtras.macros.sodium).toBeCloseTo(200, 5);

    const bare = makeFood({ per100g: { calories: 100, protein: 5, carbs: 10, fat: 4 } });
    const scaled = scaleFoodToEntry(bare, 50, 'g');
    expect(scaled.macros.fiber).toBeUndefined();
    expect(scaled.macros.sugar).toBeUndefined();
    expect(scaled.macros.sodium).toBeUndefined();
  });

  it('returns zeroed macros for a zero quantity', () => {
    const { gramsTotal, macros } = scaleFoodToEntry(chicken, 0, 'g');
    expect(gramsTotal).toBe(0);
    expect(macros.calories).toBe(0);
    expect(macros.protein).toBe(0);
  });
});

describe('unitLabel', () => {
  it('pluralises countable units only when quantity is not 1', () => {
    expect(unitLabel('serving')).toBe('serving');
    expect(unitLabel('serving', 1)).toBe('serving');
    expect(unitLabel('serving', 2)).toBe('servings');
    expect(unitLabel('cup', 1)).toBe('cup');
    expect(unitLabel('cup', 0.5)).toBe('cups');
    expect(unitLabel('piece', 3)).toBe('pieces');
  });

  it('leaves abbreviations unchanged', () => {
    expect(unitLabel('g', 5)).toBe('g');
    expect(unitLabel('ml', 5)).toBe('ml');
    expect(unitLabel('oz', 5)).toBe('oz');
    expect(unitLabel('tbsp', 5)).toBe('tbsp');
    expect(unitLabel('tsp', 5)).toBe('tsp');
  });
});

describe('suggestUnitsForFood', () => {
  it('offers volume units first for drinks', () => {
    expect(suggestUnitsForFood(seedByName('Milk, 2%'))[0]).toBe('ml');
    expect(suggestUnitsForFood(seedByName('Cola'))[0]).toBe('ml');
  });

  it('offers spoons first for oils and condiments', () => {
    expect(suggestUnitsForFood(seedByName('Olive oil'))[0]).toBe('tbsp');
    expect(suggestUnitsForFood(seedByName('Honey'))[0]).toBe('tbsp');
  });

  it('offers pieces first for countable foods', () => {
    expect(suggestUnitsForFood(seedByName('Egg, whole, raw'))[0]).toBe('piece');
    expect(suggestUnitsForFood(seedByName('Chicken breast, cooked'))[0]).toBe('piece');
  });

  it('defaults to grams for everything else', () => {
    expect(suggestUnitsForFood(makeFood())[0]).toBe('g');
    expect(suggestUnitsForFood(seedByName('Brown rice, cooked'))[0]).toBe('g');
  });

  it('always returns valid, unique units', () => {
    for (const food of [makeFood(), seedByName('Olive oil'), seedByName('Cola')]) {
      const units = suggestUnitsForFood(food);
      expect(units.length).toBeGreaterThan(0);
      expect(new Set(units).size).toBe(units.length);
      for (const unit of units) expect(QUICK_ADD_UNITS).toContain(unit);
    }
  });
});

describe('searchSeedFoods ranking', () => {
  it('ranks an exact name above a prefix match', () => {
    const results = searchSeedFoods('banana');
    expect(results[0].name).toBe('Banana');
    expect(indexOfName(results, 'Banana')).toBeLessThan(indexOfName(results, 'Banana bread'));
  });

  it('ranks exact above prefix above word-boundary matches', () => {
    const results = searchSeedFoods('butter');
    const exact = indexOfName(results, 'Butter');
    const prefix = indexOfName(results, 'Butter, salted');
    const word = indexOfName(results, 'Peanut butter');

    expect(exact).toBe(0);
    expect(prefix).toBeGreaterThan(exact);
    expect(word).toBeGreaterThan(prefix);
  });

  it('ranks an exact alias above an unrelated prefix match', () => {
    const results = searchSeedFoods('chocolate');
    expect(results[0].name).toBe('Milk chocolate');
    expect(indexOfName(results, 'Chocolate chip cookie')).toBeGreaterThan(0);
  });

  it('ranks a word-boundary match above a mid-word substring match', () => {
    const results = searchSeedFoods('melon');
    expect(indexOfName(results, 'Honeydew melon')).toBeGreaterThanOrEqual(0);
    expect(indexOfName(results, 'Watermelon')).toBeGreaterThan(indexOfName(results, 'Honeydew melon'));
  });

  it('matches aliases', () => {
    expect(searchSeedFoods('aubergine')[0].name).toBe('Eggplant, cooked');
    expect(searchSeedFoods('evoo')[0].name).toBe('Olive oil');
  });

  it('is case, accent and whitespace insensitive', () => {
    expect(searchSeedFoods('BANANA')[0].name).toBe('Banana');
    expect(searchSeedFoods('  bAnAnA  ')[0].name).toBe('Banana');
    expect(searchSeedFoods('bánana')[0].name).toBe('Banana');
  });

  it('tolerates typos in queries of four characters or more', () => {
    expect(searchSeedFoods('chiken')[0].name).toBe('Chicken breast, cooked');
    expect(searchSeedFoods('brocoli')[0].name.toLowerCase()).toContain('broccoli');
    expect(searchSeedFoods('avacado')[0].name.toLowerCase()).toContain('avocado');
  });

  it('finds multi-word queries in any order', () => {
    const results = searchSeedFoods('breast chicken');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name.toLowerCase()).toContain('chicken');
  });

  it('returns a popular subset, not the whole database, for an empty query', () => {
    const results = searchSeedFoods('');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(SEED_FOODS.length);
    expect(results.map((f) => f.name)).toContain('Chicken breast, cooked');
    expect(searchSeedFoods('   ').length).toBe(results.length);
  });

  it('respects the limit and defaults to 50', () => {
    expect(searchSeedFoods('a', 5).length).toBeLessThanOrEqual(5);
    expect(searchSeedFoods('e').length).toBeLessThanOrEqual(50);
    expect(searchSeedFoods('', 3).length).toBe(3);
  });

  it('returns nothing for a query that matches no food', () => {
    expect(searchSeedFoods('zzzqqxwv')).toEqual([]);
  });

  it('breaks ties deterministically and is stable across calls', () => {
    expect(searchSeedFoods('chicken').map((f) => f.name)).toEqual(
      searchSeedFoods('chicken').map((f) => f.name),
    );
  });
});

describe('searchAllFoods', () => {
  it('puts repository results first and tops up from the seed database', async () => {
    const saved = makeFood({ id: 'db-1', name: 'My meal prep chicken' });
    repo.searchFoods.mockResolvedValue([saved]);

    const results = await searchAllFoods('chicken', 6);

    expect(repo.searchFoods).toHaveBeenCalledWith('chicken', 6);
    expect(results[0].id).toBe('db-1');
    expect(results.length).toBe(6);
    expect(results.slice(1).every((f) => f.id.startsWith('seed:'))).toBe(true);
  });

  it('de-duplicates by lowercase name and brand', async () => {
    repo.searchFoods.mockResolvedValue([makeFood({ id: 'db-2', name: 'banana', brand: null })]);

    const results = await searchAllFoods('banana', 10);

    expect(results.filter((f) => f.name.toLowerCase() === 'banana')).toHaveLength(1);
    expect(results.some((f) => f.id === 'seed:banana')).toBe(false);
    expect(results[0].id).toBe('db-2');
  });

  it('still returns seed results when the repository throws', async () => {
    repo.searchFoods.mockRejectedValue(new Error('database not open'));

    const results = await searchAllFoods('chicken', 5);

    expect(results.length).toBe(5);
    expect(results.every((f) => f.id.startsWith('seed:'))).toBe(true);
    expect(results[0].source).toBe('seed');
  });

  it('survives a repository that returns a non-array', async () => {
    repo.searchFoods.mockResolvedValue(undefined as unknown as Food[]);
    const results = await searchAllFoods('banana', 4);
    expect(results.length).toBeGreaterThan(0);
  });

  it('never exceeds the requested limit', async () => {
    repo.searchFoods.mockResolvedValue([
      makeFood({ id: 'db-3', name: 'Chicken A' }),
      makeFood({ id: 'db-4', name: 'Chicken B' }),
    ]);
    const results = await searchAllFoods('chicken', 3);
    expect(results).toHaveLength(3);
  });

  it('exposes seed foods as fully-formed Food objects', async () => {
    repo.searchFoods.mockResolvedValue([]);
    const [first] = await searchAllFoods('olive oil', 3);

    expect(first.id).toBe('seed:olive-oil');
    expect(first.name).toBe('Olive oil');
    expect(first.source).toBe('seed');
    expect(first.isFavorite).toBe(false);
    expect(first.usageCount).toBe(0);
    expect(first.per100g.fat).toBe(100);
    expect(first.servingSizeG).toBeGreaterThan(0);
  });
});

describe('ensureFoodsSeeded', () => {
  it('seeds the whole database when the table is empty', async () => {
    repo.countFoods.mockResolvedValue(0);
    repo.seedFoods.mockResolvedValue(SEED_FOODS.length);

    const inserted = await ensureFoodsSeeded();

    expect(inserted).toBe(SEED_FOODS.length);
    expect(repo.seedFoods).toHaveBeenCalledTimes(1);
    const inputs = repo.seedFoods.mock.calls[0][0] as { name: string; per100g: Macros }[];
    expect(inputs).toHaveLength(SEED_FOODS.length);
    expect(inputs[0].name).toBe(SEED_FOODS[0].name);
    expect(inputs[0].per100g).toEqual(SEED_FOODS[0].per100g);
  });

  it('does nothing when foods already exist', async () => {
    repo.countFoods.mockResolvedValue(12);

    expect(await ensureFoodsSeeded()).toBe(0);
    expect(repo.seedFoods).not.toHaveBeenCalled();
  });

  it('falls back to the input length when the repository returns no count', async () => {
    repo.countFoods.mockResolvedValue(0);
    repo.seedFoods.mockResolvedValue(undefined);

    expect(await ensureFoodsSeeded()).toBe(SEED_FOODS.length);
  });

  it('returns 0 and never throws when counting fails', async () => {
    repo.countFoods.mockRejectedValue(new Error('no such table: foods'));

    await expect(ensureFoodsSeeded()).resolves.toBe(0);
    expect(repo.seedFoods).not.toHaveBeenCalled();
  });

  it('returns 0 and never throws when seeding fails', async () => {
    repo.countFoods.mockResolvedValue(0);
    repo.seedFoods.mockRejectedValue(new Error('disk full'));

    await expect(ensureFoodsSeeded()).resolves.toBe(0);
  });
});

describe('buildQuickAddFood', () => {
  it('treats the entered macros as one 100 g serving', () => {
    const food = buildQuickAddFood('  Office donut  ', {
      calories: 250,
      protein: 4,
      carbs: 30,
      fat: 12,
    });

    expect(food.name).toBe('Office donut');
    expect(food.per100g).toEqual({ calories: 250, protein: 4, carbs: 30, fat: 12 });
    expect(food.servingSizeG).toBe(100);
    expect(food.servingLabel).toBe('1 serving (100 g)');
    expect(food.source).toBe('quick_add');
    expect(food.brand).toBeNull();
  });

  it('clamps negatives, keeps optional fields and names untitled entries', () => {
    const food = buildQuickAddFood('', {
      calories: -10,
      protein: 2.55,
      carbs: 0,
      fat: 0,
      fiber: 3,
      sodium: 120.4,
    });

    expect(food.name).toBe('Quick add');
    expect(food.per100g.calories).toBe(0);
    expect(food.per100g.protein).toBeCloseTo(2.6, 5);
    expect(food.per100g.fiber).toBe(3);
    expect(food.per100g.sodium).toBe(120);
    expect(food.per100g.sugar).toBeUndefined();
  });

  it('round-trips through scaleFoodToEntry', () => {
    const input = buildQuickAddFood('Snack', { calories: 300, protein: 20, carbs: 30, fat: 10 });
    const food = makeFood({ ...input, id: 'quick-1' });

    const { gramsTotal, macros } = scaleFoodToEntry(food, 1, 'serving');
    expect(gramsTotal).toBe(100);
    expect(macros.calories).toBe(300);
    expect(macros.protein).toBeCloseTo(20, 5);
  });
});
