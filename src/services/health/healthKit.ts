/**
 * Apple HealthKit provider (`react-native-health`).
 *
 * The library is optional (see `nativeModule.ts`): this file only ever talks to
 * an `unknown` module through narrow feature checks, so it is safe to import on
 * Android, web and in Jest. Every native call is wrapped — a failure yields a
 * zero-filled summary rather than an exception.
 *
 * Read:  StepCount, ActiveEnergyBurned, BasalEnergyBurned, AppleExerciseTime,
 *        DistanceWalkingRunning, Workout, BodyMass.
 * Write: BodyMass.
 */
import type {
  ExerciseCategory,
  HealthDaySummary,
  HealthPermissionStatus,
  HealthService,
  HealthWorkout,
  ISODate,
} from '@/types';

import {
  getMethod,
  isPromiseLike,
  isRecord,
  loadNativeHealthModule,
} from './nativeModule';
import {
  MS_PER_MINUTE,
  dayWindow,
  emptyDaySummary,
  energyToKcal,
  enumerateDates,
  massToKg,
  normalizeDaySummary,
  parseLocalDate,
  roundTo,
  safeNumber,
} from './types';

/** How long a single native call may take before we give up on it. */
const NATIVE_TIMEOUT_MS = 12_000;

const HK_READ_PERMISSION_KEYS = [
  'Steps',
  'StepCount',
  'ActiveEnergyBurned',
  'BasalEnergyBurned',
  'AppleExerciseTime',
  'DistanceWalkingRunning',
  'Workout',
  'Weight',
  'BodyMass',
] as const;

const HK_WRITE_PERMISSION_KEYS = ['Weight', 'BodyMass'] as const;

const HK_FALLBACK_READ_PERMISSIONS = [
  'Steps',
  'StepCount',
  'ActiveEnergyBurned',
  'BasalEnergyBurned',
  'AppleExerciseTime',
  'DistanceWalkingRunning',
  'Workout',
  'Weight',
];

const HK_FALLBACK_WRITE_PERMISSIONS = ['Weight'];

// ---------------------------------------------------------------------------
// Activity type -> ExerciseCategory
// ---------------------------------------------------------------------------

/** `HKWorkoutActivityType` names (normalised to lowercase alphanumerics). */
export const HEALTHKIT_ACTIVITY_CATEGORIES: Readonly<Record<string, ExerciseCategory>> =
  Object.freeze({
    running: 'cardio',
    walking: 'cardio',
    cycling: 'cardio',
    swimming: 'cardio',
    elliptical: 'cardio',
    rowing: 'cardio',
    hiking: 'cardio',
    stairclimbing: 'cardio',
    stairs: 'cardio',
    steptraining: 'cardio',
    jumprope: 'cardio',
    crosstraining: 'cardio',
    mixedcardio: 'cardio',
    cardiodance: 'cardio',
    highintensityintervaltraining: 'cardio',
    mixedmetaboliccardiotraining: 'cardio',
    handcycling: 'cardio',
    wheelchairwalkpace: 'cardio',
    wheelchairrunpace: 'cardio',
    swimbikerun: 'cardio',
    waterfitness: 'cardio',
    traditionalstrengthtraining: 'strength',
    functionalstrengthtraining: 'strength',
    coretraining: 'strength',
    yoga: 'flexibility',
    flexibility: 'flexibility',
    mindandbody: 'flexibility',
    pilates: 'flexibility',
    barre: 'flexibility',
    taichi: 'flexibility',
    preparationandrecovery: 'flexibility',
    cooldown: 'flexibility',
    basketball: 'sports',
    soccer: 'sports',
    tennis: 'sports',
    americanfootball: 'sports',
    australianfootball: 'sports',
    baseball: 'sports',
    softball: 'sports',
    volleyball: 'sports',
    badminton: 'sports',
    squash: 'sports',
    racquetball: 'sports',
    tabletennis: 'sports',
    pickleball: 'sports',
    golf: 'sports',
    hockey: 'sports',
    handball: 'sports',
    rugby: 'sports',
    cricket: 'sports',
    lacrosse: 'sports',
    bowling: 'sports',
    boxing: 'sports',
    kickboxing: 'sports',
    martialarts: 'sports',
    wrestling: 'sports',
    fencing: 'sports',
    archery: 'sports',
    climbing: 'sports',
    gymnastics: 'sports',
    trackandfield: 'sports',
    dance: 'sports',
    socialdance: 'sports',
    discsports: 'sports',
    equestriansports: 'sports',
    curling: 'sports',
    paddlesports: 'sports',
    surfingsports: 'sports',
    watersports: 'sports',
    waterpolo: 'sports',
    snowsports: 'sports',
    skatingsports: 'sports',
    snowboarding: 'sports',
    downhillskiing: 'sports',
    crosscountryskiing: 'cardio',
    underwaterdiving: 'sports',
    fitnessgaming: 'sports',
    play: 'other',
    other: 'other',
  });

