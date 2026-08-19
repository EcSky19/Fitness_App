import {
  addFoodEntries,
  addFoodEntry,
  deleteFoodEntry,
  getFoodEntry,
  listEntriesByDate,
  listEntriesByDateRange,
  updateFoodEntry,
  type NewFoodEntry,
} from '@/db/repositories';
import { useAppStore } from '@/store/appStore';
import type { Macros } from '@/types';

import { setupTestDb, teardownTestDb } from './testDb';

function entry(overrides: Partial<NewFoodEntry> = {}): NewFoodEntry {
  const macros: Macros = { calories: 300, protein: 20, carbs: 30, fat: 10 };
  return {
    date: '2026-05-01',
    mealType: 'lunch',
    foodId: null,
    name: 'Chicken bowl',
    brand: null,
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 bowl (200 g)',
    gramsTotal: 200,
    macros,
    photoUri: null,
    source: 'quick_add',
    visionConfidence: null,
    wasEdited: false,
    loggedAt: '2026-05-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('food entries repository', () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('adds, reads and deletes entries', async () => {
    const created = await addFoodEntry(entry());

    expect(created.id).toEqual(expect.any(String));
    expect(created.createdAt).toEqual(expect.any(String));
    expect(created.updatedAt).toBe(created.createdAt);

    const loaded = await getFoodEntry(created.id);
    expect(loaded).toEqual(created);

    await deleteFoodEntry(created.id);
    await expect(getFoodEntry(created.id)).resolves.toBeNull();
    await expect(listEntriesByDate('2026-05-01')).resolves.toEqual([]);
  });

  it('filters by date and by date range', async () => {
    await addFoodEntry(entry({ date: '2026-04-30', loggedAt: '2026-04-30T08:00:00.000Z' }));
    await addFoodEntry(
      entry({ date: '2026-05-01', name: 'Breakfast', loggedAt: '2026-05-01T07:00:00.000Z' })
    );
    await addFoodEntry(
      entry({ date: '2026-05-01', name: 'Dinner', loggedAt: '2026-05-01T19:00:00.000Z' })
    );
    await addFoodEntry(entry({ date: '2026-05-03', loggedAt: '2026-05-03T09:00:00.000Z' }));

    const day = await listEntriesByDate('2026-05-01');
    expect(day.map((e) => e.name)).toEqual(['Breakfast', 'Dinner']);

    const range = await listEntriesByDateRange('2026-04-30', '2026-05-01');
    expect(range).toHaveLength(3);
    expect(range[0].date).toBe('2026-04-30');
    expect(range.at(-1)?.name).toBe('Dinner');

    await expect(listEntriesByDateRange('2026-06-01', '2026-06-30')).resolves.toEqual([]);
  });

  it('inserts many entries in one transaction', async () => {
    const created = await addFoodEntries([
      entry({ name: 'A', mealType: 'breakfast', loggedAt: '2026-05-01T07:00:00.000Z' }),
      entry({ name: 'B', mealType: 'lunch', loggedAt: '2026-05-01T12:00:00.000Z' }),
      entry({ name: 'C', mealType: 'dinner', loggedAt: '2026-05-01T18:00:00.000Z' }),
    ]);

    expect(created.map((e) => e.name)).toEqual(['A', 'B', 'C']);
    expect(new Set(created.map((e) => e.id)).size).toBe(3);

    const stored = await listEntriesByDate('2026-05-01');
    expect(stored.map((e) => e.name)).toEqual(['A', 'B', 'C']);

    await expect(addFoodEntries([])).resolves.toEqual([]);
  });

  it('round-trips optional macros as undefined when absent', async () => {
    const withOptional = await addFoodEntry(
      entry({ macros: { calories: 100, protein: 1, carbs: 2, fat: 3, fiber: 4, sodium: 5 } })
    );
    const withoutOptional = await addFoodEntry(entry({ name: 'Plain' }));

    const loadedA = await getFoodEntry(withOptional.id);
    const loadedB = await getFoodEntry(withoutOptional.id);

    expect(loadedA?.macros).toEqual({
      calories: 100,
      protein: 1,
      carbs: 2,
      fat: 3,
      fiber: 4,
      sodium: 5,
    });
    expect(loadedA?.macros.sugar).toBeUndefined();
    expect(loadedB?.macros).toEqual({ calories: 300, protein: 20, carbs: 30, fat: 10 });
    expect('fiber' in (loadedB?.macros ?? {})).toBe(false);
  });

  it('recomputes macros proportionally when grams change', async () => {
    const created = await addFoodEntry(
      entry({ macros: { calories: 300, protein: 20, carbs: 30, fat: 10, fiber: 6 } })
    );

    const updated = await updateFoodEntry(created.id, { gramsTotal: 100 });

    expect(updated.gramsTotal).toBe(100);
    expect(updated.macros).toEqual({
      calories: 150,
      protein: 10,
      carbs: 15,
      fat: 5,
      fiber: 3,
    });
    expect(updated.wasEdited).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);

    const reloaded = await getFoodEntry(created.id);
    expect(reloaded).toEqual(updated);
  });

  it('scales grams and macros when only the quantity changes', async () => {
    const created = await addFoodEntry(entry({ quantity: 1, gramsTotal: 200 }));

    const updated = await updateFoodEntry(created.id, { quantity: 2.5 });

    expect(updated.quantity).toBe(2.5);
    expect(updated.gramsTotal).toBe(500);
    expect(updated.macros).toEqual({ calories: 750, protein: 50, carbs: 75, fat: 25 });
  });

  it('keeps explicit macros and never divides by zero', async () => {
    const created = await addFoodEntry(entry());
    const explicit = await updateFoodEntry(created.id, {
      gramsTotal: 50,
      macros: { calories: 42, protein: 1, carbs: 2, fat: 3 },
    });
    expect(explicit.macros).toEqual({ calories: 42, protein: 1, carbs: 2, fat: 3 });

    const zero = await addFoodEntry(entry({ gramsTotal: 0, quantity: 0, name: 'Zero' }));
    const rescaled = await updateFoodEntry(zero.id, { gramsTotal: 120 });
    expect(rescaled.gramsTotal).toBe(120);
    expect(rescaled.macros).toEqual(zero.macros);
    expect(Number.isFinite(rescaled.macros.calories)).toBe(true);
  });

  it('patches metadata without touching macros and rejects unknown ids', async () => {
    const created = await addFoodEntry(entry());

    const moved = await updateFoodEntry(created.id, { mealType: 'dinner', date: '2026-05-02' });
    expect(moved.mealType).toBe('dinner');
    expect(moved.date).toBe('2026-05-02');
    expect(moved.macros).toEqual(created.macros);
    expect(moved.gramsTotal).toBe(created.gramsTotal);

    await expect(listEntriesByDate('2026-05-01')).resolves.toEqual([]);
    await expect(updateFoodEntry('missing', { quantity: 2 })).rejects.toThrow(/not found/);
  });

  it('fills in defaults for optional fields', async () => {
    const created = await addFoodEntry({
      date: '2026-05-04',
      mealType: 'snack',
      name: 'Quick add',
      quantity: 1,
      unit: 'g',
      gramsTotal: 55,
      macros: { calories: 90, protein: 2, carbs: 12, fat: 3 },
    });

    expect(created.foodId).toBeNull();
    expect(created.brand).toBeNull();
    expect(created.servingLabel).toBe('55 g');
    expect(created.photoUri).toBeNull();
    expect(created.source).toBe('custom');
    expect(created.visionConfidence).toBeNull();
    expect(created.wasEdited).toBe(false);
    expect(created.loggedAt).toEqual(expect.any(String));

    await expect(getFoodEntry(created.id)).resolves.toEqual(created);
  });

  it('invalidates the app store on every write', async () => {
    const before = useAppStore.getState().dataVersion;
    const created = await addFoodEntry(entry());
    expect(useAppStore.getState().dataVersion).toBe(before + 1);

    await updateFoodEntry(created.id, { quantity: 2 });
    expect(useAppStore.getState().dataVersion).toBe(before + 2);

    await deleteFoodEntry(created.id);
    expect(useAppStore.getState().dataVersion).toBe(before + 3);
  });
});
