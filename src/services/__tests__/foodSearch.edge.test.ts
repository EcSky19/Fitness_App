/**
 * Regression tests for food search edge cases and interactive latency.
 *
 * The happy-path suite lives in `foodSearch.test.ts`.
 */
import { SEED_FOODS } from '@/data/foods.seed';
import {
  ensureFoodsSeeded,
  gramsFor,
  searchAllFoods,
  searchSeedFoods,
  seedFoodToFood,
} from '@/services/foodSearch';
import type { Food } from '@/types';

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
    per100g: { calories: 200, protein: 10, carbs: 20, fat: 8 },
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

beforeEach(() => {
  repo.searchFoods.mockReset();
  repo.countFoods.mockReset();
  repo.seedFoods.mockReset();
});

describe('gramsFor with hostile quantities', () => {
  const food = makeFood();

  it('never returns negative grams', () => {
    for (const unit of ['g', 'ml', 'oz', 'serving', 'piece', 'cup', 'tbsp', 'tsp'] as const) {
      expect(gramsFor(food, -2, unit)).toBe(0);
    }
  });

  it('still returns 0 for zero and non-finite quantities', () => {
    expect(gramsFor(food, 0, 'serving')).toBe(0);
    expect(gramsFor(food, Number.NaN, 'g')).toBe(0);
    expect(gramsFor(food, Number.POSITIVE_INFINITY, 'cup')).toBe(0);
    expect(gramsFor(food, Number.NEGATIVE_INFINITY, 'cup')).toBe(0);
  });

  it('falls back to 100 g for a zero or negative serving size', () => {
    expect(gramsFor(makeFood({ servingSizeG: 0 }), 2, 'serving')).toBe(200);
    expect(gramsFor(makeFood({ servingSizeG: -50 }), 1, 'piece')).toBe(100);
    expect(gramsFor(makeFood({ servingSizeG: Number.NaN }), 1, 'serving')).toBe(100);
  });
});

describe('searchSeedFoods latency', () => {
  function perCall(query: string, runs: number): number {
    searchSeedFoods(query, 50); // warm up so first-call JIT cost is not measured
    const started = Date.now();
    for (let i = 0; i < runs; i += 1) searchSeedFoods(query, 50);
    return (Date.now() - started) / runs;
  }

  /**
   * Search runs on the JS thread for every debounced keystroke, so a typo
   * query (the slowest path, since every food that fails the cheap string
   * rules falls through to Levenshtein) has to stay near a frame budget.
   *
   * The ratio assertion is what really guards the fast path: it is immune to
   * how loaded the machine is, and the pre-optimisation implementation cost
   * ~80x a short non-fuzzy query.
   */
  it('answers a typo query over the whole catalogue quickly', () => {
    const fuzzy = perCall('chiken', 40);
    const nonFuzzy = perCall('str', 40); // below MIN_FUZZY_QUERY_LENGTH

    expect(fuzzy).toBeLessThan(15);
    expect(fuzzy).toBeLessThan(Math.max(nonFuzzy, 0.05) * 25);
  });

  it('answers a whole typed word, character by character, quickly', () => {
    const word = 'strawberries';
    searchSeedFoods(word, 50);

    const started = Date.now();
    for (let i = 1; i <= word.length; i += 1) searchSeedFoods(word.slice(0, i), 50);
    const perKeystroke = (Date.now() - started) / word.length;

    expect(perKeystroke).toBeLessThan(15);
  });

  it('still finds foods through typos after the fast path', () => {
    expect(searchSeedFoods('chiken', 10).some((f) => /chicken/i.test(f.name))).toBe(true);
    expect(searchSeedFoods('brocoli', 10).some((f) => /broccoli/i.test(f.name))).toBe(true);
    expect(searchSeedFoods('yoghurt', 10).length).toBeGreaterThan(0);
  });

  it('ranks typo matches identically to the exhaustive comparison', () => {
    // Golden rankings captured from the exhaustive (unpruned) implementation.
    // The length/row-bound pruning only discards pairs that provably score
    // below MIN_FUZZY_SIMILARITY, so ordering must be byte-for-byte unchanged.
    const golden: Record<string, string[]> = {
      chiken: [
        'Chicken breast, cooked',
        'Chicken burrito',
        'Chicken nuggets',
        'Chicken sausage',
        'Chicken breast, raw',
        'Chicken noodle soup',
      ],
      brocoli: ['Broccoli, raw', 'Broccoli, cooked'],
      avacado: ['Avocado', 'Avocado oil'],
      bananna: ['Banana', 'Banana bread'],
      spinnach: ['Spinach, raw', 'Spinach, cooked'],
      oatmeel: ['Oats, rolled, dry', 'Oatmeal, cooked with water'],
      strawbery: ['Strawberry jam', 'Strawberries'],
    };

    for (const [query, expected] of Object.entries(golden)) {
      expect({ query, names: searchSeedFoods(query, 6).map((f) => f.name) }).toEqual({
        query,
        names: expected,
      });
    }
  });
});

