import type {
  HealthDaySummary,
  HealthPermissionStatus,
  HealthService,
  HealthWorkout,
  ISODate,
} from '@/types';

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { resetHealthService, setHealthService } from '@/services/health';
import { createMockHealthService } from '../mockHealth';
import { syncHealthDay, syncHealthRange } from '../sync';
import { addDaysISO, todayISO } from '../types';

/** In-memory stand-in for the exercise repository, keyed by externalId like the real one. */
const mockRows = new Map<string, Record<string, unknown>>();
const mockUpsert = jest.fn(async (input: Record<string, unknown>) => {
  const externalId = String(input.externalId);
  mockRows.set(externalId, { ...input });
  return { id: externalId };
});

jest.mock('@/db/repositories', () => ({
  upsertExternalExercise: (input: Record<string, unknown>) => mockUpsert(input),
}));

const DATE: ISODate = '2026-03-10';

function workout(overrides: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    externalId: 'hk:workout-1',
    name: 'Morning Run',
    category: 'cardio',
    startAt: `${DATE}T07:15:00.000Z`,
    durationMin: 42,
    caloriesBurned: 430,
    ...overrides,
  };
}

function summary(overrides: Partial<HealthDaySummary> = {}): HealthDaySummary {
  return {
    date: DATE,
    steps: 9500,
    activeEnergyKcal: 520,
    restingEnergyKcal: 1650,
    exerciseMinutes: 42,
    distanceMeters: 7239,
    workouts: [workout()],
    ...overrides,
  };
}

interface StubOptions {
  permission?: HealthPermissionStatus;
  platform?: HealthService['platform'];
  day?: (date: ISODate) => HealthDaySummary;
  throwOnDay?: boolean;
}

function stubService(options: StubOptions = {}): HealthService {
  const { permission = 'granted', platform = 'healthkit', day, throwOnDay } = options;
  return {
    platform,
    isAvailable: async () => true,
    getPermissionStatus: async (): Promise<HealthPermissionStatus> => permission,
    requestPermissions: async (): Promise<HealthPermissionStatus> => permission,
    getDaySummary: async (date: ISODate) => {
      if (throwOnDay) throw new Error('HealthKit exploded');
      return day ? day(date) : summary({ date });
    },
    getRange: async () => [],
    getLatestWeightKg: async () => 74.8,
    writeWeight: async () => true,
  };
}

beforeEach(() => {
  mockRows.clear();
  resetHealthService();
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, healthSyncEnabled: true } });
});

