const mockFileDelete = jest.fn();
const mockFileCopy = jest.fn();

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file:///');
      if (!this.uri.endsWith('/')) this.uri += '/';
    }

    create(): void {}
  }

  class MockFile {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file:///');
    }

    copy(destination: { uri: string }): void {
      mockFileCopy(this.uri, destination.uri);
    }

    delete(): void {
      mockFileDelete(this.uri);
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { document: new MockDirectory('file:///document') },
  };
});

import { getDb } from '@/db/client';
import { claimLegacyData } from '@/db/repositories/accounts';
import {
  addExerciseEntry,
  addFoodEntry,
  createRecipeFromEntries,
  addWeightLog,
  clearAllData,
  deleteRecipe,
  deleteExerciseEntry,
  deleteFood,
  deleteFoodEntry,
  deleteWeightLog,
  exportAllData,
  getActiveGoal,
  getDbStats,
  getExerciseEntry,
  getFood,
  getFoodEntry,
  getLatestWeight,
  getProfile,
  getRecipe,
  getSettings,
  getWeightLog,
  listEntriesByDate,
  listExercisesByDate,
  listGoals,
  listRecipes,
  listWeightLogs,
  saveGoal,
  saveProfile,
  saveRecipe,
  saveSettings,
  searchFoods,
  searchRecipes,
  seedFoods,
  toggleFavoriteFood,
  toggleFavoriteRecipe,
  updateExerciseEntry,
  updateFoodEntry,
  updateWeightLog,
  upsertFood,
} from '@/db/repositories';
import { setCurrentSession } from '@/services/auth/currentAccount';

import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

const A = 'account-a';
const B = 'account-b';

const macros = { calories: 100, protein: 10, carbs: 10, fat: 2 };

