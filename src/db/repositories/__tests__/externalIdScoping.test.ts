/**
 * Regression tests: health-platform `external_id` deduplication must be scoped
 * PER ACCOUNT. Two accounts on the same device sync from the same HealthKit /
 * Health Connect source and therefore see the SAME workout uuids. Account B
 * syncing a workout account A already has must not collide, and account A
 * importing a backup must not be blocked by account B's identical externalId.
 */
import { getDb } from '@/db/client';
import {
  addExerciseEntry,
  listExercisesByDate,
  upsertExternalExercise,
  type NewExerciseEntry,
} from '@/db/repositories';

import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

const A = 'account-a';
const B = 'account-b';

function workout(overrides: Partial<NewExerciseEntry> = {}): NewExerciseEntry {
  return {
    date: '2026-05-01',
    name: 'Morning run',
    category: 'cardio',
    durationMin: 30,
    caloriesBurned: 320,
    source: 'healthkit',
    externalId: 'hk-shared-1',
    notes: null,
    loggedAt: '2026-05-01T07:30:00.000Z',
    ...overrides,
  };
}

describe('external_id account scoping', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount(A);
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('lets two accounts each hold a workout with the same externalId', async () => {
    const a = await upsertExternalExercise(workout({ caloriesBurned: 300 }));

    await useTestAccount(B);
    // Before the fix this throws "UNIQUE constraint failed" because the
    // external_id unique index is global instead of per-account.
    const b = await upsertExternalExercise(workout({ caloriesBurned: 500 }));

    expect(b.id).not.toBe(a.id);
    await expect(listExercisesByDate('2026-05-01')).resolves.toMatchObject([
      { caloriesBurned: 500 },
    ]);

    await useTestAccount(A);
    await expect(listExercisesByDate('2026-05-01')).resolves.toMatchObject([
      { caloriesBurned: 300 },
    ]);
  });

  it('re-syncing the same workout still updates in place within one account', async () => {
    await useTestAccount(B);
    const first = await upsertExternalExercise(workout({ caloriesBurned: 400 }));
    const second = await upsertExternalExercise(
      workout({ caloriesBurned: 450, name: 'Morning run (updated)' })
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    const stored = await listExercisesByDate('2026-05-01');
    expect(stored).toHaveLength(1);
    expect(stored[0].caloriesBurned).toBe(450);
  });

  it('scopes the raw external_id unique index by account', async () => {
    const db = await getDb();
    // Both accounts must exist for the account_id foreign key to hold.
    await useTestAccount(B);
    await useTestAccount(A);
    await db.runAsync(
      `INSERT INTO exercise_entries
         (id, date, name, category, duration_min, calories_burned, source,
          external_id, logged_at, created_at, updated_at, account_id)
       VALUES ('a-row', '2026-05-01', 'Run', 'cardio', 30, 300, 'healthkit',
          'raw-1', ?, ?, ?, ?);`,
      '2026-05-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
      A
    );

    // A second account holding the same external_id must be allowed by the DB.
    await expect(
      db.runAsync(
        `INSERT INTO exercise_entries
           (id, date, name, category, duration_min, calories_burned, source,
            external_id, logged_at, created_at, updated_at, account_id)
         VALUES ('b-row', '2026-05-01', 'Run', 'cardio', 30, 300, 'healthkit',
            'raw-1', ?, ?, ?, ?);`,
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z',
        B
      )
    ).resolves.toBeDefined();

    // But the same account must still be blocked from duplicating it.
    await expect(
      db.runAsync(
        `INSERT INTO exercise_entries
           (id, date, name, category, duration_min, calories_burned, source,
            external_id, logged_at, created_at, updated_at, account_id)
         VALUES ('a-dup', '2026-05-01', 'Run', 'cardio', 30, 300, 'healthkit',
            'raw-1', ?, ?, ?, ?);`,
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z',
        A
      )
    ).rejects.toThrow(/UNIQUE/i);
  });
});
