/**
 * Android Health Connect provider (`react-native-health-connect`).
 *
 * Like the HealthKit provider this only ever talks to an `unknown` module via
 * narrow feature checks, so importing it on iOS/web/Jest is harmless. Records
 * read: Steps, ActiveCaloriesBurned, TotalCaloriesBurned, ExerciseSession,
 * Distance and Weight; Weight is also written.
 */
import type {
  ExerciseCategory,
  HealthDaySummary,
  HealthPermissionStatus,
  HealthService,
  HealthWorkout,
  ISODate,
} from '@/types';

import { getMethod, isRecord, loadNativeHealthModule } from './nativeModule';
import {
  MS_PER_DAY,
  MS_PER_MINUTE,
  dayWindow,
  emptyDaySummary,
  energyToKcal,
  enumerateDates,
  massToKg,
  normalizeDaySummary,
  parseLocalDate,
  roundTo,
} from './types';

/** Health Connect SDK availability code for "installed and usable". */
const SDK_AVAILABLE = 3;

type AccessType = 'read' | 'write';

export interface HealthConnectPermission {
  accessType: AccessType;
  recordType: string;
}

export const HEALTH_CONNECT_PERMISSIONS: readonly HealthConnectPermission[] = Object.freeze([
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'TotalCaloriesBurned' },
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'write', recordType: 'Weight' },
]);

// ---------------------------------------------------------------------------
// exerciseType -> ExerciseCategory
// ---------------------------------------------------------------------------

/** `ExerciseSessionRecord.EXERCISE_TYPE_*` integer codes. */
export const HEALTH_CONNECT_EXERCISE_TYPES: Readonly<Record<number, string>> = Object.freeze({
  0: 'other_workout',
  2: 'badminton',
  4: 'baseball',
  5: 'basketball',
  8: 'biking',
  9: 'biking_stationary',
  10: 'boot_camp',
  11: 'boxing',
  13: 'calisthenics',
  14: 'cricket',
  16: 'dancing',
  25: 'elliptical',
  26: 'exercise_class',
  27: 'fencing',
  28: 'football_american',
  29: 'football_australian',
  31: 'frisbee_disc',
  32: 'golf',
  33: 'guided_breathing',
  34: 'gymnastics',
  35: 'handball',
  36: 'high_intensity_interval_training',
  37: 'hiking',
  38: 'ice_hockey',
  39: 'ice_skating',
  44: 'martial_arts',
  46: 'paddling',
  47: 'paragliding',
  48: 'pilates',
  50: 'racquetball',
  51: 'rock_climbing',
  52: 'roller_hockey',
  53: 'rowing',
  54: 'rowing_machine',
  55: 'rugby',
  56: 'running',
  57: 'running_treadmill',
  58: 'sailing',
  59: 'scuba_diving',
  60: 'skating',
  61: 'skiing',
  62: 'snowboarding',
  63: 'snowshoeing',
  64: 'soccer',
  65: 'softball',
  66: 'squash',
  68: 'stair_climbing',
  69: 'stair_climbing_machine',
  70: 'strength_training',
  71: 'stretching',
  72: 'surfing',
  73: 'swimming_open_water',
  74: 'swimming_pool',
  75: 'table_tennis',
  76: 'tennis',
  78: 'volleyball',
  79: 'walking',
  80: 'water_polo',
  81: 'weightlifting',
  82: 'wheelchair',
  83: 'yoga',
});

