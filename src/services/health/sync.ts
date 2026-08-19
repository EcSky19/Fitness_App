/**
 * Pulls health data into the app database.
 *
 * Everything here is defensive: a missing repository, a store failure or a
 * platform error is converted into `Result.error`, never thrown. Imports are
 * idempotent — each entry carries a stable `externalId`, so re-syncing a day
 * updates the existing rows instead of duplicating them, and the synthesized
 * "Daily activity" row is removed again as soon as the day has a real workout.
 */
import { Platform } from 'react-native';

import type { NewExerciseEntry } from '@/db/repositories';
import type {
  EntrySource,
  ExerciseCategory,
  HealthDaySummary,
  HealthPermissionStatus,
  HealthService,
  ISODate,
  ISODateTime,
  Result,
} from '@/types';

import {
  type HealthDaySyncResult,
  type HealthRangeSyncResult,
  MAX_SYNC_DAYS,
  emptyDaySummary,
  enumerateDates,
  errorMessage,
  isISODate,
  parseLocalDate,
} from './types';

const PERMISSION_ERROR = 'Health permissions not granted';
const REPOSITORY_ERROR = 'Exercise repository unavailable';
const INVALID_RANGE_ERROR = 'Invalid date range';
const INVALID_DATE_ERROR = 'Invalid date';

/** Payload handed to `upsertExternalExercise`. Mirrors `ExerciseEntry`. */
export interface ExternalExerciseInput {
  date: ISODate;
  name: string;
  category: ExerciseCategory;
  durationMin: number;
  caloriesBurned: number;
  source: EntrySource;
  externalId: string;
  notes: string | null;
  loggedAt: ISODateTime;
}

type UnknownRecord = Record<string, unknown>;
type UpsertFn = (input: ExternalExerciseInput) => Promise<unknown>;

/** Compile-time guard: the payload must satisfy the repository's contract. */
type Assignable<A extends B, B> = A;
type _PayloadMatchesRepository = Assignable<ExternalExerciseInput, NewExerciseEntry>;

/** Accepted names for the repository upsert, in priority order. */
const UPSERT_PATHS = [
  'upsertExternalExercise',
  'exerciseRepo.upsertExternalExercise',
  'exerciseRepo.upsertExternal',
  'exercisesRepo.upsertExternalExercise',
  'exerciseRepository.upsertExternalExercise',
  'upsertExerciseFromHealth',
];

/** Accepted names for the per-day read used to reconcile synthesized rows. */
const LIST_PATHS = [
  'listExercisesByDate',
  'exerciseRepo.listExercisesByDate',
  'exercisesRepo.listExercisesByDate',
  'exerciseRepository.listExercisesByDate',
];

/** Accepted names for the delete used to drop a stale synthesized row. */
const DELETE_PATHS = [
  'deleteExerciseEntry',
  'exerciseRepo.deleteExerciseEntry',
  'exercisesRepo.deleteExerciseEntry',
  'exerciseRepository.deleteExerciseEntry',
];

