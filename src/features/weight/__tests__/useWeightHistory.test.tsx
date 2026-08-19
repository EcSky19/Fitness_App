import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAppStore } from '@/store/appStore';
import type { WeightLog } from '@/types';

import {
  buildTrendPoints,
  changeOverDays,
  deltaTone,
  deriveStats,
  filterLogsByRange,
  groupByMonth,
  resolveRangeDays,
  toneColor,
  useWeightHistory,
} from '../useWeightHistory';
import { makeProfile, makeWeightLog } from '../testSupport';

jest.mock('@/db/repositories', () => require('../testSupport').repositoriesMockFactory());

const repos = jest.requireMock('@/db/repositories') as { listWeightLogs: jest.Mock };

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function log(daysAgo: number, weightKg: number, extra: Partial<WeightLog> = {}): WeightLog {
  return makeWeightLog({ date: isoDaysAgo(daysAgo), weightKg, ...extra });
}

/** Fails when any numeric field is NaN/Infinity. */
function expectNoNaN(value: unknown, path = 'stats'): void {
  if (typeof value === 'number') {
    expect([path, Number.isFinite(value)]).toEqual([path, true]);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'latest' || key === 'previous') continue;
      expectNoNaN(child, `${path}.${key}`);
    }
  }
}

const CUTTING_LOGS = [log(28, 82), log(21, 81.5), log(14, 81), log(6, 80.5), log(0, 80)];

beforeEach(() => {
  repos.listWeightLogs.mockResolvedValue([]);
  useAppStore.setState({ profile: null, dataVersion: 0 });
});

describe('filterLogsByRange', () => {
  const logs = [log(0, 80), log(3, 81), log(10, 82), log(45, 83), log(200, 84), log(400, 85)];

  it.each([
    ['7D' as const, 2],
    ['30D' as const, 3],
    ['90D' as const, 4],
    ['1Y' as const, 5],
    ['ALL' as const, 6],
  ])('keeps the right logs for %s', (range, expected) => {
    expect(filterLogsByRange(logs, range)).toHaveLength(expected);
  });

  it('returns logs oldest first', () => {
    const filtered = filterLogsByRange(logs, 'ALL');
    expect(filtered.map((entry) => entry.date)).toEqual(
      [...filtered.map((entry) => entry.date)].sort()
    );
  });

  it('excludes very old logs from a range but keeps them available', () => {
    const chart = filterLogsByRange(logs, '30D');
    expect(chart.some((entry) => entry.date === isoDaysAgo(400))).toBe(false);
    expect(filterLogsByRange(logs, 'ALL')).toHaveLength(6);
  });
});

describe('resolveRangeDays', () => {
  it('uses the fixed window for bounded ranges', () => {
    expect(resolveRangeDays('7D', CUTTING_LOGS)).toBe(7);
    expect(resolveRangeDays('1Y', CUTTING_LOGS)).toBe(365);
  });

  it('spans the full history for ALL and is null without logs', () => {
    expect(resolveRangeDays('ALL', CUTTING_LOGS)).toBe(29);
    expect(resolveRangeDays('ALL', [])).toBeNull();
  });
});

describe('buildTrendPoints', () => {
  it('handles zero and one data point', () => {
    expect(buildTrendPoints([])).toEqual([]);
    const single = buildTrendPoints([log(0, 80)]);
    expect(single).toHaveLength(1);
    expect(single[0].ema).toBe(80);
  });

  it('exposes an EMA for every raw point', () => {
    const points = buildTrendPoints(CUTTING_LOGS);
    expect(points).toHaveLength(CUTTING_LOGS.length);
    points.forEach((point) => {
      expect(Number.isFinite(point.ema)).toBe(true);
      expect(Number.isFinite(point.weightKg)).toBe(true);
    });
    // The trend lags the raw series, so it stays above it while cutting.
    expect(points[points.length - 1].ema).toBeGreaterThan(
      points[points.length - 1].weightKg - 0.0001
    );
  });
});

describe('changeOverDays', () => {
  it('is null with fewer than two logs in the window', () => {
    expect(changeOverDays([log(0, 80)], 7)).toBeNull();
    expect(changeOverDays([log(40, 80), log(35, 81)], 7)).toBeNull();
  });

  it('is last minus first inside the window', () => {
    expect(changeOverDays(CUTTING_LOGS, 7)).toBeCloseTo(-0.5, 5);
    expect(changeOverDays(CUTTING_LOGS, 30)).toBeCloseTo(-2, 5);
  });
});

