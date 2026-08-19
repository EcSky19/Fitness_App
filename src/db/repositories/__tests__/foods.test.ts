import { getDb } from '@/db/client';
import {
  addFoodEntry,
  bumpFoodUsage,
  countFoods,
  deleteFood,
  getFood,
  getFoodByBarcode,
  listFavoriteFoods,
  listRecentFoods,
  searchFoods,
  seedFoods,
  toggleFavoriteFood,
  upsertFood,
  type FoodInput,
} from '@/db/repositories';
import type { Macros } from '@/types';

import { setupTestDb, teardownTestDb } from './testDb';

const MACROS: Macros = { calories: 100, protein: 5, carbs: 10, fat: 3 };

function food(name: string, extra: Partial<FoodInput> = {}): FoodInput {
  return { name, per100g: MACROS, ...extra };
}

describe('foods repository', () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('upserts, reads and counts foods', async () => {
    const created = await upsertFood(
      food('Greek yogurt', {
        brand: 'Fage',
        per100g: { calories: 97, protein: 10, carbs: 4, fat: 5, fiber: 0, sugar: 4, sodium: 35 },
        servingSizeG: 170,
        servingLabel: '1 tub (170 g)',
        barcode: '5201054000121',
      })
    );

    expect(created.id).toEqual(expect.any(String));
    expect(created.source).toBe('custom');
    expect(created.usageCount).toBe(0);
    expect(created.lastUsedAt).toBeNull();

    const loaded = await getFood(created.id);
    expect(loaded).toEqual(created);
    expect(loaded?.per100g.sodium).toBe(35);

    await expect(getFoodByBarcode('5201054000121')).resolves.toEqual(created);
    await expect(getFoodByBarcode('does-not-exist')).resolves.toBeNull();
    await expect(getFood('nope')).resolves.toBeNull();
    await expect(countFoods()).resolves.toBe(1);
  });

  it('updates an existing food matched by barcode', async () => {
    const first = await upsertFood(food('Cola', { barcode: '111', brand: 'Generic' }));
    const second = await upsertFood(
      food('Cola Zero', { barcode: '111', per100g: { calories: 0, protein: 0, carbs: 0, fat: 0 } })
    );

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Cola Zero');
    expect(second.brand).toBe('Generic');
    expect(second.createdAt).toBe(first.createdAt);
    await expect(countFoods()).resolves.toBe(1);
  });

  it('ranks search results exact > prefix > substring > brand', async () => {
    await upsertFood(food('Chocolate milkshake'));
    await upsertFood(food('Oat drink', { brand: 'Milkman' }));
    await upsertFood(food('Milk chocolate'));
    await upsertFood(food('Milk'));

    const results = await searchFoods('milk');
    expect(results.map((f) => f.name)).toEqual([
      'Milk',
      'Milk chocolate',
      'Chocolate milkshake',
      'Oat drink',
    ]);
  });

  it('is case insensitive and tie-breaks by usage, favourite then name', async () => {
    await upsertFood(food('Chicken thigh', { usageCount: 2 }));
    await upsertFood(food('Chicken breast', { usageCount: 9 }));
    await upsertFood(food('Chickpeas', { usageCount: 2, isFavorite: true }));
    await upsertFood(food('Chicken wings', { usageCount: 0 }));

    const results = await searchFoods('CHICK');
    expect(results.map((f) => f.name)).toEqual([
      'Chicken breast',
      'Chickpeas',
      'Chicken thigh',
      'Chicken wings',
    ]);
  });

  it('escapes % and _ in the LIKE pattern', async () => {
    await upsertFood(food('Juice 100% orange'));
    await upsertFood(food('Juice 1000 ml'));
    await upsertFood(food('Protein_bar'));
    await upsertFood(food('Protein bar'));

    const percent = await searchFoods('100%');
    expect(percent.map((f) => f.name)).toEqual(['Juice 100% orange']);

    const underscore = await searchFoods('protein_');
    expect(underscore.map((f) => f.name)).toEqual(['Protein_bar']);

    const backslash = await searchFoods('\\');
    expect(backslash).toEqual([]);
  });

  it('honours the limit and returns favourites + recents for an empty query', async () => {
    await upsertFood(food('Apple', { lastUsedAt: '2026-01-01T10:00:00.000Z' }));
    await upsertFood(food('Banana', { lastUsedAt: '2026-02-01T10:00:00.000Z' }));
    await upsertFood(food('Cheese', { isFavorite: true }));
    await upsertFood(food('Dates'));

    const empty = await searchFoods('   ');
    expect(empty.map((f) => f.name)).toEqual(['Cheese', 'Banana', 'Apple', 'Dates']);

    const limited = await searchFoods('', 2);
    expect(limited.map((f) => f.name)).toEqual(['Cheese', 'Banana']);
  });

  it('tracks favourites and usage', async () => {
    const apple = await upsertFood(food('Apple'));

    await expect(toggleFavoriteFood(apple.id)).resolves.toBe(true);
    await expect(listFavoriteFoods()).resolves.toHaveLength(1);
    await expect(toggleFavoriteFood(apple.id)).resolves.toBe(false);
    await expect(listFavoriteFoods()).resolves.toEqual([]);
    await expect(toggleFavoriteFood('missing')).rejects.toThrow(/not found/);

    await expect(listRecentFoods()).resolves.toEqual([]);
    await bumpFoodUsage(apple.id);
    await bumpFoodUsage(apple.id);

    const recents = await listRecentFoods();
    expect(recents).toHaveLength(1);
    expect(recents[0].usageCount).toBe(2);
    expect(recents[0].lastUsedAt).toEqual(expect.any(String));

    await expect(bumpFoodUsage('missing')).resolves.toBeUndefined();
  });

  it('seeds foods once, in a single transaction', async () => {
    const batch: FoodInput[] = [food('Rice'), food('Beans'), food('Tofu')];
    await expect(seedFoods(batch)).resolves.toBe(3);
    await expect(countFoods()).resolves.toBe(3);

    await expect(seedFoods([food('rice'), food('Lentils'), food('Beans')])).resolves.toBe(1);
    await expect(countFoods()).resolves.toBe(4);

    await expect(seedFoods([])).resolves.toBe(0);

    const rice = (await searchFoods('rice'))[0];
    expect(rice.source).toBe('seed');
  });

  it('nulls food_id on entries when a food is deleted', async () => {
    const apple = await upsertFood(food('Apple'));
    const entry = await addFoodEntry({
      date: '2026-05-01',
      mealType: 'snack',
      foodId: apple.id,
      name: 'Apple',
      brand: null,
      quantity: 1,
      unit: 'serving',
      servingLabel: '1 apple',
      gramsTotal: 150,
      macros: { calories: 78, protein: 0.4, carbs: 21, fat: 0.2 },
      photoUri: null,
      source: 'custom',
      visionConfidence: null,
      wasEdited: false,
      loggedAt: '2026-05-01T09:00:00.000Z',
    });

    await deleteFood(apple.id);

    await expect(getFood(apple.id)).resolves.toBeNull();
    const db = await getDb();
    const row = await db.getFirstAsync<{ food_id: string | null }>(
      'SELECT food_id FROM food_entries WHERE id = ?;',
      entry.id
    );
    expect(row?.food_id).toBeNull();
  });
});
