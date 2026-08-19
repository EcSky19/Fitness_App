import type { WeightLog } from '@/types';
import { addDaysISO, todayISO } from '../dates';
import {
  bmi,
  bmiCategory,
  computeEMA,
  goalProgressPct,
  projectGoalDate,
  weightTrend,
} from '../weight';

function makeLog(date: string, weightKg: number, overrides: Partial<WeightLog> = {}): WeightLog {
  return {
    id: `w-${date}-${weightKg}`,
    date,
    weightKg,
    bodyFatPct: null,
    note: null,
    source: 'manual',
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
    ...overrides,
  };
}

/** n consecutive daily logs starting at `start`. */
function series(start: string, weights: number[]): WeightLog[] {
  return weights.map((w, i) => makeLog(addDaysISO(start, i), w));
}

describe('weight — computeEMA', () => {
  it('returns an empty array for no usable logs', () => {
    expect(computeEMA([])).toEqual([]);
    expect(computeEMA([makeLog('2025-01-01', 0)])).toEqual([]);
    expect(computeEMA([makeLog('2025-01-01', Number.NaN)])).toEqual([]);
  });

  it('seeds the EMA with the first weight', () => {
    const points = computeEMA(series('2025-01-01', [80, 81, 82]));
    expect(points[0].ema).toBe(80);
    expect(points[0].weightKg).toBe(80);
  });

  it('sorts ascending by date regardless of input order', () => {
    const points = computeEMA([
      makeLog('2025-01-03', 82),
      makeLog('2025-01-01', 80),
      makeLog('2025-01-02', 81),
    ]);
    expect(points.map((p) => p.date)).toEqual(['2025-01-01', '2025-01-02', '2025-01-03']);
    expect(points.map((p) => p.weightKg)).toEqual([80, 81, 82]);
  });

  it('collapses duplicate dates to the newest log for that day', () => {
    const points = computeEMA([
      makeLog('2025-01-01', 80, { createdAt: '2025-01-01T07:00:00.000Z' }),
      makeLog('2025-01-01', 79.2, { createdAt: '2025-01-01T21:00:00.000Z' }),
      makeLog('2025-01-02', 79),
    ]);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ date: '2025-01-01', weightKg: 79.2, ema: 79.2 });
  });

  it('smooths monotonically and lags the raw series', () => {
    const points = computeEMA(series('2025-01-01', [80, 81, 82, 83, 84]));
    const emas = points.map((p) => p.ema);
    // rising raw series -> rising but lagging EMA
    for (let i = 1; i < emas.length; i += 1) {
      expect(emas[i]).toBeGreaterThan(emas[i - 1]);
      expect(emas[i]).toBeLessThan(points[i].weightKg);
    }
    expect(emas[1]).toBeCloseTo(0.25 * 81 + 0.75 * 80, 6);
    expect(emas[2]).toBeCloseTo(0.25 * 82 + 0.75 * emas[1], 2);
  });

  it('dampens a single-day spike', () => {
    const points = computeEMA(series('2025-01-01', [80, 80, 85, 80]));
    expect(points[2].ema).toBeLessThan(82);
    expect(points[2].ema).toBeGreaterThan(80);
  });

  it('respects a custom alpha and falls back on invalid ones', () => {
    const logs = series('2025-01-01', [80, 90]);
    expect(computeEMA(logs, 1)[1].ema).toBe(90);
    expect(computeEMA(logs, 0.5)[1].ema).toBe(85);
    expect(computeEMA(logs, 0)[1].ema).toBe(computeEMA(logs)[1].ema);
    expect(computeEMA(logs, Number.NaN)[1].ema).toBe(computeEMA(logs)[1].ema);
    expect(computeEMA(logs, 5)[1].ema).toBe(computeEMA(logs)[1].ema);
  });
});

