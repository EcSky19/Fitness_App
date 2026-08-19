import type { ISODate } from '@/types';

import { HealthKitService, normalizeHealthKitWorkout } from '../healthKit';
import { HealthConnectService, normalizeHealthConnectSession } from '../healthConnect';
import { dayWindow } from '../types';

const DATE: ISODate = '2026-03-10';
const WINDOW = dayWindow(DATE);
const START = WINDOW?.startISO as string;
const END = WINDOW?.endISO as string;

/** Callback-style stub shaped like `react-native-health`. */
function healthKitModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const cb =
    (result: unknown) =>
      jest.fn((_options: unknown, callback: (error: unknown, results: unknown) => void): void => {
        callback(null, result);
      });

  return {
    Constants: {
      Permissions: {
        Steps: 'Steps',
        ActiveEnergyBurned: 'ActiveEnergyBurned',
        BasalEnergyBurned: 'BasalEnergyBurned',
        AppleExerciseTime: 'AppleExerciseTime',
        DistanceWalkingRunning: 'DistanceWalkingRunning',
        Workout: 'Workout',
        Weight: 'Weight',
      },
    },
    isAvailable: (callback: (error: unknown, result: boolean) => void) => callback(null, true),
    initHealthKit: (_permissions: unknown, callback: (error: unknown) => void) => callback(null),
    getAuthStatus: cb({ permissions: { read: [2, 2, 2], write: [2] } }),
    getDailyStepCountSamples: cb([
      { value: 4000, startDate: START, endDate: END },
      { value: 5500, startDate: START, endDate: END },
    ]),
    getActiveEnergyBurned: cb([{ value: 320 }, { value: 200 }]),
    getBasalEnergyBurned: cb([{ value: 1650 }]),
    getAppleExerciseTime: cb([{ value: 30 }, { value: 12 }]),
    getDailyDistanceWalkingRunningSamples: cb([{ value: 7239 }]),
    getAnchoredWorkouts: cb({
      anchor: 'x',
      data: [
        {
          id: 'ABC-123',
          activityName: 'Running',
          activityId: 37,
          start: `${DATE}T07:00:00.000Z`,
          end: `${DATE}T07:42:00.000Z`,
          calories: 430,
        },
        {
          id: 'DEF-456',
          activityName: 'TraditionalStrengthTraining',
          start: `${DATE}T18:00:00.000Z`,
          end: `${DATE}T18:30:00.000Z`,
          calories: 180,
        },
      ],
    }),
    getLatestWeight: cb({ value: 74800, startDate: START }),
    saveWeight: cb(true),
    ...overrides,
  };
}

/** Promise-style stub shaped like `react-native-health-connect`. */
function healthConnectModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const records: Record<string, unknown[]> = {
    Steps: [{ count: 9500, startTime: START, endTime: END }],
    ActiveCaloriesBurned: [
      {
        energy: { inKilocalories: 430 },
        startTime: `${DATE}T07:00:00.000Z`,
        endTime: `${DATE}T07:42:00.000Z`,
      },
      { energy: { inKilojoules: 376.56 }, startTime: START, endTime: END }, // 90 kcal
    ],
    TotalCaloriesBurned: [{ energy: { inKilocalories: 2170 }, startTime: START, endTime: END }],
    ExerciseSession: [
      {
        metadata: { id: 'session-1' },
        exerciseType: 56,
        title: 'Morning Run',
        startTime: `${DATE}T07:00:00.000Z`,
        endTime: `${DATE}T07:42:00.000Z`,
      },
      {
        metadata: { id: 'session-2' },
        exerciseType: 70,
        startTime: `${DATE}T18:00:00.000Z`,
        endTime: `${DATE}T18:30:00.000Z`,
      },
    ],
    Distance: [{ distance: { inMeters: 7239 } }],
    Weight: [{ weight: { inKilograms: 74.8 }, time: `${DATE}T06:00:00.000Z` }],
  };

  return {
    initialize: jest.fn(async () => true),
    getSdkStatus: jest.fn(async () => 3),
    requestPermission: jest.fn(async (permissions: unknown[]) => permissions),
    getGrantedPermissions: jest.fn(async () => [
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'write', recordType: 'Weight' },
    ]),
    readRecords: jest.fn(async (recordType: string) => ({ records: records[recordType] ?? [] })),
    insertRecords: jest.fn(async () => ['record-id']),
    ...overrides,
  };
}

