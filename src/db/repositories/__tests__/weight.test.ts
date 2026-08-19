import {
  addWeightLog,
  deleteWeightLog,
  getLatestWeight,
  getWeightLogByDate,
  listWeightLogs,
  listWeightLogsByRange,
  updateWeightLog,
  type NewWeightLog,
} from '@/db/repositories';

import { setupTestDb, teardownTestDb } from './testDb';

function log(overrides: Partial<NewWeightLog> = {}): NewWeightLog {
  return {
    date: '2026-05-01',
    weightKg: 80,
    bodyFatPct: null,
    note: null,
    source: 'manual',
    ...overrides,
  };
}

describe('weight repository', () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('returns null when empty', async () => {
    await expect(getLatestWeight()).resolves.toBeNull();
    await expect(getWeightLogByDate('2026-05-01')).resolves.toBeNull();
    await expect(listWeightLogs()).resolves.toEqual([]);
  });

  it('replaces an existing log for the same date instead of duplicating', async () => {
    const first = await addWeightLog(log({ weightKg: 80.4, note: 'morning' }));
    const second = await addWeightLog(log({ weightKg: 79.9, bodyFatPct: 18.5 }));

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.weightKg).toBe(79.9);
    expect(second.bodyFatPct).toBe(18.5);
    expect(second.note).toBeNull();

    const all = await listWeightLogs();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(second);
  });

  it('lists newest first and ranges oldest first', async () => {
    await addWeightLog(log({ date: '2026-05-01', weightKg: 80 }));
    await addWeightLog(log({ date: '2026-05-08', weightKg: 79.4 }));
    await addWeightLog(log({ date: '2026-05-15', weightKg: 79 }));
    await addWeightLog(log({ date: '2026-06-01', weightKg: 78.2 }));

    const newestFirst = await listWeightLogs();
    expect(newestFirst.map((l) => l.date)).toEqual([
      '2026-06-01',
      '2026-05-15',
      '2026-05-08',
      '2026-05-01',
    ]);

    const limited = await listWeightLogs(2);
    expect(limited.map((l) => l.date)).toEqual(['2026-06-01', '2026-05-15']);

    const chart = await listWeightLogsByRange('2026-05-01', '2026-05-15');
    expect(chart.map((l) => l.date)).toEqual(['2026-05-01', '2026-05-08', '2026-05-15']);

    const latest = await getLatestWeight();
    expect(latest?.date).toBe('2026-06-01');
    expect(latest?.weightKg).toBe(78.2);

    const byDate = await getWeightLogByDate('2026-05-08');
    expect(byDate?.weightKg).toBe(79.4);
  });

  it('updates and deletes logs', async () => {
    const created = await addWeightLog(log({ bodyFatPct: 20 }));

    const updated = await updateWeightLog(created.id, { weightKg: 81.2, note: 'after lunch' });
    expect(updated.weightKg).toBe(81.2);
    expect(updated.note).toBe('after lunch');
    expect(updated.bodyFatPct).toBe(20);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe('');

    await expect(updateWeightLog('missing', { weightKg: 1 })).rejects.toThrow(/not found/);

    await deleteWeightLog(created.id);
    await expect(listWeightLogs()).resolves.toEqual([]);
  });

  it('fills in defaults for optional fields', async () => {
    const created = await addWeightLog({ date: '2026-07-01', weightKg: 77.7 });

    expect(created.bodyFatPct).toBeNull();
    expect(created.note).toBeNull();
    expect(created.source).toBe('manual');

    await expect(getWeightLogByDate('2026-07-01')).resolves.toEqual(created);
  });
});
