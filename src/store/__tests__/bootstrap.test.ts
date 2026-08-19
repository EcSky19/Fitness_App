/**
 * `bootstrap()` integration tests.
 *
 * These run against a REAL in-memory SQLite database (not mocks) because the
 * bug they guard against was exactly a wiring failure: `bootstrap()` used to
 * `await import('@/db/repositories')`, which silently resolves to a rejected
 * promise under jest-expo, so the profile, goal and settings were never loaded.
 */
import { getSettings, saveGoal, saveProfile, saveSettings } from '@/db/repositories';
import { setupTestDb, teardownTestDb } from '@/db/repositories/__tests__/testDb';
import { getDb } from '@/db/client';
import { SEED_FOODS } from '@/data/foods.seed';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';

async function countFoodRows(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM foods;');
  return row?.count ?? 0;
}

/** Lets the fire-and-forget food seeding started by `bootstrap()` finish. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('Timed out waiting for background work');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function resetStore(): void {
  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    isReady: false,
    dataVersion: 0,
  });
}

describe('appStore.bootstrap', () => {
  beforeEach(async () => {
    await setupTestDb();
    resetStore();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('loads the profile, the active goal and the persisted settings from the database', async () => {
    const profile = await saveProfile({
      name: 'Ada',
      heightCm: 165,
      currentWeightKg: 62,
      onboardedAt: '2026-01-01T10:00:00.000Z',
    });
    const goal = await saveGoal({ type: 'cut', rateKgPerWeek: -0.5 });
    await saveSettings({ weightUnit: 'kg', theme: 'dark', addExerciseToTarget: false });

    resetStore();
    await useAppStore.getState().bootstrap();

    const state = useAppStore.getState();
    expect(state.isReady).toBe(true);
    expect(state.profile).toEqual(profile);
    expect(state.goal).toEqual(goal);
    expect(state.settings.weightUnit).toBe('kg');
    expect(state.settings.theme).toBe('dark');
    expect(state.settings.addExerciseToTarget).toBe(false);
    // Unpersisted keys keep their defaults.
    expect(state.settings.energyUnit).toBe(DEFAULT_SETTINGS.energyUnit);
  });

  it('leaves the store empty (but ready) for a brand-new install', async () => {
    await useAppStore.getState().bootstrap();

    const state = useAppStore.getState();
    expect(state.isReady).toBe(true);
    expect(state.profile).toBeNull();
    expect(state.goal).toBeNull();
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('still becomes ready when the repositories throw', async () => {
    jest.doMock('@/db/repositories', () => ({
      getProfile: jest.fn(async () => {
        throw new Error('db exploded');
      }),
      getActiveGoal: jest.fn(async () => {
        throw new Error('db exploded');
      }),
      getSettings: jest.fn(async () => {
        throw new Error('db exploded');
      }),
      saveSettings: jest.fn(async () => {
        throw new Error('db exploded');
      }),
    }));

    let store!: typeof import('@/store/appStore');
    // An isolated registry so the mocked repositories only affect this test —
    // `jest.resetModules()` here would detach the rest of the file from the
    // injected test database.
    jest.isolateModules(() => {
      store = require('@/store/appStore') as typeof import('@/store/appStore');
    });

    await store.useAppStore.getState().bootstrap();

    const state = store.useAppStore.getState();
    expect(state.isReady).toBe(true);
    expect(state.profile).toBeNull();
    expect(state.goal).toBeNull();
    expect(state.settings).toEqual(store.DEFAULT_SETTINGS);

    jest.dontMock('@/db/repositories');
  });

  it('seeds the built-in food catalogue exactly once', async () => {
    await expect(countFoodRows()).resolves.toBe(0);

    await useAppStore.getState().bootstrap();
    await waitFor(async () => (await countFoodRows()) === SEED_FOODS.length);

    const afterFirst = await countFoodRows();
    expect(afterFirst).toBe(SEED_FOODS.length);

    resetStore();
    await useAppStore.getState().bootstrap();
    await flushBackgroundWork();

    await expect(countFoodRows()).resolves.toBe(afterFirst);
  });
  it('survives a React StrictMode double mount (two concurrent bootstraps)', async () => {
    await saveProfile({ name: 'Ada', heightCm: 165 });
    await saveSettings({ theme: 'dark' });
    resetStore();

    // Both effects fire before either finishes — the seeding, the migrations and
    // the settings write all have to tolerate overlapping transactions.
    await Promise.all([
      useAppStore.getState().bootstrap(),
      useAppStore.getState().bootstrap(),
    ]);
    await waitFor(async () => (await countFoodRows()) === SEED_FOODS.length);
    await flushBackgroundWork();

    const state = useAppStore.getState();
    expect(state.isReady).toBe(true);
    expect(state.profile?.name).toBe('Ada');
    expect(state.settings.theme).toBe('dark');
    await expect(countFoodRows()).resolves.toBe(SEED_FOODS.length);
  });
});

describe('appStore.updateSettings', () => {
  beforeEach(async () => {
    await setupTestDb();
    resetStore();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('persists to SQLite and is read back by the next bootstrap', async () => {
    useAppStore.getState().updateSettings({ weightUnit: 'kg', visionProvider: 'openai' });
    await waitFor(async () => (await getSettings()).weightUnit === 'kg');

    await expect(getSettings()).resolves.toMatchObject({
      weightUnit: 'kg',
      visionProvider: 'openai',
    });

    resetStore();
    await useAppStore.getState().bootstrap();

    expect(useAppStore.getState().settings.weightUnit).toBe('kg');
    expect(useAppStore.getState().settings.visionProvider).toBe('openai');
  });

  it('keeps the last patch when two settings updates land back to back', async () => {
    useAppStore.getState().updateSettings({ weightUnit: 'kg' });
    useAppStore.getState().updateSettings({ energyUnit: 'kJ' });

    await waitFor(async () => (await getSettings()).energyUnit === 'kJ');
    // The second write must not be overtaken by the first one's snapshot.
    await expect(getSettings()).resolves.toMatchObject({
      weightUnit: 'kg',
      energyUnit: 'kJ',
    });
  });

  it('bumps dataVersion so open screens refetch', () => {
    const before = useAppStore.getState().dataVersion;
    useAppStore.getState().updateSettings({ healthSyncEnabled: true });
    expect(useAppStore.getState().dataVersion).toBeGreaterThan(before);
  });
});
