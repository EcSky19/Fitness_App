/**
 * Internal contract + shared helpers for the health module.
 *
 * The public shapes (`HealthService`, `HealthDaySummary`, `HealthWorkout`,
 * `HealthPermissionStatus`) live in `@/types` and are treated as frozen; this
 * file only adds the provider-agnostic plumbing every implementation needs:
 * local-midnight day windows, unit conversion and zero-filled summaries.
 */
import type { HealthDaySummary, HealthService, HealthWorkout, ISODate } from '@/types';

/** Mirrors `HealthService['platform']`. */
export type HealthPlatform = HealthService['platform'];

export const HEALTH_PLATFORM_LABELS: Readonly<Record<HealthPlatform, string>> = {
  healthkit: 'Apple Health',
  health_connect: 'Health Connect',
  mock: 'Simulated Health Data',
};

/** Human readable data types requested from the platform; used by the permission UI. */
export const HEALTH_PERMISSIONS: readonly string[] = Object.freeze([
  'Steps',
  'Active energy burned',
  'Resting energy burned',
  'Exercise minutes',
  'Walking + running distance',
  'Workouts',
  'Body weight (read)',
  'Body weight (write)',
]);

/** Upper bound for `syncHealthRange` so a bad range cannot hammer the platform. */
export const MAX_SYNC_DAYS = 90;

export const KCAL_PER_KJ = 0.2390057361;
export const KCAL_PER_JOULE = KCAL_PER_KJ / 1000;
/** Average stride length used to derive distance from a step count. */
export const METERS_PER_STEP = 0.762;

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface HealthDaySyncResult {
  importedWorkouts: number;
  activeEnergyKcal: number;
  steps: number;
}

export interface HealthRangeSyncResult {
  days: number;
  importedWorkouts: number;
}

/** A `[start, end)` window expressed in both `Date` and instant-string form. */
export interface DayWindow {
  readonly date: ISODate;
  readonly start: Date;
  readonly end: Date;
  /** UTC instant string for the *local* start of day. */
  readonly startISO: string;
  /** UTC instant string for the *local* start of the next day. */
  readonly endISO: string;
}

/** Local-time calendar date as 'YYYY-MM-DD' (never UTC-shifted). */
export function toISODate(value: Date): ISODate {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/**
 * Parses 'YYYY-MM-DD' into **local** midnight. Returns `null` when the string is
 * malformed or the calendar date does not exist (e.g. '2026-02-30').
 */
export function parseLocalDate(date: ISODate): Date | null {
  if (typeof date !== 'string' || !ISO_DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  // Rejects rolled-over dates such as '2026-02-30' -> Mar 2.
  return toISODate(parsed) === date ? parsed : null;
}

export function isISODate(date: string): boolean {
  return parseLocalDate(date) !== null;
}

/**
 * Local-midnight -> next-local-midnight window for a calendar date.
 *
 * Health platforms are queried with absolute instants: building the window from
 * local midnight (never `new Date(date)`, which parses as UTC) is what keeps a
 * day from being shifted by the timezone offset.
 */
export function dayWindow(date: ISODate): DayWindow | null {
  const start = parseLocalDate(date);
  if (!start) return null;
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0, 0);
  return {
    date,
    start,
    end,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

export function addDaysISO(date: ISODate, days: number): ISODate | null {
  const parsed = parseLocalDate(date);
  if (!parsed) return null;
  return toISODate(new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + days));
}

/** Inclusive ascending list of dates, capped at `max` entries. Reversed ranges are swapped. */
export function enumerateDates(
  startDate: ISODate,
  endDate: ISODate,
  max: number = MAX_SYNC_DAYS
): ISODate[] {
  const first = parseLocalDate(startDate);
  const last = parseLocalDate(endDate);
  if (!first || !last) return [];

  const [from, to] = first.getTime() <= last.getTime() ? [first, last] : [last, first];
  const dates: ISODate[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  while (cursor.getTime() <= to.getTime() && dates.length < Math.max(0, max)) {
    dates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function isFutureDate(date: ISODate, now: Date = new Date()): boolean {
  const parsed = parseLocalDate(date);
  if (!parsed) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parsed.getTime() > today.getTime();
}

export function isWeekend(date: ISODate): boolean {
  const parsed = parseLocalDate(date);
  if (!parsed) return false;
  const day = parsed.getDay();
  return day === 0 || day === 6;
}

/** All-zero summary; every provider returns this instead of throwing. */
export function emptyDaySummary(date: ISODate): HealthDaySummary {
  return {
    date,
    steps: 0,
    activeEnergyKcal: 0,
    restingEnergyKcal: 0,
    exerciseMinutes: 0,
    distanceMeters: 0,
    workouts: [],
  };
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Non-negative finite number, or `fallback`. */
export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Normalises whatever energy unit a platform reports into kcal. */
export function energyToKcal(value: number, unit?: string | null): number {
  const amount = safeNumber(value);
  const normalized = (unit ?? 'kcal').toString().trim().toLowerCase();
  switch (normalized) {
    case 'kj':
    case 'kilojoule':
    case 'kilojoules':
      return amount * KCAL_PER_KJ;
    case 'j':
    case 'joule':
    case 'joules':
      return amount * KCAL_PER_JOULE;
    case 'cal':
    case 'calorie':
    case 'calories':
      // Health Connect reports small calories; 1 kcal = 1000 cal.
      return amount / 1000;
    default:
      return amount;
  }
}

/** Normalises whatever mass unit a platform reports into kilograms. */
export function massToKg(value: number, unit?: string | null): number {
  const amount = safeNumber(value);
  const normalized = (unit ?? 'kg').toString().trim().toLowerCase();
  switch (normalized) {
    case 'g':
    case 'gram':
    case 'grams':
      return amount / 1000;
    case 'lb':
    case 'lbs':
    case 'pound':
    case 'pounds':
      return amount * 0.45359237;
    case 'st':
    case 'stone':
    case 'stones':
      return amount * 6.35029318;
    default:
      return amount;
  }
}

/** Rounds a summary to sane, non-negative integers before it leaves a provider. */
export function normalizeDaySummary(summary: HealthDaySummary): HealthDaySummary {
  return {
    date: summary.date,
    steps: Math.max(0, Math.round(safeNumber(summary.steps))),
    activeEnergyKcal: Math.max(0, Math.round(safeNumber(summary.activeEnergyKcal))),
    restingEnergyKcal: Math.max(0, Math.round(safeNumber(summary.restingEnergyKcal))),
    exerciseMinutes: Math.max(0, Math.round(safeNumber(summary.exerciseMinutes))),
    distanceMeters: Math.max(0, Math.round(safeNumber(summary.distanceMeters))),
    workouts: summary.workouts.map(normalizeWorkout),
  };
}

export function normalizeWorkout(workout: HealthWorkout): HealthWorkout {
  return {
    ...workout,
    durationMin: Math.max(0, roundTo(safeNumber(workout.durationMin), 1)),
    caloriesBurned: Math.max(0, Math.round(safeNumber(workout.caloriesBurned))),
  };
}

/** Extracts a readable message from anything thrown. */
export function errorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
