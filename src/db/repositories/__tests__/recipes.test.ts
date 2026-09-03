import {
  addFoodEntry,
  createRecipeFromEntries,
  deleteRecipe,
  duplicateRecipe,
  getRecipe,
  listEntriesByDate,
  listRecipes,
  logRecipe,
  repeatEntries,
  saveRecipe,
  searchRecipes,
  toggleFavoriteRecipe,
  upsertFood,
  type NewFoodEntry,
} from '@/db/repositories';
import type { Macros, RecipeItem } from '@/types';

import { setupTestDb, teardownTestDb } from './testDb';

const macros: Macros = { calories: 200, protein: 10, carbs: 25, fat: 6, fiber: 4 };

function entry(overrides: Partial<NewFoodEntry> = {}): NewFoodEntry {
  return {
    date: '2026-08-19',
    mealType: 'lunch',
    foodId: null,
    name: 'Chicken bowl',
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 bowl',
    gramsTotal: 250,
    macros,
    source: 'custom',
    ...overrides,
  };
}

function recipeItem(overrides: Partial<Omit<RecipeItem, 'id' | 'recipeId'>> = {}): Omit<RecipeItem, 'id' | 'recipeId'> {
  return {
    foodId: null,
    name: 'Oats',
    quantity: 2,
    unit: 'serving',
    gramsTotal: 100,
    macros,
    sortOrder: 0,
    ...overrides,
  };
}

