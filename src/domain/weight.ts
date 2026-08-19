/**
 * Bodyweight analytics: EMA smoothing, trend, projection, progress and BMI.
 *
 * Pure TypeScript: no React Native, no Expo, no I/O.
 */
import type { ISODate, WeightLog } from '@/types';
import { addDaysISO, diffDaysISO, todayISO } from './dates';
import { clamp, roundTo, toFiniteNumber } from './units';

export interface WeightPoint {
  date: ISODate;
  weightKg: number;
  ema: number;
}

/** Default smoothing factor for the weight trend line. */
export const DEFAULT_EMA_ALPHA = 0.25;

/** |change| below this (kg) counts as "flat". */
export const FLAT_TREND_THRESHOLD_KG = 0.1;

/** Longest projection we are willing to return (~10 years). */
const MAX_PROJECTION_DAYS = 3650;

/**
 * Exponentially weighted moving average of the weight logs.
 *
 * Sorted ascending by date, duplicate dates collapse to the *last* log for that
 * day (newest `createdAt` wins), and the EMA is seeded with the first weight so
 * the series always starts on the real measurement.
 */
export function computeEMA(logs: WeightLog[], alpha: number = DEFAULT_EMA_ALPHA): WeightPoint[] {
  const rawAlpha = toFiniteNumber(alpha, DEFAULT_EMA_ALPHA);
  const a = rawAlpha > 0 && rawAlpha <= 1 ? rawAlpha : DEFAULT_EMA_ALPHA;

  const usable = (Array.isArray(logs) ? logs : [])
    .filter(
      (log): log is WeightLog =>
        !!log && typeof log.date === 'string' && toFiniteNumber(log.weightKg) > 0,
    )
    .map((log, index) => ({ log, index }));

  usable.sort((x, y) => {
    if (x.log.date !== y.log.date) return x.log.date < y.log.date ? -1 : 1;
    const cx = x.log.createdAt ?? '';
    const cy = y.log.createdAt ?? '';
    if (cx !== cy) return cx < cy ? -1 : 1;
    return x.index - y.index;
  });

  const byDate = new Map<ISODate, number>();
  for (const { log } of usable) byDate.set(log.date, toFiniteNumber(log.weightKg));

  const out: WeightPoint[] = [];
  let ema = 0;
  let seeded = false;
  for (const [date, weightKg] of byDate) {
    ema = seeded ? a * weightKg + (1 - a) * ema : weightKg;
    seeded = true;
    out.push({ date, weightKg: roundTo(weightKg, 2), ema: roundTo(ema, 2) });
  }
  return out;
}

/**
 * Change over the last `days` days, measured on the smoothed series and
 * anchored to the most recent log (so a stale log set still reports its trend).
 */
export function weightTrend(
  logs: WeightLog[],
  days: number,
): { changeKg: number; ratePerWeekKg: number; direction: 'up' | 'down' | 'flat' } {
  const flat = { changeKg: 0, ratePerWeekKg: 0, direction: 'flat' as const };
  const series = computeEMA(logs);
  if (series.length < 2) return flat;

  const span = Math.max(1, Math.trunc(toFiniteNumber(days, 1)));
  const anchor = series[series.length - 1].date;
  const windowStart = addDaysISO(anchor, -(span - 1));
  const windowed = series.filter((point) => point.date >= windowStart);
  if (windowed.length < 2) return flat;

  const first = windowed[0];
  const last = windowed[windowed.length - 1];
  const changeKg = roundTo(last.ema - first.ema, 2);
  const elapsedDays = diffDaysISO(last.date, first.date);
  const ratePerWeekKg = elapsedDays > 0 ? roundTo((changeKg / elapsedDays) * 7, 2) : 0;

  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (changeKg > FLAT_TREND_THRESHOLD_KG) direction = 'up';
  else if (changeKg < -FLAT_TREND_THRESHOLD_KG) direction = 'down';

  return { changeKg, ratePerWeekKg, direction };
}

/**
 * Date the goal weight is reached at the given weekly rate.
 * `null` when the rate is zero or points away from the goal.
 */
export function projectGoalDate(
  currentKg: number,
  goalKg: number,
  ratePerWeekKg: number,
): ISODate | null {
  const current = toFiniteNumber(currentKg);
  const goal = toFiniteNumber(goalKg);
  const rate = toFiniteNumber(ratePerWeekKg);

  const delta = goal - current;
  if (Math.abs(delta) < 0.05) return todayISO();
  if (rate === 0) return null;
  if (Math.sign(delta) !== Math.sign(rate)) return null;

  const days = Math.ceil((delta / rate) * 7);
  if (!Number.isFinite(days) || days <= 0 || days > MAX_PROJECTION_DAYS) return null;
  return addDaysISO(todayISO(), days);
}

/** Fraction of the start -> goal journey completed, clamped to `0..1`. */
export function goalProgressPct(startKg: number, currentKg: number, goalKg: number): number {
  const start = toFiniteNumber(startKg);
  const current = toFiniteNumber(currentKg);
  const goal = toFiniteNumber(goalKg);

  const total = goal - start;
  if (Math.abs(total) < 1e-9) return 1;
  return clamp((current - start) / total, 0, 1);
}

/** Body mass index (kg/m^2), rounded to 1 dp. `0` when the height is unusable. */
export function bmi(weightKg: number, heightCm: number): number {
  const kg = Math.max(0, toFiniteNumber(weightKg));
  const meters = Math.max(0, toFiniteNumber(heightCm)) / 100;
  if (meters <= 0) return 0;
  return roundTo(kg / (meters * meters), 1);
}

export function bmiCategory(value: number): 'underweight' | 'normal' | 'overweight' | 'obese' {
  const v = toFiniteNumber(value);
  if (v < 18.5) return 'underweight';
  if (v < 25) return 'normal';
  if (v < 30) return 'overweight';
  return 'obese';
}
