/**
 * Regression tests for the synthesized "Daily activity" entry.
 *
 * A day with no workouts gets one synthetic row carrying the day's active
 * energy. If a workout shows up later that row has to go, otherwise the day
 * counts its calories twice.
 */
import type {
  HealthDaySummary,
  HealthPermissionStatus,
  HealthService,
  HealthWorkout,
  ISODate,
} from '@/types';

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { setHealthService } from '@/services/health';
import { syncHealthDay, syncHealthRange } from '../sync';

interface Row extends Record<string, unknown> {
  id: string;
  date: string;
  externalId: string;
  caloriesBurned: number;
}

const rows = new Map<string, Row>();

const mockUpsert = jest.fn(async (input: Record<string, unknown>) => {
  const externalId = String(input.externalId);
  const row: Row = {
    ...input,
    id: `row:${externalId}`,
    date: String(input.date),
    externalId,
    caloriesBurned: Number(input.caloriesBurned),
  };
  rows.set(row.id, row);
  return row;
});

const mockList = jest.fn(async (date: string) => [...rows.values()].filter((r) => r.date === date));
const mockDelete = jest.fn(async (id: string) => {
  rows.delete(id);
});

jest.mock('@/db/repositories', () => ({
  upsertExternalExercise: (input: Record<string, unknown>) => mockUpsert(input),
  listExercisesByDate: (date: string) => mockList(date),
  deleteExerciseEntry: (id: string) => mockDelete(id),
}));

const DATE: ISODate = '2026-03-10';

function summary(overrides: Partial<HealthDaySummary> = {}): HealthDaySummary {
  return {
    date: DATE,
    steps: 9500,
    activeEnergyKcal: 520,
    restingEnergyKcal: 1650,
    exerciseMinutes: 0,
    distanceMeters: 7239,
    workouts: [],
    ...overrides,
  };
}

function workout(overrides: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    externalId: 'hk:workout-1',
    name: 'Evening Run',
    category: 'cardio',
    startAt: `${DATE}T18:15:00.000Z`,
    durationMin: 42,
    caloriesBurned: 430,
    ...overrides,
  };
}

function stubService(day: (date: ISODate) => HealthDaySummary): HealthService {
  return {
    platform: 'healthkit',
    isAvailable: async () => true,
    getPermissionStatus: async (): Promise<HealthPermissionStatus> => 'granted',
    requestPermissions: async (): Promise<HealthPermissionStatus> => 'granted',
    getDaySummary: async (date: ISODate) => day(date),
    getRange: async () => [],
    getLatestWeightKg: async () => 74.8,
    writeWeight: async () => true,
  };
}

function burnedOn(date: string): number {
  return [...rows.values()]
    .filter((r) => r.date === date)
    .reduce((sum, r) => sum + r.caloriesBurned, 0);
}

beforeEach(() => {
  rows.clear();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, healthSyncEnabled: true } });
});

afterEach(() => {
  setHealthService(null);
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe('daily-activity reconciliation', () => {
  it('removes the synthetic entry once a real workout appears on the same day', async () => {
    // Morning: no workouts yet, so the day's active energy is synthesized.
    const morning = await syncHealthDay(DATE, stubService(() => summary()));
    expect(morning.ok).toBe(true);
    expect([...rows.values()].map((r) => r.externalId)).toEqual([`daily-activity-${DATE}`]);
    expect(burnedOn(DATE)).toBe(520);

    // Evening: the platform now reports the run for that same day.
    const evening = await syncHealthDay(
      DATE,
      stubService(() => summary({ workouts: [workout()], exerciseMinutes: 42 }))
    );

    expect(evening.ok).toBe(true);
    expect([...rows.values()].map((r) => r.externalId)).toEqual(['hk:workout-1']);
    // 430, not 950: the stale synthetic row must not survive.
    expect(burnedOn(DATE)).toBe(430);
  });

  it('keeps refreshing the synthetic entry while the day still has no workouts', async () => {
    const service = stubService(() => summary());

    await syncHealthDay(DATE, service);
    await syncHealthDay(DATE, service);

    expect(rows.size).toBe(1);
    expect(burnedOn(DATE)).toBe(520);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('never deletes a user-logged or workout row', async () => {
    rows.set('row:manual', {
      id: 'row:manual',
      date: DATE,
      externalId: '',
      caloriesBurned: 300,
    });

    await syncHealthDay(DATE, stubService(() => summary({ workouts: [workout()] })));

    expect(rows.has('row:manual')).toBe(true);
    expect(mockDelete).not.toHaveBeenCalledWith('row:manual');
  });

  it('reconciles every day of a range independently', async () => {
    const first: ISODate = '2026-03-08';
    const second: ISODate = '2026-03-09';

    await syncHealthRange(first, second, stubService((date) => summary({ date })));
    expect(rows.size).toBe(2);

    await syncHealthRange(
      first,
      second,
      stubService((date) =>
        date === first
          ? summary({ date, workouts: [workout({ externalId: `hk:${date}` })] })
          : summary({ date })
      )
    );

    expect(burnedOn(first)).toBe(430);
    expect(burnedOn(second)).toBe(520);
  });

  it('still succeeds when the repository exposes no delete helper', async () => {
    mockList.mockRejectedValueOnce(new Error('not available'));

    const result = await syncHealthDay(
      DATE,
      stubService(() => summary({ workouts: [workout()] }))
    );

    expect(result.ok).toBe(true);
    expect(result.data?.importedWorkouts).toBe(1);
  });
});
