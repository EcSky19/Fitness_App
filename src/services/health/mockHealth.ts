/**
 * Simulated health provider.
 *
 * Every number is derived from a hash of the calendar date, so the same date
 * always produces the exact same day — a week of data looks plausible, charts
 * are stable across reloads and tests can assert on real values. This is what
 * makes MacroTrack fully demoable without a HealthKit / Health Connect build.
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
  METERS_PER_STEP,
  clamp,
  emptyDaySummary,
  enumerateDates,
  isFutureDate,
  isWeekend,
  normalizeDaySummary,
  parseLocalDate,
  roundTo,
} from './types';

interface MockWorkoutTemplate {
  name: string;
  category: ExerciseCategory;
  /** Rough energy cost used to keep calories in line with duration. */
  kcalPerMin: number;
}

/** Realistic workouts the simulator draws from. */
export const MOCK_WORKOUT_TEMPLATES: readonly MockWorkoutTemplate[] = Object.freeze([
  { name: 'Morning Run', category: 'cardio', kcalPerMin: 11 },
  { name: 'Outdoor Walk', category: 'cardio', kcalPerMin: 4.5 },
  { name: 'Strength Training', category: 'strength', kcalPerMin: 7 },
  { name: 'Indoor Cycling', category: 'cardio', kcalPerMin: 9.5 },
  { name: 'Pool Swim', category: 'cardio', kcalPerMin: 10 },
  { name: 'HIIT Session', category: 'cardio', kcalPerMin: 12 },
  { name: 'Vinyasa Yoga', category: 'flexibility', kcalPerMin: 3.5 },
  { name: 'Rowing Machine', category: 'cardio', kcalPerMin: 9 },
  { name: 'Pickup Basketball', category: 'sports', kcalPerMin: 8.5 },
  { name: 'Elliptical', category: 'cardio', kcalPerMin: 8 },
]);

/** Stable starting weight for the simulated profile. */
const DEFAULT_MOCK_WEIGHT_KG = 74.8;

/** Share of active energy that may be attributed to explicit workouts. */
const WORKOUT_ENERGY_BUDGET = 0.85;

/** FNV-1a — small, fast, and stable across JS engines. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG: deterministic sequence from a 32 bit seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localISODateTime(date: ISODate, hour: number, minute: number): string {
  const base = parseLocalDate(date);
  if (!base) return new Date().toISOString();
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0).toISOString();
}

function buildWorkouts(
  date: ISODate,
  random: () => number,
  exerciseMinutes: number,
  activeEnergyKcal: number
): HealthWorkout[] {
  if (exerciseMinutes < 15) return [];

  const count = exerciseMinutes >= 45 && random() > 0.45 ? 2 : 1;
  const durations: number[] = [];
  if (count === 1) {
    durations.push(exerciseMinutes);
  } else {
    const first = Math.round(exerciseMinutes * (0.4 + random() * 0.25));
    durations.push(first, exerciseMinutes - first);
  }

  const templates: MockWorkoutTemplate[] = [];
  const pool = [...MOCK_WORKOUT_TEMPLATES];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(random() * pool.length) % pool.length;
    templates.push(pool.splice(index, 1)[0] ?? MOCK_WORKOUT_TEMPLATES[0]);
  }

  const rawCalories = durations.map((minutes, i) => minutes * templates[i].kcalPerMin);
  const rawTotal = rawCalories.reduce((sum, value) => sum + value, 0);
  const budget = activeEnergyKcal * WORKOUT_ENERGY_BUDGET;
  const scale = rawTotal > budget && rawTotal > 0 ? budget / rawTotal : 1;

  return durations.map((durationMin, index) => {
    const template = templates[index];
    const hour = index === 0 ? 6 + Math.floor(random() * 4) : 17 + Math.floor(random() * 3);
    return {
      externalId: `mock-${date}-${index}`,
      name: template.name,
      category: template.category,
      startAt: localISODateTime(date, hour, index === 0 ? 15 : 30),
      durationMin,
      caloriesBurned: Math.max(1, Math.floor(rawCalories[index] * scale)),
    };
  });
}

/**
 * Deterministic day of simulated health data.
 * Future dates (and malformed dates) return an all-zero summary.
 */
export function buildMockDaySummary(date: ISODate, now: Date = new Date()): HealthDaySummary {
  if (!parseLocalDate(date) || isFutureDate(date, now)) return emptyDaySummary(date);

  const random = mulberry32(hashString(`macrotrack:health:${date}`));
  const weekend = isWeekend(date);

  // Weekdays 6k-14k steps, weekends 3k-9k.
  const steps = Math.round(weekend ? 3000 + random() * 6000 : 6000 + random() * 8000);

  // Active energy tracks step count, with a little day-to-day noise.
  const activeEnergyKcal = Math.round(
    clamp(150 + ((steps - 3000) / 11000) * 500 + (random() - 0.5) * 120, 150, 750)
  );

  const restingEnergyKcal = Math.round(1500 + random() * 300);

  const rest = random();
  const exerciseMinutes =
    rest < 0.15
      ? 0
      : Math.round(clamp(((activeEnergyKcal - 150) / 600) * 75 * (0.55 + random() * 0.75), 0, 75));

  const distanceMeters = Math.round(steps * METERS_PER_STEP);
  const workouts = buildWorkouts(date, random, exerciseMinutes, activeEnergyKcal);

  return normalizeDaySummary({
    date,
    steps,
    activeEnergyKcal,
    restingEnergyKcal,
    exerciseMinutes,
    distanceMeters,
    workouts,
  });
}

export interface MockHealthOptions {
  /** Clock override (tests). */
  now?: () => Date;
  initialWeightKg?: number;
  /** Start already authorised (useful for screenshots/demos). */
  initialPermission?: HealthPermissionStatus;
}

/**
 * Simulated `HealthService`. Permission state lives on the instance, so it
 * survives for the whole session and resets with `resetHealthService()`.
 */
export class MockHealthService implements HealthService {
  readonly platform = 'mock' as const;

  private permission: HealthPermissionStatus;
  private weightKg: number;
  private readonly now: () => Date;

  constructor(options: MockHealthOptions = {}) {
    this.permission = options.initialPermission ?? 'undetermined';
    this.weightKg = options.initialWeightKg ?? DEFAULT_MOCK_WEIGHT_KG;
    this.now = options.now ?? (() => new Date());
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    return this.permission;
  }

  async requestPermissions(): Promise<HealthPermissionStatus> {
    this.permission = 'granted';
    return this.permission;
  }

  async getDaySummary(date: ISODate): Promise<HealthDaySummary> {
    return buildMockDaySummary(date, this.now());
  }

  async getRange(startDate: ISODate, endDate: ISODate): Promise<HealthDaySummary[]> {
    const now = this.now();
    return enumerateDates(startDate, endDate).map((date) => buildMockDaySummary(date, now));
  }

  async getLatestWeightKg(): Promise<number | null> {
    return roundTo(this.weightKg, 1);
  }

  async writeWeight(weightKg: number, _date?: ISODate): Promise<boolean> {
    if (!Number.isFinite(weightKg) || weightKg <= 0) return false;
    this.weightKg = weightKg;
    return true;
  }
}

export function createMockHealthService(options?: MockHealthOptions): HealthService {
  return new MockHealthService(options);
}