/** Numeric `HKWorkoutActivityType` raw values for the types we see most. */
export const HEALTHKIT_ACTIVITY_IDS: Readonly<Record<number, string>> = Object.freeze({
  1: 'americanfootball',
  5: 'baseball',
  6: 'basketball',
  8: 'boxing',
  9: 'climbing',
  11: 'crosstraining',
  13: 'cycling',
  16: 'elliptical',
  20: 'functionalstrengthtraining',
  24: 'hiking',
  28: 'martialarts',
  29: 'mindandbody',
  30: 'mixedmetaboliccardiotraining',
  35: 'rowing',
  37: 'running',
  41: 'soccer',
  44: 'stairclimbing',
  46: 'swimming',
  47: 'tabletennis',
  48: 'tennis',
  50: 'traditionalstrengthtraining',
  51: 'volleyball',
  52: 'walking',
  57: 'yoga',
  58: 'barre',
  59: 'coretraining',
  62: 'flexibility',
  63: 'highintensityintervaltraining',
  64: 'jumprope',
  65: 'kickboxing',
  66: 'pilates',
  72: 'taichi',
  73: 'mixedcardio',
  74: 'handcycling',
  79: 'pickleball',
  80: 'cooldown',
  3000: 'other',
});

function normalizeActivityKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^hkworkoutactivitytype/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Maps a HealthKit activity name or raw type value onto our categories. */
export function mapHealthKitActivityToCategory(
  activity: string | number | null | undefined
): ExerciseCategory {
  if (activity === null || activity === undefined) return 'other';

  if (typeof activity === 'number') {
    const name = HEALTHKIT_ACTIVITY_IDS[activity];
    return name ? (HEALTHKIT_ACTIVITY_CATEGORIES[name] ?? 'other') : 'other';
  }

  const key = normalizeActivityKey(activity);
  if (!key) return 'other';
  const direct = HEALTHKIT_ACTIVITY_CATEGORIES[key];
  if (direct) return direct;

  const numeric = Number.parseInt(key, 10);
  if (Number.isFinite(numeric) && `${numeric}` === key) {
    return mapHealthKitActivityToCategory(numeric);
  }
  return 'other';
}

/** 'traditionalStrengthTraining' -> 'Traditional Strength Training'. */
function prettifyActivityName(value: string): string {
  const spaced = value
    .replace(/^HKWorkoutActivityType/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return 'Workout';
  return spaced
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Native call plumbing
// ---------------------------------------------------------------------------

/**
 * Calls a `react-native-health` method, tolerating both its callback style and
 * promise-returning forks. Resolves `null` on error/timeout/missing method.
 */
function invoke<T>(
  module: unknown,
  method: string,
  options?: Record<string, unknown> | null
): Promise<T | null> {
  const fn = getMethod(module, method);
  if (!fn) return Promise.resolve(null);

  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(null), NATIVE_TIMEOUT_MS);

    function finish(value: T | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }

    const callback = (error: unknown, results: unknown): void => {
      finish(error ? null : ((results ?? null) as T | null));
    };

    try {
      const args: unknown[] = options ? [options, callback] : [callback];
      const returned = (fn as (...a: unknown[]) => unknown).apply(module, args);
      if (isPromiseLike(returned)) {
        Promise.resolve(returned).then(
          (value) => finish((value ?? null) as T | null),
          () => finish(null)
        );
      }
    } catch {
      finish(null);
    }
  });
}

/** Normalises the many shapes HealthKit results arrive in into flat records. */
function toRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw)) {
    const nested = (raw as { data?: unknown }).data;
    if (Array.isArray(nested)) return nested.filter(isRecord);
    return [raw];
  }
  return [];
}

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function sumValues(raw: unknown, keys: readonly string[] = ['value', 'quantity', 'count']): number {
  return toRecords(raw).reduce((total, record) => {
    const value = pickNumber(record, keys);
    return value === null ? total : total + value;
  }, 0);
}

function sumEnergyKcal(raw: unknown): number {
  return toRecords(raw).reduce((total, record) => {
    const value = pickNumber(record, ['value', 'quantity', 'energy', 'calories']);
    if (value === null) return total;
    return total + energyToKcal(value, pickString(record, ['unit']));
  }, 0);
}