describe('deltaTone', () => {
  it('treats losing as good while cutting and bad while bulking', () => {
    expect(deltaTone(-1, 70, 80)).toBe('good');
    expect(deltaTone(1, 70, 80)).toBe('bad');
    expect(deltaTone(-1, 90, 80)).toBe('bad');
    expect(deltaTone(1, 90, 80)).toBe('good');
  });

  it('is neutral without a goal, at the goal, or for a flat change', () => {
    expect(deltaTone(-1, null, 80)).toBe('neutral');
    expect(deltaTone(-1, 80, 80)).toBe('neutral');
    expect(deltaTone(0, 70, 80)).toBe('neutral');
    expect(deltaTone(null, 70, 80)).toBe('neutral');
  });

  it('maps tones to palette colours', () => {
    const colors = { success: '#0f0', danger: '#f00', textMuted: '#888' };
    expect(toneColor('good', colors)).toBe('#0f0');
    expect(toneColor('bad', colors)).toBe('#f00');
    expect(toneColor('neutral', colors)).toBe('#888');
  });
});

describe('deriveStats', () => {
  const base = {
    goalKg: 70,
    heightCm: 170,
    profileWeightKg: 80,
    rateDays: 30,
  };

  it('falls back to the profile weight with no logs and never returns NaN', () => {
    const stats = deriveStats({ ...base, logs: [], rangeLogs: [], rateDays: null });
    expect(stats.logCount).toBe(0);
    expect(stats.currentKg).toBe(80);
    expect(stats.startKg).toBe(80);
    expect(stats.changeSinceLastKg).toBeNull();
    expect(stats.rangeChangeKg).toBeNull();
    expect(stats.change7dKg).toBeNull();
    expect(stats.ratePerWeekKg).toBeNull();
    expect(stats.projectedGoalDate).toBeNull();
    expectNoNaN(stats);
  });

  it('reports no trend or rate with exactly one log', () => {
    const logs = [log(0, 79)];
    const stats = deriveStats({ ...base, logs, rangeLogs: logs });
    expect(stats.currentKg).toBe(79);
    expect(stats.changeSinceLastKg).toBeNull();
    expect(stats.change7dKg).toBeNull();
    expect(stats.change30dKg).toBeNull();
    expect(stats.ratePerWeekKg).toBeNull();
    expect(stats.direction).toBeNull();
    expect(stats.projectedGoalDate).toBeNull();
    expectNoNaN(stats);
  });

  it('derives changes, rate and projection from many logs', () => {
    const stats = deriveStats({ ...base, logs: CUTTING_LOGS, rangeLogs: CUTTING_LOGS });
    expect(stats.logCount).toBe(5);
    expect(stats.currentKg).toBe(80);
    expect(stats.startKg).toBe(82);
    expect(stats.changeSinceLastKg).toBeCloseTo(-0.5, 5);
    expect(stats.rangeChangeKg).toBeCloseTo(-2, 5);
    expect(stats.change7dKg).toBeCloseTo(-0.5, 5);
    expect(stats.change30dKg).toBeCloseTo(-2, 5);
    // The rate is derived from the smoothed series, so it lags the raw change.
    expect(stats.ratePerWeekKg).toBeLessThan(0);
    expect(stats.ratePerWeekKg).toBeGreaterThan(-1);
    expect(stats.direction).toBe('down');
    expect(stats.projectedGoalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stats.remainingKg).toBeCloseTo(-10, 5);
    expect(stats.bmi).toBeCloseTo(27.68, 1);
    expect(stats.bmiCategory).toBe('overweight');
    expectNoNaN(stats);
  });

  it('gives no projection for a flat trend', () => {
    const flat = [log(21, 80), log(14, 80), log(7, 80), log(0, 80)];
    const stats = deriveStats({ ...base, logs: flat, rangeLogs: flat });
    expect(stats.ratePerWeekKg).toBe(0);
    expect(stats.direction).toBe('flat');
    expect(stats.projectedGoalDate).toBeNull();
    expectNoNaN(stats);
  });

  it('reports 100% and no divide-by-zero when the goal equals the current weight', () => {
    const logs = [log(7, 70), log(0, 70)];
    const stats = deriveStats({ ...base, logs, rangeLogs: logs, goalKg: 70, profileWeightKg: 70 });
    expect(stats.progressPct).toBe(100);
    expect(stats.remainingKg).toBe(0);
    expectNoNaN(stats);
  });

  it('expresses progress as a percentage of the start -> goal journey', () => {
    const stats = deriveStats({ ...base, logs: CUTTING_LOGS, rangeLogs: CUTTING_LOGS });
    expect(stats.progressPct).toBeCloseTo(16.67, 1);
  });

  it('inverts direction detection when bulking', () => {
    const bulking = [log(14, 70), log(7, 70.5), log(0, 71)];
    const stats = deriveStats({ ...base, logs: bulking, rangeLogs: bulking, goalKg: 80 });
    expect(stats.isBulking).toBe(true);
    expect(stats.direction).toBe('up');
    expect(deltaTone(stats.changeSinceLastKg, stats.goalKg, stats.currentKg)).toBe('good');
    expect(stats.remainingKg).toBeCloseTo(9, 5);
    expectNoNaN(stats);
  });

  it('clamps progress between 0 and 100', () => {
    const overshoot = [log(7, 60)];
    const stats = deriveStats({
      ...base,
      logs: overshoot,
      rangeLogs: overshoot,
      profileWeightKg: 80,
    });
    expect(stats.progressPct).toBeLessThanOrEqual(100);
    expect(stats.progressPct).toBeGreaterThanOrEqual(0);
  });

  it('skips BMI without a height', () => {
    const stats = deriveStats({ ...base, logs: CUTTING_LOGS, rangeLogs: CUTTING_LOGS, heightCm: null });
    expect(stats.bmi).toBeNull();
    expect(stats.bmiCategory).toBeNull();
  });
});