describe('searchAllFoods merge', () => {
  it('de-duplicates a database food against the same seed food, ignoring case and accents', async () => {
    repo.searchFoods.mockResolvedValue([
      makeFood({ id: 'db-1', name: 'BANANA', brand: null }),
      makeFood({ id: 'db-2', name: 'Crème brûlée' }),
      makeFood({ id: 'db-3', name: 'Creme brulee' }),
    ]);

    const results = await searchAllFoods('banana', 20);
    const keys = results.map(
      (f) =>
        `${f.name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()}|${(f.brand ?? '').toLowerCase()}`
    );

    expect(new Set(keys).size).toBe(keys.length);
    expect(results.some((f) => f.id === 'db-1')).toBe(true);
    expect(results.some((f) => f.id === 'seed:banana')).toBe(false);
    expect(results.filter((f) => /^cr[eè]me br[uû]l[eé]e$/i.test(f.name))).toHaveLength(1);
  });

  it('fills the limit from the seed catalogue after de-duplication', async () => {
    // Every repository row duplicates a seed food, so the merged list must
    // still be topped up to the limit instead of coming back short.
    const duplicates = SEED_FOODS.slice(0, 5).map((seed, index) =>
      makeFood({ id: `db-${index}`, name: seed.name.toUpperCase(), brand: seed.brand })
    );
    repo.searchFoods.mockResolvedValue(duplicates);

    const results = await searchAllFoods('', 10);

    expect(results).toHaveLength(10);
    const keys = results.map((f) => `${f.name.toLowerCase()}|${f.brand ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never exceeds the limit even when the repository over-delivers', async () => {
    repo.searchFoods.mockResolvedValue(
      SEED_FOODS.slice(0, 40).map((seed, i) => makeFood({ id: `db-${i}`, name: `Custom ${seed.name}` }))
    );

    expect(await searchAllFoods('a', 5)).toHaveLength(5);
  });
});

describe('ensureFoodsSeeded', () => {
  it('imports the catalogue when the table holds unrelated foods but no seeds', async () => {
    // A quick-add logged before the catalogue was ever imported must not block
    // it forever.
    repo.countFoods.mockResolvedValue(1);
    repo.searchFoods.mockResolvedValue([]);
    repo.seedFoods.mockResolvedValue(SEED_FOODS.length);

    expect(await ensureFoodsSeeded()).toBe(SEED_FOODS.length);
    expect(repo.seedFoods).toHaveBeenCalledTimes(1);
  });

  it('stays a no-op once the catalogue is present', async () => {
    repo.countFoods.mockResolvedValue(400);
    repo.searchFoods.mockImplementation(async (query: string) => [
      seedFoodToFood(SEED_FOODS.find((f) => f.name === query) ?? SEED_FOODS[0]),
    ]);

    expect(await ensureFoodsSeeded()).toBe(0);
    expect(repo.seedFoods).not.toHaveBeenCalled();
  });

  it('is still a no-op when the table is empty of everything', async () => {
    repo.countFoods.mockResolvedValue(0);
    repo.seedFoods.mockResolvedValue(SEED_FOODS.length);

    expect(await ensureFoodsSeeded()).toBe(SEED_FOODS.length);
    expect(repo.searchFoods).not.toHaveBeenCalled();
  });

  it('never throws when the probe fails', async () => {
    repo.countFoods.mockResolvedValue(3);
    repo.searchFoods.mockRejectedValue(new Error('db closed'));

    await expect(ensureFoodsSeeded()).resolves.toBe(0);
    expect(repo.seedFoods).not.toHaveBeenCalled();
  });
});
