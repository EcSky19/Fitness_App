/**
 * Weight history loading + derivation.
 *
 * Everything is stored and computed in KILOGRAMS. Display-unit conversion only
 * happens in the components, never here.
 *
 * The pure helpers (`filterLogsByRange`, `buildTrendPoints`, `deriveStats`,
 * `groupByMonth`, `deltaTone`) are exported so they can be unit tested without
 * rendering.
 */
import { useCallback, useMemo, useState } from 'react';

import { listWeightLogs } from '@/db/repositories';
import {
  addDaysISO,
  bmi as bmiOf,
  bmiCategory,
  clamp,
  computeEMA,
  diffDaysISO,
  goalProgressPct,
  isoToDate,
  projectGoalDate,
  roundTo,
  todayISO,
  weightTrend,
} from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useAppStore } from '@/store/appStore';
import type { ISODate, WeightLog } from '@/types';

export type WeightRange = '7D' | '30D' | '90D' | '1Y' | 'ALL';

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese';

/** Tone of a change relative to the goal: moving toward it is always `good`. */
export type ChangeTone = 'good' | 'bad' | 'neutral';

/** `null` = no lower bound (every log). */
export const WEIGHT_RANGE_DAYS: Record<WeightRange, number | null> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '1Y': 365,
  ALL: null,
};

export const WEIGHT_RANGE_OPTIONS: { label: string; value: WeightRange }[] = [
  { label: '7D', value: '7D' },
  { label: '30D', value: '30D' },
  { label: '90D', value: '90D' },
  { label: '1Y', value: '1Y' },
  { label: 'All', value: 'ALL' },
];

/** Below this a change is treated as "flat" so scale noise is not coloured. */
export const FLAT_EPSILON_KG = 0.05;

export interface WeightTrendPoint {
  date: ISODate;
  weightKg: number;
  ema: number;
}

export interface WeightStats {
  logCount: number;
  latest: WeightLog | null;
  previous: WeightLog | null;
  currentKg: number | null;
  /** Earliest logged weight, or the profile weight when there is no history. */
  startKg: number | null;
  goalKg: number | null;
  /** Latest log minus the one before it. */
  changeSinceLastKg: number | null;
  /** Last minus first inside the selected range. */
  rangeChangeKg: number | null;
  change7dKg: number | null;
  change30dKg: number | null;
  ratePerWeekKg: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  projectedGoalDate: ISODate | null;
  progressPct: number | null;
  /** Signed: positive = must gain, negative = must lose. */
  remainingKg: number | null;
  bmi: number | null;
  bmiCategory: BmiCategory | null;
  /** Goal sits above the current weight. */
  isBulking: boolean;
}