/** External id of the row that carries a workout-free day's active energy. */
export function dailyActivityExternalId(date: ISODate): string {
  return `daily-activity-${date}`;
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

/**
 * `@/db/repositories`, `@/store/appStore` and the service barrel are required
 * lazily (inside the call, never at module scope) so this module never
 * participates in an import cycle and still works while a sibling module is
 * only a placeholder. The specifiers stay literal so Metro can bundle them.
 */
function loadRepositories(): UnknownRecord | null {
  try {
    return require('@/db/repositories') as UnknownRecord;
  } catch {
    return null;
  }
}

function loadStore(): typeof import('@/store/appStore') | null {
  try {
    return require('@/store/appStore') as typeof import('@/store/appStore');
  } catch {
    return null;
  }
}

function loadBarrel(): typeof import('./index') | null {
  try {
    return require('./index') as typeof import('./index');
  } catch {
    return null;
  }
}

async function resolveUpsert(): Promise<UpsertFn | null> {
  const mod = loadRepositories();
  if (!mod) return null;
  for (const path of UPSERT_PATHS) {
    const fn = resolveFn(mod, path);
    if (fn) return fn as unknown as UpsertFn;
  }
  return null;
}

function resolveFirst(paths: string[]): ((...args: never[]) => unknown) | null {
  const mod = loadRepositories();
  if (!mod) return null;
  for (const path of paths) {
    const fn = resolveFn(mod, path);
    if (fn) return fn;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Drops the synthesized "Daily activity" row for `date`.
 *
 * That row only exists to carry active energy on a day with no workouts. Once
 * the platform reports a real workout for the same day the row is stale, and
 * leaving it in place would count the day's burn twice. Best effort: a
 * repository without the read/delete helpers, or any failure, is a no-op.
 */
async function removeStaleDailyActivity(date: ISODate): Promise<void> {
  try {
    const list = resolveFirst(LIST_PATHS);
    const remove = resolveFirst(DELETE_PATHS);
    if (!list || !remove) return;

    const entries = await (list as (date: ISODate) => Promise<unknown>)(date);
    if (!Array.isArray(entries)) return;

    const externalId = dailyActivityExternalId(date);
    for (const entry of entries) {
      if (!isRecord(entry) || entry.externalId !== externalId) continue;
      const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
      if (id) await (remove as (id: string) => Promise<unknown>)(id);
    }
  } catch {
    // Reconciliation must never fail a sync.
  }
}

async function isSyncEnabled(): Promise<boolean> {
  try {
    const store = loadStore();
    if (!store) return true;
    return store.useAppStore.getState().settings.healthSyncEnabled !== false;
  } catch {
    // Store unavailable (tests / early boot): do not block the sync.
    return true;
  }
}

async function invalidateStore(): Promise<void> {
  try {
    loadStore()?.useAppStore.getState().invalidate();
  } catch {
    // A store failure must never fail a sync.
  }
}

async function resolveService(explicit?: HealthService): Promise<HealthService> {
  if (explicit) return explicit;
  const barrel = loadBarrel();
  if (!barrel) throw new Error('Health service unavailable');
  return barrel.getHealthService();
}

/** Entry source recorded on imported rows. */
export function entrySourceFor(platform: HealthService['platform']): EntrySource {
  if (platform === 'health_connect') return 'health_connect';
  if (platform === 'healthkit') return 'healthkit';
  return Platform.OS === 'android' ? 'health_connect' : 'healthkit';
}

function localNoon(date: ISODate): ISODateTime {
  const day = parseLocalDate(date);
  if (!day) return new Date().toISOString();
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0).toISOString();
}

interface SyncContext {
  service: HealthService;
  upsert: UpsertFn;
  source: EntrySource;
}

interface DaySyncOutcome {
  summary: HealthDaySummary;
  imported: number;
  errors: string[];
}

/** Builds every row a day should produce, workouts first. */
function buildEntries(
  summary: HealthDaySummary,
  source: EntrySource
): { entries: ExternalExerciseInput[]; synthesized: boolean } {
  const entries: ExternalExerciseInput[] = [];
  const seen = new Set<string>();

  for (const workout of summary.workouts) {
    if (!workout.externalId || seen.has(workout.externalId)) continue;
    seen.add(workout.externalId);
    entries.push({
      date: summary.date,
      name: workout.name || 'Workout',
      category: workout.category,
      durationMin: Math.max(0, Math.round(workout.durationMin)),
      caloriesBurned: Math.max(0, Math.round(workout.caloriesBurned)),
      source,
      externalId: workout.externalId,
      notes: null,
      loggedAt: workout.startAt || localNoon(summary.date),
    });
  }

  // No workouts but real movement: keep the burned calories in the day's total.
  if (entries.length === 0 && summary.activeEnergyKcal > 0) {
    entries.push({
      date: summary.date,
      name: 'Daily activity',
      category: 'other',
      durationMin: Math.max(0, Math.round(summary.exerciseMinutes)),
      caloriesBurned: Math.round(summary.activeEnergyKcal),
      source,
      externalId: dailyActivityExternalId(summary.date),
      notes: null,
      loggedAt: localNoon(summary.date),
    });
    return { entries, synthesized: true };
  }

  return { entries, synthesized: false };
}

async function syncDay(ctx: SyncContext, date: ISODate): Promise<DaySyncOutcome> {
  const errors: string[] = [];
  let summary: HealthDaySummary;

  try {
    summary = await ctx.service.getDaySummary(date);
  } catch (error) {
    return {
      summary: emptyDaySummary(date),
      imported: 0,
      errors: [errorMessage(error, 'Failed to read health data')],
    };
  }

  const { entries, synthesized } = buildEntries(summary, ctx.source);

  let imported = 0;
  for (const entry of entries) {
    try {
      await ctx.upsert(entry);
      imported += 1;
    } catch (error) {
      errors.push(errorMessage(error, `Failed to import ${entry.name}`));
    }
  }

  // The synthetic row is valid only while the day has no workouts. Reconcile
  // once every write succeeded, so a failed import can never delete real data.
  if (!synthesized && errors.length === 0) await removeStaleDailyActivity(date);

  return { summary, imported, errors };
}

/**
 * Imports one day of health data.
 *
 * Returns `ok: true` with zeroes when health sync is switched off, and
 * `ok: false` when permissions are missing or the write path is unavailable.
 * Safe to call repeatedly: entries are keyed by `externalId`.
 */
export async function syncHealthDay(
  date: ISODate,
  service?: HealthService
): Promise<Result<HealthDaySyncResult>> {
  const empty: HealthDaySyncResult = { importedWorkouts: 0, activeEnergyKcal: 0, steps: 0 };

  if (!isISODate(date)) return { ok: false, error: INVALID_DATE_ERROR };
  if (!(await isSyncEnabled())) return { ok: true, data: empty };

  try {
    const resolved = await resolveService(service);

    let status: HealthPermissionStatus;
    try {
      status = await resolved.getPermissionStatus();
    } catch {
      status = 'denied';
    }
    if (status !== 'granted') return { ok: false, error: PERMISSION_ERROR };

    const upsert = await resolveUpsert();
    if (!upsert) return { ok: false, error: REPOSITORY_ERROR };

    const ctx: SyncContext = {
      service: resolved,
      upsert,
      source: entrySourceFor(resolved.platform),
    };
    const outcome = await syncDay(ctx, date);

    if (outcome.imported > 0) await invalidateStore();

    if (outcome.imported === 0 && outcome.errors.length > 0) {
      return { ok: false, error: outcome.errors[0] };
    }

    return {
      ok: true,
      data: {
        importedWorkouts: outcome.imported,
        activeEnergyKcal: outcome.summary.activeEnergyKcal,
        steps: outcome.summary.steps,
      },
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Health sync failed') };
  }
}

/**
 * Imports a whole range (inclusive, capped at {@link MAX_SYNC_DAYS} days).
 * Individual day failures are tolerated and simply not counted.
 */
export async function syncHealthRange(
  startDate: ISODate,
  endDate: ISODate,
  service?: HealthService
): Promise<Result<HealthRangeSyncResult>> {
  const empty: HealthRangeSyncResult = { days: 0, importedWorkouts: 0 };

  const dates = enumerateDates(startDate, endDate, MAX_SYNC_DAYS);
  if (dates.length === 0) return { ok: false, error: INVALID_RANGE_ERROR };
  if (!(await isSyncEnabled())) return { ok: true, data: empty };

  try {
    const resolved = await resolveService(service);

    let status: HealthPermissionStatus;
    try {
      status = await resolved.getPermissionStatus();
    } catch {
      status = 'denied';
    }
    if (status !== 'granted') return { ok: false, error: PERMISSION_ERROR };

    const upsert = await resolveUpsert();
    if (!upsert) return { ok: false, error: REPOSITORY_ERROR };

    const ctx: SyncContext = {
      service: resolved,
      upsert,
      source: entrySourceFor(resolved.platform),
    };

    let days = 0;
    let importedWorkouts = 0;
    const errors: string[] = [];

    for (const date of dates) {
      const outcome = await syncDay(ctx, date);
      if (outcome.errors.length > 0) errors.push(...outcome.errors);
      if (outcome.errors.length === 0) days += 1;
      importedWorkouts += outcome.imported;
    }

    if (importedWorkouts > 0) await invalidateStore();

    if (days === 0 && errors.length > 0) return { ok: false, error: errors[0] };

    return { ok: true, data: { days, importedWorkouts } };
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Health sync failed') };
  }
}