describe('HealthKitService', () => {
  it('reads a day through a local-midnight window', async () => {
    const module = healthKitModule();
    const service = new HealthKitService(module);

    const summary = await service.getDaySummary(DATE);

    expect(summary.date).toBe(DATE);
    expect(summary.steps).toBe(9500);
    expect(summary.activeEnergyKcal).toBe(520);
    expect(summary.restingEnergyKcal).toBe(1650);
    expect(summary.exerciseMinutes).toBe(42);
    expect(summary.distanceMeters).toBe(7239);
    expect(summary.workouts).toHaveLength(2);

    const [run, lift] = summary.workouts;
    expect(run).toEqual({
      externalId: 'hk:ABC-123',
      name: 'Running',
      category: 'cardio',
      startAt: `${DATE}T07:00:00.000Z`,
      durationMin: 42,
      caloriesBurned: 430,
    });
    expect(lift.category).toBe('strength');
    expect(lift.name).toBe('Traditional Strength Training');

    const options = module.getActiveEnergyBurned as jest.Mock;
    expect(options).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: START, endDate: END }),
      expect.any(Function)
    );
    // The window starts at *local* midnight, so the day is never UTC-shifted.
    expect(new Date(START).getHours()).toBe(0);
    expect(new Date(START).getDate()).toBe(10);
    expect(new Date(END).getDate()).toBe(11);
  });

  it('reports its platform and permission status', async () => {
    const service = new HealthKitService(healthKitModule());

    expect(service.platform).toBe('healthkit');
    await expect(service.isAvailable()).resolves.toBe(true);
    await expect(service.getPermissionStatus()).resolves.toBe('granted');
    await expect(service.requestPermissions()).resolves.toBe('granted');
  });

  it('treats a failed init as denied', async () => {
    const service = new HealthKitService(
      healthKitModule({
        initHealthKit: (_p: unknown, cb: (error: unknown) => void) => cb(new Error('nope')),
        getAuthStatus: (_p: unknown, cb: (e: unknown, r: unknown) => void) =>
          cb(null, { permissions: { read: [1], write: [1] } }),
      })
    );

    await expect(service.requestPermissions()).resolves.toBe('denied');
  });

  it('returns a zero-filled summary instead of throwing', async () => {
    const exploding = new HealthKitService(
      healthKitModule({
        getDailyStepCountSamples: () => {
          throw new Error('bridge died');
        },
      })
    );

    const summary = await exploding.getDaySummary(DATE);
    expect(summary.steps).toBe(0);

    const noModule = new HealthKitService(null);
    expect(await noModule.getDaySummary(DATE)).toEqual({
      date: DATE,
      steps: 0,
      activeEnergyKcal: 0,
      restingEnergyKcal: 0,
      exerciseMinutes: 0,
      distanceMeters: 0,
      workouts: [],
    });
    await expect(noModule.isAvailable()).resolves.toBe(false);
    await expect(noModule.getPermissionStatus()).resolves.toBe('unavailable');
    await expect(noModule.getLatestWeightKg()).resolves.toBeNull();
    await expect(noModule.writeWeight(80, DATE)).resolves.toBe(false);
  });

  it('reads and writes body mass in kilograms', async () => {
    const module = healthKitModule();
    const service = new HealthKitService(module);

    await expect(service.getLatestWeightKg()).resolves.toBe(74.8);
    await expect(service.writeWeight(80.5, DATE)).resolves.toBe(true);
  });

  it('builds a stable external id when the workout has no uuid', () => {
    const workout = normalizeHealthKitWorkout({
      activityName: 'Cycling',
      start: `${DATE}T07:00:00.000Z`,
      end: `${DATE}T08:00:00.000Z`,
      calories: 500,
    });

    expect(workout?.externalId).toBe(`hk:cycling:${DATE}T07:00:00.000Z`);
    expect(workout?.durationMin).toBe(60);
    expect(normalizeHealthKitWorkout('nonsense')).toBeNull();
  });
});