function durationMinutesFrom(record: Record<string, unknown>): number {
  const start = pickString(record, ['start', 'startDate', 'startTime']);
  const end = pickString(record, ['end', 'endDate', 'endTime']);
  if (start && end) {
    const from = Date.parse(start);
    const to = Date.parse(end);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      return roundTo((to - from) / MS_PER_MINUTE, 1);
    }
  }
  const seconds = pickNumber(record, ['duration', 'durationSeconds']);
  if (seconds !== null && seconds > 0) return roundTo(seconds / 60, 1);
  const minutes = pickNumber(record, ['durationMin', 'durationMinutes']);
  return minutes !== null && minutes > 0 ? roundTo(minutes, 1) : 0;
}

/** Turns one raw HealthKit workout sample into our `HealthWorkout`. */
export function normalizeHealthKitWorkout(raw: unknown): HealthWorkout | null {
  const record = isRecord(raw) ? raw : null;
  if (!record) return null;

  const activityName = pickString(record, [
    'activityName',
    'activityType',
    'workoutActivityType',
    'activity',
    'name',
  ]);
  const activityId = pickNumber(record, ['activityId', 'workoutActivityId', 'activityTypeId']);
  const category = mapHealthKitActivityToCategory(activityName ?? activityId);

  const startAt = pickString(record, ['start', 'startDate', 'startTime']) ?? null;
  const durationMin = durationMinutesFrom(record);
  const calories = pickNumber(record, [
    'calories',
    'totalEnergyBurned',
    'activeEnergyBurned',
    'energyBurned',
  ]);

  const uuid = pickString(record, ['id', 'uuid', 'UUID', 'sourceId']);
  const externalId = uuid
    ? `hk:${uuid}`
    : `hk:${normalizeActivityKey(activityName ?? `${activityId ?? 'workout'}`)}:${startAt ?? 'unknown'}`;

  return {
    externalId,
    name: activityName ? prettifyActivityName(activityName) : 'Workout',
    category,
    startAt: startAt ?? new Date().toISOString(),
    durationMin: Math.max(0, durationMin),
    caloriesBurned: Math.max(0, Math.round(energyToKcal(calories ?? 0, pickString(record, ['unit'])))),
  };
}

function resolvePermissions(module: unknown): { read: string[]; write: string[] } {
  const constants = isRecord(module) ? (module as { Constants?: unknown }).Constants : null;
  const permissions = isRecord(constants)
    ? (constants as { Permissions?: unknown }).Permissions
    : null;

  if (!isRecord(permissions)) {
    return { read: [...HK_FALLBACK_READ_PERMISSIONS], write: [...HK_FALLBACK_WRITE_PERMISSIONS] };
  }

  const resolve = (keys: readonly string[]): string[] => {
    const values = keys
      .map((key) => permissions[key])
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return Array.from(new Set(values));
  };

  const read = resolve(HK_READ_PERMISSION_KEYS);
  const write = resolve(HK_WRITE_PERMISSION_KEYS);
  return {
    read: read.length ? read : [...HK_FALLBACK_READ_PERMISSIONS],
    write: write.length ? write : [...HK_FALLBACK_WRITE_PERMISSIONS],
  };
}