export interface WeightMonthSection {
  key: string;
  label: string;
  /** Newest first. */
  logs: WeightLog[];
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const EMPTY_LOGS: WeightLog[] = [];

/** Guards against `NaN` / `Infinity` leaking out of the domain helpers. */
function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function byDateAsc(a: WeightLog, b: WeightLog): number {
  return a.date.localeCompare(b.date);
}

export function sortLogsAsc(logs: WeightLog[]): WeightLog[] {
  return [...logs].sort(byDateAsc);
}

/** Number of days in a range, resolved against the data for `ALL`. */
export function resolveRangeDays(
  range: WeightRange,
  logs: WeightLog[],
  today: ISODate = todayISO()
): number | null {
  const fixed = WEIGHT_RANGE_DAYS[range];
  if (fixed != null) return fixed;
  if (logs.length === 0) return null;
  const first = sortLogsAsc(logs)[0];
  const span = finite(diffDaysISO(first.date, today));
  return span == null ? null : Math.max(1, Math.abs(span) + 1);
}

/**
 * Keeps logs inside the trailing window (inclusive of today), oldest first.
 * Older logs stay in the history list; they are only hidden from the chart.
 */
export function filterLogsByRange(
  logs: WeightLog[],
  range: WeightRange,
  today: ISODate = todayISO()
): WeightLog[] {
  const sorted = sortLogsAsc(logs);
  const days = WEIGHT_RANGE_DAYS[range];
  if (days == null) return sorted;
  const start = addDaysISO(today, -(days - 1));
  return sorted.filter((log) => log.date >= start);
}

/**
 * Raw weight + EMA trend for the chart. Safe with 0 or 1 points.
 * `computeEMA` already sorts and collapses duplicate dates, so its series is
 * used as-is; the raw logs are only a fallback.
 */
export function buildTrendPoints(logs: WeightLog[]): WeightTrendPoint[] {
  if (logs.length === 0) return [];
  const sorted = sortLogsAsc(logs);
  const series = computeEMA(sorted);
  if (Array.isArray(series) && series.length > 0) {
    return series
      .filter((point) => point && typeof point.date === 'string')
      .map((point) => {
        const weightKg = finite(point.weightKg) ?? 0;
        return { date: point.date, weightKg, ema: finite(point.ema) ?? weightKg };
      });
  }
  return sorted.map((log) => ({ date: log.date, weightKg: log.weightKg, ema: log.weightKg }));
}

/** Last minus first inside the trailing window; `null` with fewer than 2 logs. */
export function changeOverDays(
  logs: WeightLog[],
  days: number,
  today: ISODate = todayISO()
): number | null {
  const start = addDaysISO(today, -(days - 1));
  const window = sortLogsAsc(logs).filter((log) => log.date >= start);
  if (window.length < 2) return null;
  return roundTo(window[window.length - 1].weightKg - window[0].weightKg, 2);
}

/**
 * Is `deltaKg` moving toward the goal?
 * Cutting (goal below reference) -> losing is `good`; bulking inverts it.
 */
export function deltaTone(
  deltaKg: number | null,
  goalKg: number | null,
  referenceKg: number | null
): ChangeTone {
  if (deltaKg == null || !Number.isFinite(deltaKg)) return 'neutral';
  if (Math.abs(deltaKg) < FLAT_EPSILON_KG) return 'neutral';
  if (goalKg == null || referenceKg == null) return 'neutral';
  if (Math.abs(goalKg - referenceKg) < FLAT_EPSILON_KG) return 'neutral';
  const wantsToLose = goalKg < referenceKg;
  const isLosing = deltaKg < 0;
  return isLosing === wantsToLose ? 'good' : 'bad';
}

export function toneColor(
  tone: ChangeTone,
  colors: { success: string; danger: string; textMuted: string }
): string {
  if (tone === 'good') return colors.success;
  if (tone === 'bad') return colors.danger;
  return colors.textMuted;
}

export interface DeriveStatsParams {
  /** Every log, any order. */
  logs: WeightLog[];
  /** Logs inside the selected range, any order. */
  rangeLogs: WeightLog[];
  goalKg: number | null;
  heightCm: number | null;
  /** Fallback start weight when there is no history. */
  profileWeightKg: number | null;
  /** Window used for the weekly rate + projection. */
  rateDays: number | null;
  today?: ISODate;
}

export function deriveStats({
  logs,
  rangeLogs,
  goalKg: rawGoalKg,
  heightCm,
  profileWeightKg,
  rateDays,
  today = todayISO(),
}: DeriveStatsParams): WeightStats {
  const sorted = sortLogsAsc(logs);
  const sortedRange = sortLogsAsc(rangeLogs);
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const goalKg = finite(rawGoalKg);

  const currentKg = latest ? finite(latest.weightKg) : finite(profileWeightKg);
  const startKg = sorted.length > 0 ? finite(sorted[0].weightKg) : finite(profileWeightKg);

  const changeSinceLastKg =
    latest && previous ? roundTo(latest.weightKg - previous.weightKg, 2) : null;

  const rangeChangeKg =
    sortedRange.length > 1
      ? roundTo(sortedRange[sortedRange.length - 1].weightKg - sortedRange[0].weightKg, 2)
      : null;

  const change7dKg = changeOverDays(sorted, 7, today);
  const change30dKg = changeOverDays(sorted, 30, today);

  let ratePerWeekKg: number | null = null;
  let direction: WeightStats['direction'] = null;
  if (rateDays != null && sorted.length > 1) {
    const windowStart = addDaysISO(today, -(rateDays - 1));
    const inWindow = sorted.filter((log) => log.date >= windowStart);
    if (inWindow.length > 1) {
      const trend = weightTrend(sorted, rateDays);
      ratePerWeekKg = finite(trend?.ratePerWeekKg);
      const trendDirection = trend?.direction;
      direction =
        trendDirection === 'up' || trendDirection === 'down' || trendDirection === 'flat'
          ? trendDirection
          : null;
    }
  }

  let projectedGoalDate: ISODate | null = null;
  if (currentKg != null && goalKg != null && ratePerWeekKg != null && ratePerWeekKg !== 0) {
    const projected = projectGoalDate(currentKg, goalKg, ratePerWeekKg);
    projectedGoalDate = typeof projected === 'string' && projected.length > 0 ? projected : null;
  }

  let progressPct: number | null = null;
  if (startKg != null && currentKg != null && goalKg != null) {
    // `goalProgressPct` returns a 0..1 fraction; this stat is a percentage.
    const fraction = finite(goalProgressPct(startKg, currentKg, goalKg));
    progressPct = fraction == null ? null : fraction * 100;
    if (progressPct == null) {
      progressPct = Math.abs(currentKg - goalKg) < FLAT_EPSILON_KG ? 100 : 0;
    }
    if (Math.abs(currentKg - goalKg) < FLAT_EPSILON_KG) progressPct = 100;
    progressPct = finite(clamp(progressPct, 0, 100)) ?? 0;
  }

  const remainingKg = currentKg != null && goalKg != null ? roundTo(goalKg - currentKg, 2) : null;

  let bmiValue: number | null = null;
  let bmiLabel: BmiCategory | null = null;
  const height = finite(heightCm);
  if (currentKg != null && height != null && height > 0) {
    bmiValue = finite(bmiOf(currentKg, height));
    if (bmiValue != null) {
      const category = bmiCategory(bmiValue);
      bmiLabel =
        category === 'underweight' ||
        category === 'normal' ||
        category === 'overweight' ||
        category === 'obese'
          ? category
          : null;
    }
  }

  return {
    logCount: sorted.length,
    latest,
    previous,
    currentKg,
    startKg,
    goalKg,
    changeSinceLastKg,
    rangeChangeKg,
    change7dKg,
    change30dKg,
    ratePerWeekKg,
    direction,
    projectedGoalDate,
    progressPct,
    remainingKg,
    bmi: bmiValue,
    bmiCategory: bmiLabel,
    isBulking: goalKg != null && currentKg != null && goalKg > currentKg + FLAT_EPSILON_KG,
  };
}

/** Newest month first, newest log first inside each month. */
export function groupByMonth(logs: WeightLog[]): WeightMonthSection[] {
  const sections = new Map<string, WeightMonthSection>();
  const descending = sortLogsAsc(logs).reverse();

  for (const log of descending) {
    const key = log.date.slice(0, 7);
    let section = sections.get(key);
    if (!section) {
      const monthIndex = Number(key.slice(5, 7)) - 1;
      const year = Number(key.slice(0, 4));
      const label = MONTH_LABELS[monthIndex] ?? key;
      section = { key, label: `${label} ${year}`, logs: [] };
      sections.set(key, section);
    }
    section.logs.push(log);
  }

  return [...sections.values()];
}

function formatError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Upper bound for a single history fetch (the repository default is 100). */
export const WEIGHT_LOG_FETCH_LIMIT = 2000;

function loadWeightLogs(): Promise<WeightLog[]> {
  return Promise.resolve(listWeightLogs(WEIGHT_LOG_FETCH_LIMIT)).then((logs) =>
    Array.isArray(logs) ? logs : []
  );
}

export interface UseWeightHistoryResult {
  range: WeightRange;
  setRange: (range: WeightRange) => void;
  /** Every log, oldest first. */
  logs: WeightLog[];
  /** Logs inside the selected range, oldest first. */
  rangeLogs: WeightLog[];
  points: WeightTrendPoint[];
  stats: WeightStats;
  months: WeightMonthSection[];
  latestLog: WeightLog | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useWeightHistory(initialRange: WeightRange = '30D'): UseWeightHistoryResult {
  const [range, setRange] = useState<WeightRange>(initialRange);
  const profile = useAppStore((state) => state.profile);

  const { data, loading, error, reload } = useAsyncData<WeightLog[]>(loadWeightLogs, [], EMPTY_LOGS);

  const logs = useMemo(() => sortLogsAsc(Array.isArray(data) ? data : EMPTY_LOGS), [data]);
  const rangeLogs = useMemo(() => filterLogsByRange(logs, range), [logs, range]);
  const points = useMemo(() => buildTrendPoints(rangeLogs), [rangeLogs]);
  const months = useMemo(() => groupByMonth(logs), [logs]);

  const goalWeightKg = profile?.goalWeightKg ?? null;
  const heightCm = profile?.heightCm ?? null;
  const profileWeightKg = profile?.currentWeightKg ?? null;

  const stats = useMemo(
    () =>
      deriveStats({
        logs,
        rangeLogs,
        goalKg: goalWeightKg,
        heightCm,
        profileWeightKg,
        rateDays: resolveRangeDays(range, logs),
      }),
    [logs, rangeLogs, goalWeightKg, heightCm, profileWeightKg, range]
  );

  const handleReload = useCallback(() => {
    reload();
  }, [reload]);

  return {
    range,
    setRange,
    logs,
    rangeLogs,
    points,
    stats,
    months,
    latestLog: stats.latest,
    loading: Boolean(loading),
    error: formatError(error),
    reload: handleReload,
  };
}

export default useWeightHistory;