describe('weight — weightTrend', () => {
  it('detects an upward trend', () => {
    const trend = weightTrend(series('2025-01-01', [80, 80.5, 81, 81.5, 82, 82.5, 83]), 7);
    expect(trend.direction).toBe('up');
    expect(trend.changeKg).toBeGreaterThan(0);
    expect(trend.ratePerWeekKg).toBeGreaterThan(0);
  });

  it('detects a downward trend', () => {
    const trend = weightTrend(series('2025-01-01', [83, 82.5, 82, 81.5, 81, 80.5, 80]), 7);
    expect(trend.direction).toBe('down');
    expect(trend.changeKg).toBeLessThan(0);
    expect(trend.ratePerWeekKg).toBeLessThan(0);
  });

  it('reports flat for a stable weight', () => {
    const trend = weightTrend(series('2025-01-01', [80, 80, 80, 80, 80, 80, 80]), 7);
    expect(trend).toEqual({ changeKg: 0, ratePerWeekKg: 0, direction: 'flat' });
  });

  it('reports flat for noise below the threshold', () => {
    const trend = weightTrend(series('2025-01-01', [80, 80.05, 79.98, 80.02, 80]), 7);
    expect(trend.direction).toBe('flat');
  });

  it('only considers the requested window', () => {
    const logs = series('2025-01-01', [90, 89, 88, 87, 80, 80, 80]);
    const short = weightTrend(logs, 3);
    const long = weightTrend(logs, 7);
    expect(Math.abs(short.changeKg)).toBeLessThan(Math.abs(long.changeKg));
  });

  it('extrapolates the rate to a full week', () => {
    // -0.2 kg/day over 7 raw days, smoothed.
    const trend = weightTrend(series('2025-01-01', [82, 81.8, 81.6, 81.4, 81.2, 81, 80.8]), 7);
    expect(trend.ratePerWeekKg).toBeLessThan(0);
    expect(trend.ratePerWeekKg).toBeGreaterThan(-1.4);
  });

  it('is safe with empty / single-entry input', () => {
    const flat = { changeKg: 0, ratePerWeekKg: 0, direction: 'flat' };
    expect(weightTrend([], 7)).toEqual(flat);
    expect(weightTrend([makeLog('2025-01-01', 80)], 7)).toEqual(flat);
    expect(weightTrend(series('2025-01-01', [80, 81]), Number.NaN)).toBeDefined();
  });
});

describe('weight — projectGoalDate', () => {
  it('projects a future date when losing toward a lower goal', () => {
    const projected = projectGoalDate(80, 75, -0.5);
    expect(projected).not.toBeNull();
    // 5 kg at 0.5 kg/week = 10 weeks = 70 days
    expect(projected).toBe(addDaysISO(todayISO(), 70));
  });

  it('projects a future date when gaining toward a higher goal', () => {
    expect(projectGoalDate(70, 72, 0.25)).toBe(addDaysISO(todayISO(), 56));
  });

  it('returns null when the rate is zero', () => {
    expect(projectGoalDate(80, 75, 0)).toBeNull();
    expect(projectGoalDate(80, 75, Number.NaN)).toBeNull();
  });

  it('returns null when moving away from the goal', () => {
    expect(projectGoalDate(80, 75, 0.5)).toBeNull(); // gaining while wanting to lose
    expect(projectGoalDate(70, 75, -0.5)).toBeNull(); // losing while wanting to gain
  });

  it('returns today when the goal is already met', () => {
    expect(projectGoalDate(75, 75, -0.5)).toBe(todayISO());
    expect(projectGoalDate(75.01, 75, 0)).toBe(todayISO());
  });

  it('returns null for absurdly distant projections', () => {
    expect(projectGoalDate(200, 70, -0.001)).toBeNull();
  });
});

describe('weight — goalProgressPct', () => {
  it('measures progress along the start -> goal journey', () => {
    expect(goalProgressPct(90, 90, 80)).toBe(0);
    expect(goalProgressPct(90, 85, 80)).toBeCloseTo(0.5, 10);
    expect(goalProgressPct(90, 80, 80)).toBe(1);
    expect(goalProgressPct(70, 75, 80)).toBeCloseTo(0.5, 10);
  });

  it('clamps to 0..1', () => {
    expect(goalProgressPct(90, 75, 80)).toBe(1); // overshot the goal
    expect(goalProgressPct(90, 95, 80)).toBe(0); // moved backwards
  });

  it('handles start === goal', () => {
    expect(goalProgressPct(80, 80, 80)).toBe(1);
    expect(goalProgressPct(80, 85, 80)).toBe(1);
  });

  it('is NaN safe', () => {
    expect(Number.isFinite(goalProgressPct(Number.NaN, 80, 75))).toBe(true);
  });
});

describe('weight — BMI', () => {
  it('computes a known BMI', () => {
    expect(bmi(80, 180)).toBeCloseTo(24.7, 1);
    expect(bmi(60, 165)).toBeCloseTo(22, 1);
    expect(bmi(100, 170)).toBeCloseTo(34.6, 1);
  });

  it('guards against a zero or invalid height', () => {
    expect(bmi(80, 0)).toBe(0);
    expect(bmi(80, Number.NaN)).toBe(0);
    expect(bmi(Number.NaN, 180)).toBe(0);
  });

  it('categorises BMI at the WHO cut-offs', () => {
    expect(bmiCategory(17)).toBe('underweight');
    expect(bmiCategory(18.4)).toBe('underweight');
    expect(bmiCategory(18.5)).toBe('normal');
    expect(bmiCategory(24.9)).toBe('normal');
    expect(bmiCategory(25)).toBe('overweight');
    expect(bmiCategory(29.9)).toBe('overweight');
    expect(bmiCategory(30)).toBe('obese');
    expect(bmiCategory(45)).toBe('obese');
    expect(bmiCategory(bmi(80, 180))).toBe('normal');
  });
});