describe('recipes repository', () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('creates, lists, searches, updates and deletes recipes', async () => {
    const created = await saveRecipe({
      name: 'Breakfast oats',
      kind: 'recipe',
      servings: 2,
      defaultMealType: 'breakfast',
      notes: 'prep ahead',
      items: [recipeItem(), recipeItem({ name: 'Milk', gramsTotal: 200, sortOrder: 1 })],
    });

    expect(created.totals).toEqual({ calories: 400, protein: 20, carbs: 50, fat: 12, fiber: 8 });
    expect(created.totalGrams).toBe(300);
    expect(await getRecipe(created.id)).toEqual(created);
    expect(await listRecipes({ kind: 'recipe' })).toHaveLength(1);
    expect(await searchRecipes('oat_')).toEqual([]);
    expect(await searchRecipes('oats')).toHaveLength(1);

    const favorited = await toggleFavoriteRecipe(created.id);
    expect(favorited.isFavorite).toBe(true);

    const updated = await saveRecipe({
      id: created.id,
      name: 'Updated oats',
      kind: 'meal',
      servings: 1,
      items: [recipeItem({ name: 'Banana', gramsTotal: 50, macros: { calories: 80, protein: 1, carbs: 20, fat: 0 } })],
    });
    expect(updated.items).toHaveLength(1);
    expect(updated.totals).toEqual({ calories: 80, protein: 1, carbs: 20, fat: 0 });
    expect(updated.isFavorite).toBe(true);

    await deleteRecipe(created.id);
    await expect(getRecipe(created.id)).resolves.toBeNull();
    await expect(listRecipes()).resolves.toEqual([]);
  });

  it('logs recipe servings as scaled real food entries and bumps usage', async () => {
    const recipe = await saveRecipe({
      name: 'Two serving recipe',
      kind: 'recipe',
      servings: 2,
      items: [recipeItem()],
    });

    const logged = await logRecipe({
      recipeId: recipe.id,
      date: '2026-08-20',
      mealType: 'dinner',
      servings: 1,
    });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      date: '2026-08-20',
      mealType: 'dinner',
      name: 'Oats',
      quantity: 1,
      gramsTotal: 50,
      macros: { calories: 100, protein: 5, carbs: 12.5, fat: 3, fiber: 2 },
    });
    await expect(listEntriesByDate('2026-08-20')).resolves.toHaveLength(1);
    await expect(getRecipe(recipe.id)).resolves.toMatchObject({
      timesLogged: 1,
      lastLoggedAt: expect.any(String),
    });
  });

  it('creates recipes from existing entries and repeats entries to a target day', async () => {
    const breakfast = await addFoodEntry(entry({ mealType: 'breakfast', name: 'Eggs' }));
    const lunch = await addFoodEntry(entry({ mealType: 'lunch', name: 'Rice', gramsTotal: 300 }));

    const recipe = await createRecipeFromEntries({
      name: 'Logged meal',
      kind: 'meal',
      entryIds: [breakfast.id, lunch.id],
    });
    expect(recipe.items.map((item) => item.name)).toEqual(['Eggs', 'Rice']);
    expect(recipe.totalGrams).toBe(550);

    const repeated = await repeatEntries({
      entryIds: [breakfast.id, lunch.id],
      date: '2026-08-21',
      mealType: 'dinner',
    });
    expect(repeated.map((item) => item.mealType)).toEqual(['dinner', 'dinner']);
    expect(repeated.map((item) => item.name)).toEqual(['Eggs', 'Rice']);
    await expect(listEntriesByDate('2026-08-21')).resolves.toHaveLength(2);
  });

  /**
   * `recipe_items.food_id` is `ON DELETE SET NULL`, so any write to `foods` that
   * deletes-then-reinserts a row (the old `INSERT OR REPLACE` behaviour) would
   * silently unlink every ingredient pointing at that food — the recipe would
   * survive but stop tracking the food it was built from. Editing a food is a
   * routine action, so this must stay a real UPDATE.
   */
  it('keeps recipe ingredients linked to a food after that food is edited', async () => {
    const food = await upsertFood({ name: 'Oats', per100g: macros });
    const recipe = await saveRecipe({
      name: 'Overnight oats',
      kind: 'recipe',
      servings: 2,
      items: [recipeItem({ foodId: food.id, name: 'Oats' })],
    });
    expect(recipe.items[0].foodId).toBe(food.id);

    const edited = await upsertFood({
      id: food.id,
      name: 'Oats (rolled)',
      per100g: { ...macros, calories: 260 },
    });
    expect(edited.id).toBe(food.id);

    const reloaded = await getRecipe(recipe.id);
    expect(reloaded?.items).toHaveLength(1);
    expect(reloaded?.items[0].foodId).toBe(food.id);
  });

  it('duplicates a recipe as a fresh, unfavorited, unlogged copy with no photo', async () => {
    const original = await saveRecipe({
      name: 'Overnight oats',
      kind: 'recipe',
      servings: 2,
      defaultMealType: 'breakfast',
      notes: 'prep ahead',
      items: [recipeItem(), recipeItem({ name: 'Milk', gramsTotal: 200, sortOrder: 1 })],
    });
    await toggleFavoriteRecipe(original.id);
    await logRecipe({
      recipeId: original.id,
      date: '2026-08-20',
      mealType: 'breakfast',
      servings: 1,
    });

    const copy = await duplicateRecipe(original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Overnight oats (copy)');
    expect(copy.kind).toBe(original.kind);
    expect(copy.servings).toBe(original.servings);
    expect(copy.defaultMealType).toBe(original.defaultMealType);
    expect(copy.notes).toBe(original.notes);
    expect(copy.totals).toEqual(original.totals);
    expect(copy.items.map((item) => item.name)).toEqual(original.items.map((item) => item.name));
    expect(copy.isFavorite).toBe(false);
    expect(copy.timesLogged).toBe(0);
    expect(copy.lastLoggedAt).toBeNull();
    expect(copy.photoUri).toBeNull();

    // The original is untouched by duplicating it.
    const reloadedOriginal = await getRecipe(original.id);
    expect(reloadedOriginal?.isFavorite).toBe(true);
    expect(reloadedOriginal?.timesLogged).toBe(1);

    await expect(listRecipes()).resolves.toHaveLength(2);
  });

  it('rejects duplicating a recipe that does not exist', async () => {
    await expect(duplicateRecipe('missing-id')).rejects.toThrow(
      'duplicateRecipe: recipe not found (missing-id)'
    );
  });
});
