/**
 * Global app state (zustand).
 *
 * Usage:
 *   const profile = useAppStore((s) => s.profile);
 *   const invalidate = useAppStore((s) => s.invalidate);
 *
 * `dataVersion` is the app-wide cache key: bump it with `invalidate()` after ANY
 * database write so screens re-query.
 */
import { create } from 'zustand';

import { initDatabase, todayISO } from '@/db/client';
import type { AppSettings, Goal, ISODate, UserProfile } from '@/types';

export const DEFAULT_SETTINGS: AppSettings = {
  weightUnit: 'lb',
  heightUnit: 'ft_in',
  energyUnit: 'kcal',
  visionProvider: process.env.EXPO_PUBLIC_VISION_PROVIDER ?? 'mock',
  healthSyncEnabled: false,
  addExerciseToTarget: true,
  theme: 'system',
};

export interface AppState {
  profile: UserProfile | null;
  goal: Goal | null;
  settings: AppSettings;
  selectedDate: ISODate;
  isReady: boolean;
  /** Incremented after any write; screens depend on it to re-query. */
  dataVersion: number;
  bootstrap: () => Promise<void>;
  setSelectedDate: (d: ISODate) => void;
  setProfile: (p: UserProfile | null) => void;
  setGoal: (g: Goal | null) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  invalidate: () => void; // dataVersion++
}

type UnknownRecord = Record<string, unknown>;

/**
 * `@/db/repositories` is resolved lazily so a failure in the data layer can
 * never stop the app from starting.
 *
 * `require()` — not `await import()`: the dynamic form resolves to a rejected
 * promise under jest-expo and is fragile in Metro, which silently left the
 * profile, goal and settings unloaded on startup.
 *
 * Used:
 *   getProfile()    -> Promise<UserProfile | null>
 *   getActiveGoal() -> Promise<Goal | null>
 *   getSettings()   -> Promise<Partial<AppSettings>>
 *   saveSettings(p) -> Promise<void>
 */
function loadRepositories(): UnknownRecord | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    return require('@/db/repositories') as UnknownRecord;
  } catch {
    return null;
  }
}

interface FoodSearchApi {
  ensureFoodsSeeded?: () => Promise<number>;
}

function loadFoodSearch(): FoodSearchApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    return require('@/services/foodSearch') as FoodSearchApi;
  } catch {
    return null;
  }
}

/**
 * Inserts the built-in food catalogue on first launch so search works
 * everywhere immediately. Idempotent (`ensureFoodsSeeded` no-ops once foods
 * exist), fire-and-forget, and fully guarded: seeding never blocks startup.
 */
function seedFoodsInBackground(): void {
  try {
    const ensure = loadFoodSearch()?.ensureFoodsSeeded;
    if (typeof ensure !== 'function') return;
    void Promise.resolve(ensure()).catch((error: unknown) => {
      console.warn('[appStore] food seeding failed', error);
    });
  } catch (error) {
    console.warn('[appStore] food seeding failed', error);
  }
}

function resolveFn(mod: UnknownRecord, path: string): ((...args: never[]) => unknown) | null {
  const parts = path.split('.');
  let current: unknown = mod;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as UnknownRecord)[part];
  }
  return typeof current === 'function' ? (current as (...args: never[]) => unknown) : null;
}

/** Calls the first resolvable function from `paths`; returns null when none exist or it throws. */
async function tryCall<T>(mod: UnknownRecord, paths: string[], ...args: unknown[]): Promise<T | null> {
  for (const path of paths) {
    const fn = resolveFn(mod, path);
    if (!fn) continue;
    try {
      return (await (fn as (...a: unknown[]) => unknown)(...args)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export const useAppStore = create<AppState>()((set, get) => ({
  profile: null,
  goal: null,
  settings: { ...DEFAULT_SETTINGS },
  selectedDate: todayISO(),
  isReady: false,
  dataVersion: 0,

  bootstrap: async () => {
    let dbReady = true;
    try {
      await initDatabase();
    } catch (error) {
      dbReady = false;
      console.warn('[appStore] initDatabase failed', error);
    }

    if (dbReady) seedFoodsInBackground();

    const repos = loadRepositories();
    if (repos) {
      const profile = await tryCall<UserProfile | null>(repos, ['getProfile']);
      const goal = await tryCall<Goal | null>(repos, ['getActiveGoal']);
      const settings = await tryCall<Partial<AppSettings> | null>(repos, ['getSettings']);

      set((state) => ({
        profile: profile ?? state.profile,
        goal: goal ?? state.goal,
        settings: settings ? { ...state.settings, ...settings } : state.settings,
      }));
    }

    set({ isReady: true });
  },

  setSelectedDate: (d) => set({ selectedDate: d }),

  setProfile: (p) => set((state) => ({ profile: p, dataVersion: state.dataVersion + 1 })),

  setGoal: (g) => set((state) => ({ goal: g, dataVersion: state.dataVersion + 1 })),

  updateSettings: (patch) => {
    set((state) => ({
      settings: { ...state.settings, ...patch },
      dataVersion: state.dataVersion + 1,
    }));
    // Persist to SQLite so the change survives a restart (`bootstrap()` re-reads
    // it). Best effort: a write failure must not break the UI.
    const repos = loadRepositories();
    if (!repos) return;
    void tryCall<void>(repos, ['saveSettings'], get().settings);
  },

  invalidate: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
}));
