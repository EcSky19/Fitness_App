import { getDb } from '@/db/client';
import { getProfile, saveProfile } from '@/db/repositories';

import { setupTestDb, teardownTestDb, useTestAccount } from './testDb';

async function countProfileRows(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM profile;');
  return row?.count ?? 0;
}

describe('profile repository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await useTestAccount('test-account-a');
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('returns null before onboarding', async () => {
    await expect(getProfile()).resolves.toBeNull();
  });

  it('creates the account profile with sane defaults', async () => {
    const saved = await saveProfile({ name: 'Ada', heightCm: 165 });

    expect(saved.id).toBe('test-account-a');
    expect(saved.name).toBe('Ada');
    expect(saved.heightCm).toBe(165);
    expect(saved.sex).toBe('male');
    expect(saved.activityLevel).toBe('moderate');
    expect(saved.goalWeightKg).toBeNull();
    expect(saved.onboardedAt).toBeNull();

    const loaded = await getProfile();
    expect(loaded).toEqual(saved);
  });

  it('is idempotent: repeated upserts patch one row', async () => {
    const first = await saveProfile({ name: 'Ada', currentWeightKg: 62 });
    const second = await saveProfile({ currentWeightKg: 61.5 });
    const third = await saveProfile({ goalWeightKg: 58, onboardedAt: '2026-01-01T10:00:00.000Z' });

    expect(second.name).toBe('Ada');
    expect(second.currentWeightKg).toBe(61.5);
    expect(third.name).toBe('Ada');
    expect(third.currentWeightKg).toBe(61.5);
    expect(third.goalWeightKg).toBe(58);
    expect(third.onboardedAt).toBe('2026-01-01T10:00:00.000Z');
    expect(third.createdAt).toBe(first.createdAt);

    await expect(countProfileRows()).resolves.toBe(1);
  });

  it('round-trips every field including nullable ones', async () => {
    const saved = await saveProfile({
      name: 'Grace',
      sex: 'female',
      birthDate: '1990-05-04',
      heightCm: 172.5,
      currentWeightKg: 68.25,
      goalWeightKg: null,
      activityLevel: 'very_active',
      weightUnit: 'kg',
      heightUnit: 'cm',
      onboardedAt: null,
    });

    const loaded = await getProfile();
    expect(loaded).toEqual(saved);
    expect(loaded?.goalWeightKg).toBeNull();
    expect(loaded?.onboardedAt).toBeNull();
    expect(loaded?.sex).toBe('female');
    expect(loaded?.activityLevel).toBe('very_active');
  });

  it('ignores undefined patch fields', async () => {
    await saveProfile({ name: 'Ada', heightCm: 165 });
    const patched = await saveProfile({ name: undefined, heightCm: undefined, currentWeightKg: 70 });

    expect(patched.name).toBe('Ada');
    expect(patched.heightCm).toBe(165);
    expect(patched.currentWeightKg).toBe(70);
  });
});
