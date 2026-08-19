import {
  addExerciseEntry,
  deleteExerciseEntry,
  getExerciseEntry,
  listExercisesByDate,
  listExercisesByDateRange,
  updateExerciseEntry,
  upsertExternalExercise,
  type NewExerciseEntry,
} from '@/db/repositories';

import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

function workout(overrides: Partial<NewExerciseEntry> = {}): NewExerciseEntry {
  return {
    date: '2026-05-01',
    name: 'Morning run',
    category: 'cardio',
    durationMin: 30,
    caloriesBurned: 320,
    source: 'manual',
    externalId: null,
    notes: null,
    loggedAt: '2026-05-01T07:30:00.000Z',
    ...overrides,
  };
}

describe('exercise repository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('adds, updates and deletes entries', async () => {
    const created = await addExerciseEntry(workout());
    expect(created.id).toEqual(expect.any(String));

    const loaded = await getExerciseEntry(created.id);
    expect(loaded).toEqual(created);

    const updated = await updateExerciseEntry(created.id, {
      durationMin: 45,
      caloriesBurned: 480,
      notes: 'Felt great',
    });
    expect(updated.durationMin).toBe(45);
    expect(updated.caloriesBurned).toBe(480);
    expect(updated.notes).toBe('Felt great');
    expect(updated.name).toBe('Morning run');
    expect(updated.createdAt).toBe(created.createdAt);

    await expect(updateExerciseEntry('missing', { durationMin: 1 })).rejects.toThrow(/not found/);

    await deleteExerciseEntry(created.id);
    await expect(getExerciseEntry(created.id)).resolves.toBeNull();
  });

  it('filters by date and range', async () => {
    await addExerciseEntry(workout({ date: '2026-04-29', name: 'Swim' }));
    await addExerciseEntry(
      workout({ date: '2026-05-01', name: 'Lift', loggedAt: '2026-05-01T06:00:00.000Z' })
    );
    await addExerciseEntry(
      workout({ date: '2026-05-01', name: 'Yoga', loggedAt: '2026-05-01T20:00:00.000Z' })
    );

    const day = await listExercisesByDate('2026-05-01');
    expect(day.map((e) => e.name)).toEqual(['Lift', 'Yoga']);

    const range = await listExercisesByDateRange('2026-04-29', '2026-05-01');
    expect(range.map((e) => e.name)).toEqual(['Swim', 'Lift', 'Yoga']);

    await expect(listExercisesByDate('2026-05-02')).resolves.toEqual([]);
  });

  it('deduplicates external workouts on externalId', async () => {
    const first = await upsertExternalExercise(
      workout({
        source: 'healthkit',
        externalId: 'hk-123',
        caloriesBurned: 300,
        durationMin: 30,
      })
    );

    const second = await upsertExternalExercise(
      workout({
        source: 'healthkit',
        externalId: 'hk-123',
        caloriesBurned: 355,
        durationMin: 34,
        name: 'Morning run (updated)',
      })
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.caloriesBurned).toBe(355);
    expect(second.name).toBe('Morning run (updated)');

    const stored = await listExercisesByDate('2026-05-01');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(second);
  });

  it('never merges entries without an externalId', async () => {
    await upsertExternalExercise(workout({ externalId: null, name: 'Walk A' }));
    await upsertExternalExercise(workout({ externalId: '   ', name: 'Walk B' }));

    const stored = await listExercisesByDate('2026-05-01');
    expect(stored).toHaveLength(2);
    expect(stored.map((e) => e.externalId)).toEqual([null, null]);
  });

  it('fills in defaults for optional fields', async () => {
    const created = await addExerciseEntry({
      date: '2026-05-02',
      name: 'Bike',
      category: 'cardio',
      durationMin: 20,
      caloriesBurned: 150,
    });

    expect(created.source).toBe('manual');
    expect(created.externalId).toBeNull();
    expect(created.notes).toBeNull();
    expect(created.loggedAt).toEqual(expect.any(String));

    await expect(getExerciseEntry(created.id)).resolves.toEqual(created);
  });
});