export const HEALTH_CONNECT_EXERCISE_CATEGORIES: Readonly<Record<string, ExerciseCategory>> =
  Object.freeze({
    running: 'cardio',
    running_treadmill: 'cardio',
    walking: 'cardio',
    hiking: 'cardio',
    biking: 'cardio',
    biking_stationary: 'cardio',
    elliptical: 'cardio',
    rowing: 'cardio',
    rowing_machine: 'cardio',
    swimming_pool: 'cardio',
    swimming_open_water: 'cardio',
    stair_climbing: 'cardio',
    stair_climbing_machine: 'cardio',
    high_intensity_interval_training: 'cardio',
    boot_camp: 'cardio',
    dancing: 'cardio',
    wheelchair: 'cardio',
    snowshoeing: 'cardio',
    strength_training: 'strength',
    weightlifting: 'strength',
    calisthenics: 'strength',
    yoga: 'flexibility',
    pilates: 'flexibility',
    stretching: 'flexibility',
    guided_breathing: 'flexibility',
    badminton: 'sports',
    baseball: 'sports',
    basketball: 'sports',
    boxing: 'sports',
    cricket: 'sports',
    fencing: 'sports',
    football_american: 'sports',
    football_australian: 'sports',
    frisbee_disc: 'sports',
    golf: 'sports',
    gymnastics: 'sports',
    handball: 'sports',
    ice_hockey: 'sports',
    ice_skating: 'sports',
    martial_arts: 'sports',
    paddling: 'sports',
    paragliding: 'sports',
    racquetball: 'sports',
    rock_climbing: 'sports',
    roller_hockey: 'sports',
    rugby: 'sports',
    sailing: 'sports',
    scuba_diving: 'sports',
    skating: 'sports',
    skiing: 'sports',
    snowboarding: 'sports',
    soccer: 'sports',
    softball: 'sports',
    squash: 'sports',
    surfing: 'sports',
    table_tennis: 'sports',
    tennis: 'sports',
    volleyball: 'sports',
    water_polo: 'sports',
    exercise_class: 'other',
    other_workout: 'other',
  });

function normalizeExerciseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^exercisetype\./, '')
    .replace(/^exercise_type_/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Maps a Health Connect exercise type (code or name) onto our categories. */
export function mapHealthConnectExerciseToCategory(
  exerciseType: string | number | null | undefined
): ExerciseCategory {
  if (exerciseType === null || exerciseType === undefined) return 'other';

  if (typeof exerciseType === 'number') {
    const name = HEALTH_CONNECT_EXERCISE_TYPES[exerciseType];
    return name ? (HEALTH_CONNECT_EXERCISE_CATEGORIES[name] ?? 'other') : 'other';
  }

  const key = normalizeExerciseKey(exerciseType);
  if (!key) return 'other';
  const direct = HEALTH_CONNECT_EXERCISE_CATEGORIES[key];
  if (direct) return direct;

  const numeric = Number.parseInt(key, 10);
  if (Number.isFinite(numeric) && `${numeric}` === key) {
    return mapHealthConnectExerciseToCategory(numeric);
  }
  return 'other';
}

/** 'running_treadmill' -> 'Running Treadmill'. */
function prettifyExerciseName(value: string): string {
  const cleaned = normalizeExerciseKey(value).replace(/_/g, ' ').trim();
  if (!cleaned) return 'Workout';
  return cleaned
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

function toRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw)) {
    const nested = (raw as { records?: unknown }).records;
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function timeOf(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** Health Connect quantities arrive as `{ inKilocalories, inKilojoules, ... }`. */
function quantityToKcal(value: unknown): number {
  if (typeof value === 'number') return energyToKcal(value, 'kcal');
  if (!isRecord(value)) return 0;
  const q = value as Record<string, unknown>;
  if (typeof q.inKilocalories === 'number') return q.inKilocalories;
  if (typeof q.inCalories === 'number') return energyToKcal(q.inCalories, 'cal');
  if (typeof q.inKilojoules === 'number') return energyToKcal(q.inKilojoules, 'kJ');
  if (typeof q.inJoules === 'number') return energyToKcal(q.inJoules, 'J');
  if (typeof q.value === 'number') {
    return energyToKcal(q.value, typeof q.unit === 'string' ? q.unit : 'kcal');
  }
  return 0;
}

function quantityToMeters(value: unknown): number {
  if (typeof value === 'number') return value;
  if (!isRecord(value)) return 0;
  const q = value as Record<string, unknown>;
  if (typeof q.inMeters === 'number') return q.inMeters;
  if (typeof q.inKilometers === 'number') return q.inKilometers * 1000;
  if (typeof q.inMiles === 'number') return q.inMiles * 1609.344;
  if (typeof q.inFeet === 'number') return q.inFeet * 0.3048;
  if (typeof q.value === 'number') return q.value;
  return 0;
}

function quantityToKg(value: unknown): number {
  if (typeof value === 'number') return value;
  if (!isRecord(value)) return 0;
  const q = value as Record<string, unknown>;
  if (typeof q.inKilograms === 'number') return q.inKilograms;
  if (typeof q.inGrams === 'number') return q.inGrams / 1000;
  if (typeof q.inPounds === 'number') return massToKg(q.inPounds, 'lb');
  if (typeof q.value === 'number') {
    return massToKg(q.value, typeof q.unit === 'string' ? q.unit : 'kg');
  }
  return 0;
}

function metadataId(record: Record<string, unknown>): string | null {
  const metadata = record.metadata;
  if (isRecord(metadata)) {
    const id = (metadata as { id?: unknown }).id;
    if (typeof id === 'string' && id) return id;
    const clientId = (metadata as { clientRecordId?: unknown }).clientRecordId;
    if (typeof clientId === 'string' && clientId) return clientId;
  }
  const direct = (record as { id?: unknown }).id;
  return typeof direct === 'string' && direct ? direct : null;
}

/** Energy from records overlapping `[start, end)`, prorated by overlap. */
function energyInWindow(
  energyRecords: Record<string, unknown>[],
  start: number,
  end: number
): number {
  if (end <= start) return 0;
  return energyRecords.reduce((total, record) => {
    const from = timeOf(record, ['startTime', 'time']);
    const to = timeOf(record, ['endTime', 'time']) ?? from;
    if (from === null || to === null || to < from) return total;

    const kcal = quantityToKcal(record.energy);
    if (kcal <= 0) return total;

    const overlap = Math.min(to, end) - Math.max(from, start);
    if (overlap <= 0) return total;

    const span = to - from;
    return total + (span > 0 ? kcal * (overlap / span) : kcal);
  }, 0);
}

/** Fallback energy estimate when no calorie record covers a session. */
const CATEGORY_KCAL_PER_MIN: Readonly<Record<ExerciseCategory, number>> = Object.freeze({
  cardio: 9,
  strength: 6,
  sports: 8,
  flexibility: 3,
  other: 5,
});

export function normalizeHealthConnectSession(
  raw: unknown,
  energyRecords: Record<string, unknown>[] = []
): HealthWorkout | null {
  const record = isRecord(raw) ? raw : null;
  if (!record) return null;

  const start = timeOf(record, ['startTime', 'time']);
  const end = timeOf(record, ['endTime']) ?? start;
  if (start === null || end === null) return null;

  const rawType = record.exerciseType;
  const exerciseType =
    typeof rawType === 'number' || typeof rawType === 'string' ? rawType : null;
  const category = mapHealthConnectExerciseToCategory(exerciseType);

  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : null;
  const typeName =
    typeof exerciseType === 'number'
      ? (HEALTH_CONNECT_EXERCISE_TYPES[exerciseType] ?? 'workout')
      : (exerciseType ?? 'workout');

  const durationMin = Math.max(0, roundTo((end - start) / MS_PER_MINUTE, 1));
  const overlapKcal = energyInWindow(energyRecords, start, end);
  const caloriesBurned = Math.round(
    overlapKcal > 0 ? overlapKcal : durationMin * CATEGORY_KCAL_PER_MIN[category]
  );

  const id = metadataId(record) ?? `${typeName}-${new Date(start).toISOString()}`;

  return {
    externalId: `hc:${id}`,
    name: title ?? prettifyExerciseName(`${typeName}`),
    category,
    startAt: new Date(start).toISOString(),
    durationMin,
    caloriesBurned: Math.max(0, caloriesBurned),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HealthConnectService implements HealthService {
  readonly platform = 'health_connect' as const;

  private readonly module: unknown;
  private initialized = false;
  private requested = false;

  constructor(module: unknown = loadNativeHealthModule('android')) {
    this.module = module;
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T | null> {
    const fn = getMethod(this.module, method);
    if (!fn) return null;
    try {
      return ((await fn.apply(this.module, args)) ?? null) as T | null;
    } catch {
      return null;
    }
  }

  private async ensureInitialized(): Promise<boolean> {
    if (!this.module) return false;
    if (this.initialized) return true;
    const result = await this.call<boolean>('initialize');
    this.initialized = result !== null ? result !== false : false;
    return this.initialized;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.module) return false;
    const status = await this.call<number>('getSdkStatus');
    if (typeof status === 'number') return status === SDK_AVAILABLE;
    return this.ensureInitialized();
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    if (!this.module) return 'unavailable';
    if (!(await this.ensureInitialized())) return 'unavailable';

    const granted = await this.call<unknown>('getGrantedPermissions');
    const list = Array.isArray(granted) ? granted : [];
    const readGranted = list.some(
      (permission) => isRecord(permission) && permission.accessType === 'read'
    );
    if (readGranted) return 'granted';
    // Health Connect cannot distinguish "never asked" from "denied"; we track it.
    return this.requested ? 'denied' : 'undetermined';
  }

  async requestPermissions(): Promise<HealthPermissionStatus> {
    if (!this.module) return 'unavailable';
    if (!(await this.ensureInitialized())) return 'unavailable';

    this.requested = true;
    await this.call<unknown>('requestPermission', [...HEALTH_CONNECT_PERMISSIONS]);
    return this.getPermissionStatus();
  }

  private async readRecords(
    recordType: string,
    startISO: string,
    endISO: string
  ): Promise<Record<string, unknown>[]> {
    const raw = await this.call<unknown>('readRecords', recordType, {
      timeRangeFilter: { operator: 'between', startTime: startISO, endTime: endISO },
    });
    return toRecords(raw);
  }

  async getDaySummary(date: ISODate): Promise<HealthDaySummary> {
    const empty = emptyDaySummary(date);
    const window = dayWindow(date);
    if (!this.module || !window) return empty;

    try {
      if (!(await this.ensureInitialized())) return empty;
      const { startISO, endISO } = window;

      const [steps, active, total, sessions, distance] = await Promise.all([
        this.readRecords('Steps', startISO, endISO),
        this.readRecords('ActiveCaloriesBurned', startISO, endISO),
        this.readRecords('TotalCaloriesBurned', startISO, endISO),
        this.readRecords('ExerciseSession', startISO, endISO),
        this.readRecords('Distance', startISO, endISO),
      ]);

      const stepCount = steps.reduce(
        (sum, record) => sum + (typeof record.count === 'number' ? record.count : 0),
        0
      );
      const activeEnergyKcal = active.reduce((sum, record) => sum + quantityToKcal(record.energy), 0);
      const totalEnergyKcal = total.reduce((sum, record) => sum + quantityToKcal(record.energy), 0);
      const distanceMeters = distance.reduce(
        (sum, record) => sum + quantityToMeters(record.distance),
        0
      );

      const workouts: HealthWorkout[] = [];
      const seen = new Set<string>();
      for (const session of sessions) {
        const workout = normalizeHealthConnectSession(session, active);
        if (!workout || seen.has(workout.externalId)) continue;
        seen.add(workout.externalId);
        workouts.push(workout);
      }

      const exerciseMinutes = workouts.reduce((sum, workout) => sum + workout.durationMin, 0);

      return normalizeDaySummary({
        date,
        steps: stepCount,
        activeEnergyKcal,
        restingEnergyKcal: Math.max(0, totalEnergyKcal - activeEnergyKcal),
        exerciseMinutes,
        distanceMeters,
        workouts,
      });
    } catch {
      return empty;
    }
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
      if (!(await this.ensureInitialized())) return null;
      const end = new Date();
      const start = new Date(end.getTime() - 90 * MS_PER_DAY);
      const records = await this.readRecords('Weight', start.toISOString(), end.toISOString());
      if (records.length === 0) return null;

      const latest = records.reduce((newest, record) => {
        const a = timeOf(record, ['time', 'startTime']) ?? 0;
        const b = timeOf(newest, ['time', 'startTime']) ?? 0;
        return a >= b ? record : newest;
      });

      const kg = quantityToKg(latest.weight);
      return kg > 0 ? roundTo(kg, 2) : null;
    } catch {
      return null;
    }
  }

  async writeWeight(weightKg: number, date: ISODate): Promise<boolean> {
    if (!this.module || !Number.isFinite(weightKg) || weightKg <= 0) return false;
    try {
      if (!(await this.ensureInitialized())) return false;
      const day = parseLocalDate(date);
      const when = day
        ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0, 0)
        : new Date();
      const result = await this.call<unknown>('insertRecords', [
        {
          recordType: 'Weight',
          time: when.toISOString(),
          weight: { value: weightKg, unit: 'kilograms' },
        },
      ]);
      return result !== null;
    } catch {
      return false;
    }
  }
}

export function createHealthConnectService(module?: unknown): HealthService {
  return new HealthConnectService(module ?? loadNativeHealthModule('android'));
}