describe('repository account scoping', () => {
  beforeEach(async () => {
    mockFileDelete.mockClear();
    mockFileCopy.mockClear();
    await setupTestDb();
    await useTestAccount(A);
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('isolates profile, settings, goals, foods, entries, exercise and weight by current account', async () => {
    const profileA = await saveProfile({ name: 'Alice', currentWeightKg: 61 });
    await saveSettings({ weightUnit: 'kg', theme: 'dark' });
    const goalA = await saveGoal({ type: 'cut', rateKgPerWeek: -0.25 });
    const foodA = await upsertFood({ name: 'Private oats', barcode: 'abc', per100g: macros });
    const entryA = await addFoodEntry({
      date: '2026-08-19',
      mealType: 'breakfast',
      foodId: foodA.id,
      name: 'Private oats',
      quantity: 1,
      unit: 'serving',
      gramsTotal: 50,
      macros,
    });

    const exerciseA = await addExerciseEntry({
      date: '2026-08-19',
      name: 'Private run',
      category: 'cardio',
      durationMin: 30,
      caloriesBurned: 250,
    });
    const weightA = await addWeightLog({ date: '2026-08-19', weightKg: 61 });

    await useTestAccount(B);

    await expect(getProfile()).resolves.toBeNull();
    await expect(getSettings()).resolves.toEqual({});
    await expect(getActiveGoal()).resolves.toBeNull();
    await expect(listGoals()).resolves.toEqual([]);
    await expect(getFood(foodA.id)).resolves.toBeNull();
    await expect(searchFoods('Private')).resolves.toEqual([]);
    await expect(getFoodEntry(entryA.id)).resolves.toBeNull();
    await expect(listEntriesByDate('2026-08-19')).resolves.toEqual([]);
    await expect(getExerciseEntry(exerciseA.id)).resolves.toBeNull();
    await expect(listExercisesByDate('2026-08-19')).resolves.toEqual([]);
    await expect(getWeightLog(weightA.id)).resolves.toBeNull();
    await expect(getLatestWeight()).resolves.toBeNull();
    await expect(listWeightLogs()).resolves.toEqual([]);

    await expect(saveGoal({ id: goalA.id, type: 'bulk' })).rejects.toThrow(/saveGoal/);
    await expect(upsertFood({ id: foodA.id, name: 'Stolen oats', per100g: macros })).rejects.toThrow(
      /upsertFood/
    );
    await expect(updateFoodEntry(entryA.id, { name: 'Stolen entry' })).rejects.toThrow(
      /not found/
    );
    await expect(updateExerciseEntry(exerciseA.id, { name: 'Stolen exercise' })).rejects.toThrow(
      /not found/
    );
    await expect(updateWeightLog(weightA.id, { weightKg: 99 })).rejects.toThrow(/not found/);
    await expect(toggleFavoriteFood(foodA.id)).rejects.toThrow(/not found/);

    await deleteFoodEntry(entryA.id);
    await deleteExerciseEntry(exerciseA.id);
    await deleteWeightLog(weightA.id);
    await deleteFood(foodA.id);

    await useTestAccount(A);
    await expect(getProfile()).resolves.toMatchObject({ id: profileA.id, name: 'Alice' });
    await expect(getSettings()).resolves.toMatchObject({ weightUnit: 'kg', theme: 'dark' });
    await expect(getActiveGoal()).resolves.toMatchObject({ id: goalA.id, type: 'cut' });
    await expect(getFood(foodA.id)).resolves.toMatchObject({ id: foodA.id, name: 'Private oats' });
    await expect(getFoodEntry(entryA.id)).resolves.toMatchObject({ id: entryA.id });
    await expect(getExerciseEntry(exerciseA.id)).resolves.toMatchObject({ id: exerciseA.id });
    await expect(getWeightLog(weightA.id)).resolves.toMatchObject({ id: weightA.id, weightKg: 61 });
  });

  it('isolates recipes and recipe items across read, update and delete paths', async () => {
      const recipeA = await saveRecipe({
        name: 'Private recipe',
        kind: 'recipe',
        servings: 2,
        items: [
          {
            foodId: null,
            name: 'Secret ingredient',
            quantity: 1,
            unit: 'serving',
            gramsTotal: 100,
            macros,
            sortOrder: 0,
          },
        ],
      });

      await useTestAccount(B);

      await expect(getRecipe(recipeA.id)).resolves.toBeNull();
      await expect(listRecipes()).resolves.toEqual([]);
      await expect(searchRecipes('Private')).resolves.toEqual([]);
      await expect(toggleFavoriteRecipe(recipeA.id)).rejects.toThrow(/not found/);
      await expect(
        saveRecipe({
          id: recipeA.id,
          name: 'Stolen recipe',
          items: [
            {
              foodId: null,
              name: 'Stolen ingredient',
              quantity: 1,
              unit: 'serving',
              gramsTotal: 50,
              macros,
              sortOrder: 0,
            },
          ],
        })
      ).rejects.toThrow(/saveRecipe/);
      await deleteRecipe(recipeA.id);

      const entryB = await addFoodEntry({
        date: '2026-08-19',
        mealType: 'lunch',
        name: 'B entry',
        quantity: 1,
        unit: 'serving',
        gramsTotal: 100,
        macros,
      });
      const fromB = await createRecipeFromEntries({
        name: 'B recipe',
        entryIds: [entryB.id, recipeA.id],
      });
      expect(fromB.items).toHaveLength(1);
      expect(fromB.items[0].name).toBe('B entry');

      await useTestAccount(A);
      await expect(getRecipe(recipeA.id)).resolves.toMatchObject({
        id: recipeA.id,
        name: 'Private recipe',
        items: [{ name: 'Secret ingredient' }],
      });
  });

  it('keeps same-date weight replacement scoped to the current account', async () => {
    const weightA = await addWeightLog({ date: '2026-08-19', weightKg: 61 });
    await useTestAccount(B);
    await addWeightLog({ date: '2026-08-19', weightKg: 80 });
    await addWeightLog({ date: '2026-08-19', weightKg: 81 });

    await useTestAccount(A);
    await expect(getWeightLog(weightA.id)).resolves.toMatchObject({ weightKg: 61 });
    await expect(listWeightLogs()).resolves.toHaveLength(1);

    await useTestAccount(B);
    await expect(listWeightLogs()).resolves.toMatchObject([{ weightKg: 81 }]);
  });

  it('scopes admin export, stats and clear without deleting another account', async () => {
    await saveProfile({ name: 'Alice' });
    await saveGoal({ type: 'cut' });
    await upsertFood({ name: 'A food', per100g: macros });
    await addFoodEntry({
      date: '2026-08-19',
      mealType: 'lunch',
      name: 'A entry',
      quantity: 1,
      unit: 'serving',
      gramsTotal: 100,
      macros,
    });

    await addExerciseEntry({
      date: '2026-08-19',
      name: 'A exercise',
      category: 'cardio',
      durationMin: 1,
      caloriesBurned: 1,
    });
    await addWeightLog({ date: '2026-08-19', weightKg: 61 });

    await useTestAccount(B);
    await saveProfile({ name: 'Bob' });
    await upsertFood({ name: 'B food', per100g: macros });
    const dump = await exportAllData();
    expect(dump.profile).toMatchObject({ name: 'Bob' });
    expect(dump.foods).toMatchObject([{ name: 'B food' }]);
    await expect(getDbStats()).resolves.toMatchObject({ foods: 1, foodEntries: 0 });

    await clearAllData();
    await expect(getProfile()).resolves.toBeNull();
    await expect(searchFoods('B food')).resolves.toEqual([]);

    await useTestAccount(A);
    await expect(getProfile()).resolves.toMatchObject({ name: 'Alice' });
    await expect(searchFoods('A food')).resolves.toHaveLength(1);
    await expect(getDbStats()).resolves.toMatchObject({ foods: 1, foodEntries: 1 });
  });

  it('deletes food photo files on entry delete and scoped clearAllData', async () => {
    const entry = await addFoodEntry({
      date: '2026-08-19',
      mealType: 'dinner',
      name: 'Photo meal',
      quantity: 1,
      unit: 'serving',
      gramsTotal: 100,
      macros,
      photoUri: 'file:///camera/meal.jpg',
    });

    expect(entry.photoUri).toContain('/food-entry-photos/account-a/');
    expect(mockFileCopy).toHaveBeenCalledWith('file:///camera/meal.jpg', entry.photoUri);

    mockFileDelete.mockClear();
    await deleteFoodEntry(entry.id);
    expect(mockFileDelete).toHaveBeenCalledWith(entry.photoUri);

    const clearEntry = await addFoodEntry({
      date: '2026-08-20',
      mealType: 'dinner',
      name: 'Photo meal 2',
      quantity: 1,
      unit: 'serving',
      gramsTotal: 100,
      macros,
      photoUri: 'file:///camera/meal-2.jpg',
    });

    mockFileDelete.mockClear();
    await clearAllData();
    expect(mockFileDelete).toHaveBeenCalledWith(clearEntry.photoUri);
  });

  it('returns empty signed-out results while still exposing shared seed foods', async () => {
    await saveProfile({ name: 'Alice' });
    await seedFoods([{ name: 'Seed apple', barcode: 'seed-1', source: 'seed', per100g: macros }]);

    setCurrentSession(null);

    await expect(getProfile()).resolves.toBeNull();
    await expect(getSettings()).resolves.toEqual({});
    await expect(listGoals()).resolves.toEqual([]);
    await expect(listEntriesByDate('2026-08-19')).resolves.toEqual([]);
    await expect(listExercisesByDate('2026-08-19')).resolves.toEqual([]);
    await expect(listWeightLogs()).resolves.toEqual([]);
    await expect(searchFoods('Seed apple')).resolves.toMatchObject([{ name: 'Seed apple' }]);
  });

  it('claims legacy unscoped rows for the first account only', async () => {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO profile (
        id, name, sex, birth_date, height_cm, current_weight_kg, activity_level,
        weight_unit, height_unit, created_at, updated_at, account_id
      ) VALUES ('me', 'Legacy', 'female', '1990-01-01', 165, 60, 'moderate', 'kg', 'cm', ?, ?, '');`,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    );
    await db.runAsync(
      `INSERT INTO weight_logs (id, date, weight_kg, source, created_at, updated_at, account_id)
       VALUES ('legacy-weight', '2026-08-18', 60, 'manual', ?, ?, NULL);`,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    );
    await db.runAsync(`INSERT INTO settings (account_id, key, value) VALUES ('', 'theme', '"light"');`);

    await claimLegacyData(A);
    await expect(getProfile()).resolves.toMatchObject({ name: 'Legacy' });
    await expect(getSettings()).resolves.toEqual({ theme: 'light' });
    await expect(listWeightLogs()).resolves.toMatchObject([{ id: 'legacy-weight' }]);

    await useTestAccount(B);
    await expect(getProfile()).resolves.toBeNull();
    await expect(getSettings()).resolves.toEqual({});
    await expect(listWeightLogs()).resolves.toEqual([]);
  });
});