/** HealthKit auth codes: 0 = not determined, 1 = denied, 2 = authorized. */
function deriveAuthStatus(raw: unknown): HealthPermissionStatus | null {
  if (!isRecord(raw)) return null;
  const container = isRecord((raw as { permissions?: unknown }).permissions)
    ? ((raw as { permissions: Record<string, unknown> }).permissions)
    : raw;

  const read = Array.isArray(container.read) ? container.read : [];
  const write = Array.isArray(container.write) ? container.write : [];
  const codes = [...read, ...write].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );

  if (codes.length === 0) return null;
  if (codes.some((code) => code === 2)) return 'granted';
  if (codes.every((code) => code === 0)) return 'undetermined';
  return 'denied';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HealthKitService implements HealthService {
  readonly platform = 'healthkit' as const;

  private readonly module: unknown;
  private initialized = false;
  /**
   * HealthKit deliberately hides *read* authorisation, so a successful
   * `initHealthKit` is the only positive signal we get; remember it.
   */
  private grantedInSession = false;

  constructor(module: unknown = loadNativeHealthModule('ios')) {
    this.module = module;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.module) return false;
    const available = await invoke<boolean>(this.module, 'isAvailable');
    return available === null ? true : Boolean(available);
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    if (!this.module) return 'unavailable';
    try {
      const status = deriveAuthStatus(
        await invoke<unknown>(this.module, 'getAuthStatus', {
          permissions: resolvePermissions(this.module),
        })
      );
      if (status === 'granted') return 'granted';
      if (this.grantedInSession) return 'granted';
      return status ?? 'undetermined';
    } catch {
      return this.grantedInSession ? 'granted' : 'undetermined';
    }
  }

  async requestPermissions(): Promise<HealthPermissionStatus> {
    if (!this.module) return 'unavailable';
    const permissions = { permissions: resolvePermissions(this.module) };

    const initialized = await new Promise<boolean>((resolve) => {
      const fn = getMethod(this.module, 'initHealthKit');
      if (!fn) {
        resolve(false);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => finish(false), NATIVE_TIMEOUT_MS);
      function finish(value: boolean): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }
      try {
        const returned = fn.call(this.module, permissions, (error: unknown) => finish(!error));
        if (isPromiseLike(returned)) {
          Promise.resolve(returned).then(
            () => finish(true),
            () => finish(false)
          );
        }
      } catch {
        finish(false);
      }
    });

    this.initialized = initialized;
    this.grantedInSession = initialized;
    if (!initialized) return 'denied';
    return this.getPermissionStatus();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized || !this.module) return;
    await this.requestPermissions();
  }

  async getDaySummary(date: ISODate): Promise<HealthDaySummary> {
    const empty = emptyDaySummary(date);
    const window = dayWindow(date);
    if (!this.module || !window) return empty;

    try {
      await this.ensureInitialized();
      const options = { startDate: window.startISO, endDate: window.endISO };

      const [steps, active, basal, exercise, distance, workouts] = await Promise.all([
        invoke<unknown>(this.module, 'getDailyStepCountSamples', options).then((result) =>
          result === null
            ? invoke<unknown>(this.module, 'getStepCount', { ...options, date: window.startISO })
            : result
        ),
        invoke<unknown>(this.module, 'getActiveEnergyBurned', options),
        invoke<unknown>(this.module, 'getBasalEnergyBurned', options),
        invoke<unknown>(this.module, 'getAppleExerciseTime', options),
        invoke<unknown>(this.module, 'getDailyDistanceWalkingRunningSamples', {
          ...options,
          unit: 'meter',
        }).then((result) =>
          result === null
            ? invoke<unknown>(this.module, 'getDistanceWalkingRunning', {
                ...options,
                unit: 'meter',
              })
            : result
        ),
        this.readWorkouts(options),
      ]);

      return normalizeDaySummary({
        date,
        steps: sumValues(steps),
        activeEnergyKcal: sumEnergyKcal(active),
        restingEnergyKcal: sumEnergyKcal(basal),
        exerciseMinutes: sumValues(exercise),
        distanceMeters: sumValues(distance, ['value', 'distance']),
        workouts,
      });
    } catch {
      return empty;
    }
  }

  private async readWorkouts(options: Record<string, unknown>): Promise<HealthWorkout[]> {
    const raw =
      (await invoke<unknown>(this.module, 'getAnchoredWorkouts', options)) ??
      (await invoke<unknown>(this.module, 'getSamples', { ...options, type: 'Workout' })) ??
      (await invoke<unknown>(this.module, 'getWorkouts', options));

    const seen = new Set<string>();
    const workouts: HealthWorkout[] = [];
    for (const record of toRecords(raw)) {
      const workout = normalizeHealthKitWorkout(record);
      if (!workout || seen.has(workout.externalId)) continue;
      seen.add(workout.externalId);
      workouts.push(workout);
    }
    return workouts;
  }

  async getRange(startDate: ISODate, endDate: ISODate): Promise<HealthDaySummary[]> {
    const dates = enumerateDates(startDate, endDate);
    const summaries: HealthDaySummary[] = [];
    for (const date of dates) {
      summaries.push(await this.getDaySummary(date));
    }
    return summaries;
  }

  async getLatestWeightKg(): Promise<number | null> {
    if (!this.module) return null;
    try {
      await this.ensureInitialized();
      const raw = await invoke<unknown>(this.module, 'getLatestWeight', { unit: 'gram' });
      const [record] = toRecords(raw);
      if (!record) return null;
      const value = pickNumber(record, ['value', 'quantity', 'weight']);
      if (value === null || value <= 0) return null;
      const unit = pickString(record, ['unit']) ?? (value > 500 ? 'gram' : 'kg');
      const kg = massToKg(value, unit);
      return kg > 0 ? roundTo(kg, 2) : null;
    } catch {
      return null;
    }
  }

  async writeWeight(weightKg: number, date: ISODate): Promise<boolean> {
    if (!this.module || !Number.isFinite(weightKg) || weightKg <= 0) return false;
    try {
      await this.ensureInitialized();
      const day = parseLocalDate(date);
      const when = day
        ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0)
        : new Date();
      const result = await invoke<unknown>(this.module, 'saveWeight', {
        value: safeNumber(weightKg) * 1000,
        unit: 'gram',
        date: when.toISOString(),
        startDate: when.toISOString(),
      });
      return result !== null;
    } catch {
      return false;
    }
  }
}

export function createHealthKitService(module?: unknown): HealthService {
  return new HealthKitService(module ?? loadNativeHealthModule('ios'));
}