describe('HealthConnectService', () => {
  it('reads a day and converts kilojoules to kcal', async () => {
    const module = healthConnectModule();
    const service = new HealthConnectService(module);

    const summary = await service.getDaySummary(DATE);

    expect(summary.steps).toBe(9500);
    expect(summary.activeEnergyKcal).toBe(520); // 430 kcal + 376.56 kJ
    expect(summary.restingEnergyKcal).toBe(1650); // total - active
    expect(summary.distanceMeters).toBe(7239);
    expect(summary.exerciseMinutes).toBe(72);
    expect(summary.workouts.map((w) => w.externalId)).toEqual(['hc:session-1', 'hc:session-2']);
    expect(summary.workouts[0]).toMatchObject({
      name: 'Morning Run',
      category: 'cardio',
      durationMin: 42,
      // 430 kcal from the matching record + the prorated slice of the all-day one.
      caloriesBurned: 433,
    });
    expect(summary.workouts[1]).toMatchObject({
      name: 'Strength Training',
      category: 'strength',
      durationMin: 30,
    });

    const readRecords = module.readRecords as jest.Mock;
    expect(readRecords).toHaveBeenCalledWith('Steps', {
      timeRangeFilter: { operator: 'between', startTime: START, endTime: END },
    });
  });

  it('initialises before reading and reports permissions', async () => {
    const module = healthConnectModule();
    const service = new HealthConnectService(module);

    expect(service.platform).toBe('health_connect');
    await expect(service.isAvailable()).resolves.toBe(true);
    await expect(service.getPermissionStatus()).resolves.toBe('granted');
    await expect(service.requestPermissions()).resolves.toBe('granted');
    expect(module.initialize).toHaveBeenCalled();
    expect(module.requestPermission).toHaveBeenCalled();
  });

  it('reports denied only after asking', async () => {
    const module = healthConnectModule({ getGrantedPermissions: jest.fn(async () => []) });
    const service = new HealthConnectService(module);

    await expect(service.getPermissionStatus()).resolves.toBe('undetermined');
    await expect(service.requestPermissions()).resolves.toBe('denied');
  });

  it('returns a zero-filled summary instead of throwing', async () => {
    const service = new HealthConnectService(
      healthConnectModule({
        readRecords: jest.fn(async () => {
          throw new Error('health connect unavailable');
        }),
      })
    );

    const summary = await service.getDaySummary(DATE);
    expect(summary.steps).toBe(0);
    expect(summary.workouts).toEqual([]);

    const noModule = new HealthConnectService(null);
    await expect(noModule.isAvailable()).resolves.toBe(false);
    await expect(noModule.getPermissionStatus()).resolves.toBe('unavailable');
    await expect(noModule.getLatestWeightKg()).resolves.toBeNull();
    await expect(noModule.writeWeight(80, DATE)).resolves.toBe(false);
  });

  it('reads and writes weight records', async () => {
    const module = healthConnectModule();
    const service = new HealthConnectService(module);

    await expect(service.getLatestWeightKg()).resolves.toBe(74.8);
    await expect(service.writeWeight(80.5, DATE)).resolves.toBe(true);
    expect(module.insertRecords).toHaveBeenCalledWith([
      expect.objectContaining({
        recordType: 'Weight',
        weight: { value: 80.5, unit: 'kilograms' },
      }),
    ]);
  });

  it('falls back to an estimate when no calorie record overlaps a session', () => {
    const session = normalizeHealthConnectSession(
      {
        metadata: { id: 'abc' },
        exerciseType: 83,
        startTime: `${DATE}T09:00:00.000Z`,
        endTime: `${DATE}T09:30:00.000Z`,
      },
      []
    );

    expect(session).toMatchObject({
      externalId: 'hc:abc',
      category: 'flexibility',
      name: 'Yoga',
      durationMin: 30,
      caloriesBurned: 90,
    });
    expect(normalizeHealthConnectSession(null)).toBeNull();
  });
});