describe('groupByMonth', () => {
  it('groups newest month first with newest logs first', () => {
    const logs = [
      makeWeightLog({ id: 'a', date: '2026-01-04', weightKg: 82 }),
      makeWeightLog({ id: 'b', date: '2026-02-02', weightKg: 81 }),
      makeWeightLog({ id: 'c', date: '2026-02-18', weightKg: 80 }),
    ];
    const sections = groupByMonth(logs);
    expect(sections.map((section) => section.label)).toEqual(['February 2026', 'January 2026']);
    expect(sections[0].logs.map((entry) => entry.id)).toEqual(['c', 'b']);
    expect(sections[1].logs).toHaveLength(1);
  });

  it('returns nothing for an empty history', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe('useWeightHistory', () => {
  it('sorts logs oldest first and derives stats from the profile goal', async () => {
    repos.listWeightLogs.mockResolvedValue([...CUTTING_LOGS].reverse());
    useAppStore.setState({ profile: makeProfile({ goalWeightKg: 70, heightCm: 170 }) });

    const { result } = renderHook(() => useWeightHistory('30D'));

    await waitFor(() => expect(result.current.logs).toHaveLength(5));
    expect(result.current.logs[0].date).toBe(isoDaysAgo(28));
    expect(result.current.stats.currentKg).toBe(80);
    expect(result.current.stats.goalKg).toBe(70);
    expect(result.current.points).toHaveLength(5);
    expect(result.current.months.length).toBeGreaterThan(0);
  });

  it('re-filters the chart when the range changes but keeps the full history', async () => {
    repos.listWeightLogs.mockResolvedValue([log(0, 80), log(3, 81), log(200, 90)]);

    const { result } = renderHook(() => useWeightHistory('7D'));

    await waitFor(() => expect(result.current.logs).toHaveLength(3));
    expect(result.current.rangeLogs).toHaveLength(2);

    act(() => result.current.setRange('ALL'));
    expect(result.current.rangeLogs).toHaveLength(3);
    expect(result.current.logs).toHaveLength(3);
  });

  it('survives an empty history', async () => {
    repos.listWeightLogs.mockResolvedValue([]);
    const { result } = renderHook(() => useWeightHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.logs).toEqual([]);
    expect(result.current.points).toEqual([]);
    expect(result.current.stats.currentKg).toBeNull();
    expectNoNaN(result.current.stats);
  });
});
