import { MockHealthService, buildMockDaySummary, createMockHealthService } from '../mockHealth';
import { METERS_PER_STEP, addDaysISO, todayISO } from '../types';

/** Fixed reference "today" so future-date behaviour is deterministic. */
const TODAY = '2026-03-11'; // Wednesday
const NOW = new Date(2026, 2, 11, 10, 0, 0, 0);

const WEEKDAYS = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-02-26', '2026-01-13'];
const WEEKENDS = ['2026-03-07', '2026-03-08', '2026-02-28', '2026-03-01', '2026-01-10'];

describe('buildMockDaySummary', () => {
  it('is deterministic: the same date always yields the same summary', () => {
    for (const date of [...WEEKDAYS, ...WEEKENDS]) {
      const first = buildMockDaySummary(date, NOW);
      const second = buildMockDaySummary(date, NOW);
      expect(second).toEqual(first);
    }
  });

  it('stays within the documented ranges', () => {
    for (const date of [...WEEKDAYS, ...WEEKENDS]) {
      const summary = buildMockDaySummary(date, NOW);
      expect(summary.date).toBe(date);
      expect(summary.steps).toBeGreaterThanOrEqual(3000);
      expect(summary.steps).toBeLessThanOrEqual(14000);
      expect(summary.activeEnergyKcal).toBeGreaterThanOrEqual(150);
      expect(summary.activeEnergyKcal).toBeLessThanOrEqual(750);
      expect(summary.restingEnergyKcal).toBeGreaterThanOrEqual(1500);
      expect(summary.restingEnergyKcal).toBeLessThanOrEqual(1800);
      expect(summary.exerciseMinutes).toBeGreaterThanOrEqual(0);
      expect(summary.exerciseMinutes).toBeLessThanOrEqual(75);
      expect(summary.distanceMeters).toBe(Math.round(summary.steps * METERS_PER_STEP));
    }
  });

  it('returns zeros for future dates', () => {
    const tomorrow = addDaysISO(TODAY, 1) as string;
    const nextWeek = addDaysISO(TODAY, 7) as string;

    for (const date of [tomorrow, nextWeek]) {
      const summary = buildMockDaySummary(date, NOW);
      expect(summary).toEqual({
        date,
        steps: 0,
        activeEnergyKcal: 0,
        restingEnergyKcal: 0,
        exerciseMinutes: 0,
        distanceMeters: 0,
        workouts: [],
      });
    }
  });

  it('returns zeros for malformed dates', () => {
    expect(buildMockDaySummary('not-a-date', NOW).steps).toBe(0);
    expect(buildMockDaySummary('2026-02-30', NOW).workouts).toHaveLength(0);
  });

  it('produces fewer steps at the weekend than on weekdays', () => {
    const average = (dates: string[]): number =>
      dates.reduce((sum, date) => sum + buildMockDaySummary(date, NOW).steps, 0) / dates.length;

    expect(average(WEEKENDS)).toBeLessThan(average(WEEKDAYS));
  });

  it('correlates active energy with steps', () => {
    const summaries = [...WEEKDAYS, ...WEEKENDS]
      .map((date) => buildMockDaySummary(date, NOW))
      .sort((a, b) => a.steps - b.steps);

    const lowest = summaries[0];
    const highest = summaries[summaries.length - 1];
    expect(highest.activeEnergyKcal).toBeGreaterThan(lowest.activeEnergyKcal);
  });

  it('keeps workouts consistent with exercise minutes and active energy', () => {
    for (const date of [...WEEKDAYS, ...WEEKENDS]) {
      const summary = buildMockDaySummary(date, NOW);
      expect(summary.workouts.length).toBeLessThanOrEqual(2);

      if (summary.exerciseMinutes === 0) {
        expect(summary.workouts).toHaveLength(0);
        continue;
      }

      const totalMinutes = summary.workouts.reduce((sum, w) => sum + w.durationMin, 0);
      const totalCalories = summary.workouts.reduce((sum, w) => sum + w.caloriesBurned, 0);

      expect(totalMinutes).toBeLessThanOrEqual(summary.exerciseMinutes);
      expect(totalCalories).toBeLessThanOrEqual(summary.activeEnergyKcal);

      for (const workout of summary.workouts) {
        expect(workout.externalId).toMatch(/^mock-\d{4}-\d{2}-\d{2}-\d+$/);
        expect(workout.name.length).toBeGreaterThan(0);
        expect(workout.durationMin).toBeGreaterThan(0);
        expect(workout.caloriesBurned).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(workout.startAt))).toBe(false);
      }

      const ids = summary.workouts.map((w) => w.externalId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('generates workouts across a week', () => {
    const week = [...WEEKDAYS, ...WEEKENDS].flatMap(
      (date) => buildMockDaySummary(date, NOW).workouts
    );
    expect(week.length).toBeGreaterThan(0);
  });
});

describe('MockHealthService', () => {
  it('is available and reports the mock platform', async () => {
    const service = createMockHealthService({ now: () => NOW });
    expect(service.platform).toBe('mock');
    await expect(service.isAvailable()).resolves.toBe(true);
  });

  it('moves from undetermined to granted after requesting permissions', async () => {
    const service = createMockHealthService({ now: () => NOW });

    await expect(service.getPermissionStatus()).resolves.toBe('undetermined');
    await expect(service.requestPermissions()).resolves.toBe('granted');
    await expect(service.getPermissionStatus()).resolves.toBe('granted');
  });

  it('keeps permission state per instance', async () => {
    const granted = createMockHealthService({ now: () => NOW });
    await granted.requestPermissions();

    const fresh = createMockHealthService({ now: () => NOW });
    await expect(fresh.getPermissionStatus()).resolves.toBe('undetermined');
  });

  it('returns the same day summary on repeated reads', async () => {
    const service = createMockHealthService({ now: () => NOW });
    const first = await service.getDaySummary(TODAY);
    const second = await service.getDaySummary(TODAY);
    expect(second).toEqual(first);
  });

  it('returns an inclusive ascending range', async () => {
    const service = createMockHealthService({ now: () => NOW });
    const range = await service.getRange('2026-03-09', TODAY);

    expect(range.map((day) => day.date)).toEqual(['2026-03-09', '2026-03-10', '2026-03-11']);
    expect(range[2]).toEqual(await service.getDaySummary(TODAY));
  });

  it('exposes a stable weight and accepts writes', async () => {
    const service = new MockHealthService({ now: () => NOW });

    const first = await service.getLatestWeightKg();
    const second = await service.getLatestWeightKg();
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(30);

    await expect(service.writeWeight(80.2, todayISO(NOW))).resolves.toBe(true);
    await expect(service.getLatestWeightKg()).resolves.toBe(80.2);
    await expect(service.writeWeight(-1, todayISO(NOW))).resolves.toBe(false);
  });
});