afterEach(() => {
  setHealthService(null);
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe('syncHealthDay', () => {
  it('imports the workouts reported by the platform', async () => {
    const result = await syncHealthDay(DATE, stubService());

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ importedWorkouts: 1, activeEnergyKcal: 520, steps: 9500 });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        date: DATE,
        name: 'Morning Run',
        category: 'cardio',
        durationMin: 42,
        caloriesBurned: 430,
        source: 'healthkit',
        externalId: 'hk:workout-1',
      })
    );
  });

  it('tags Health Connect entries with the right source', async () => {
    await syncHealthDay(DATE, stubService({ platform: 'health_connect' }));
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ source: 'health_connect' }));
  });

  it('is idempotent across repeated runs', async () => {
    const service = stubService();

    const first = await syncHealthDay(DATE, service);
    const second = await syncHealthDay(DATE, service);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.data?.importedWorkouts).toBe(first.data?.importedWorkouts);
    // Two runs, two upserts, but still a single row: the externalId dedupes.
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockRows.size).toBe(1);
    expect([...mockRows.keys()]).toEqual(['hk:workout-1']);
  });

  it('synthesises a Daily activity entry when there are no workouts', async () => {
    const service = stubService({
      day: (date) => summary({ date, workouts: [], exerciseMinutes: 0 }),
    });

    const result = await syncHealthDay(DATE, service);

    expect(result.ok).toBe(true);
    expect(result.data?.importedWorkouts).toBe(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Daily activity',
        externalId: `daily-activity-${DATE}`,
        caloriesBurned: 520,
      })
    );

    await syncHealthDay(DATE, service);
    expect(mockRows.size).toBe(1);
  });

  it('writes nothing when the day is empty', async () => {
    const service = stubService({
      day: (date) =>
        summary({ date, workouts: [], exerciseMinutes: 0, activeEnergyKcal: 0, steps: 0 }),
    });

    const result = await syncHealthDay(DATE, service);

    expect(result.ok).toBe(true);
    expect(result.data?.importedWorkouts).toBe(0);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('fails when permissions were not granted', async () => {
    const denied = await syncHealthDay(DATE, stubService({ permission: 'denied' }));
    expect(denied).toEqual({ ok: false, error: 'Health permissions not granted' });

    const undetermined = await syncHealthDay(DATE, stubService({ permission: 'undetermined' }));
    expect(undetermined.ok).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns early when health sync is disabled', async () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, healthSyncEnabled: false } });

    const result = await syncHealthDay(DATE, stubService());

    expect(result).toEqual({
      ok: true,
      data: { importedWorkouts: 0, activeEnergyKcal: 0, steps: 0 },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('rejects malformed dates', async () => {
    const result = await syncHealthDay('03/10/2026', stubService());
    expect(result.ok).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('converts platform failures into an error result', async () => {
    const result = await syncHealthDay(DATE, stubService({ throwOnDay: true }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('HealthKit exploded');
  });

  it('converts repository failures into an error result', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('db is locked'));

    const result = await syncHealthDay(DATE, stubService());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('db is locked');
  });

  it('reports failure when some workouts import but others are dropped by a failed write', async () => {
    // Two real workouts for the day; the first write fails, the second lands.
    const service = stubService({
      day: (date) =>
        summary({
          date,
          workouts: [
            workout({ externalId: 'hk:failed', name: 'Evening Ride' }),
            workout({ externalId: 'hk:saved', name: 'Morning Run' }),
          ],
        }),
    });
    mockUpsert.mockRejectedValueOnce(new Error('db is locked'));

    const result = await syncHealthDay(DATE, service);

    // The second workout was written, but the first was silently dropped by a
    // failed write. Reporting ok:true loses that workout with no signal to the
    // user (and skips reconciliation, so a stale synthetic row can double-count
    // the day's burn), so the failure must be surfaced.
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockRows.has('hk:saved')).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('db is locked');
  });

  it('bumps dataVersion so screens re-query', async () => {
    const before = useAppStore.getState().dataVersion;
    await syncHealthDay(DATE, stubService());
    expect(useAppStore.getState().dataVersion).toBeGreaterThan(before);
  });

  it('uses the singleton service when none is passed', async () => {
    const service = createMockHealthService();
    await service.requestPermissions();
    setHealthService(service);

    const yesterday = addDaysISO(todayISO(), -1) as ISODate;
    const result = await syncHealthDay(yesterday);

    expect(result.ok).toBe(true);
    expect(result.data?.steps).toBeGreaterThan(0);
    expect(mockUpsert).toHaveBeenCalled();
  });
});

describe('syncHealthRange', () => {
  it('aggregates every day in the range', async () => {
    const result = await syncHealthRange('2026-03-08', '2026-03-10', stubService());

    expect(result.ok).toBe(true);
    expect(result.data?.days).toBe(3);
    expect(result.data?.importedWorkouts).toBe(3);
    expect(mockRows.size).toBe(1); // Same stub workout id every day -> one row.
  });

  it('caps the range at 90 days', async () => {
    const service = stubService({
      day: (date) => summary({ date, workouts: [workout({ externalId: `hk:${date}` })] }),
    });

    const result = await syncHealthRange('2026-01-01', '2026-12-31', service);

    expect(result.ok).toBe(true);
    expect(result.data?.days).toBe(90);
    expect(mockRows.size).toBe(90);
  });

  it('tolerates per-day failures', async () => {
    let call = 0;
    const service = stubService({
      day: (date) => {
        call += 1;
        if (call === 2) throw new Error('one bad day');
        return summary({ date, workouts: [workout({ externalId: `hk:${date}` })] });
      },
    });

    const result = await syncHealthRange('2026-03-08', '2026-03-10', service);

    expect(result.ok).toBe(true);
    expect(result.data?.days).toBe(2);
    expect(result.data?.importedWorkouts).toBe(2);
  });

  it('fails on permissions and invalid ranges, and no-ops when disabled', async () => {
    const denied = await syncHealthRange(
      '2026-03-08',
      '2026-03-10',
      stubService({ permission: 'denied' })
    );
    expect(denied).toEqual({ ok: false, error: 'Health permissions not granted' });

    const invalid = await syncHealthRange('nope', '2026-03-10', stubService());
    expect(invalid.ok).toBe(false);

    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, healthSyncEnabled: false } });
    const disabled = await syncHealthRange('2026-03-08', '2026-03-10', stubService());
    expect(disabled).toEqual({ ok: true, data: { days: 0, importedWorkouts: 0 } });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
