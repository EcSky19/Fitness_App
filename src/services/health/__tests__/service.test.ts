import type { HealthPermissionStatus, HealthService, ISODate } from '@/types';
import {
  HEALTH_PERMISSIONS,
  getHealthService,
  healthPlatformLabel,
  isHealthSupported,
  mapHealthConnectExerciseToCategory,
  mapHealthKitActivityToCategory,
  resetHealthService,
  setHealthService,
} from '@/services/health';
import { HEALTHKIT_ACTIVITY_CATEGORIES, HEALTHKIT_ACTIVITY_IDS } from '../healthKit';
import {
  HEALTH_CONNECT_EXERCISE_CATEGORIES,
  HEALTH_CONNECT_EXERCISE_TYPES,
} from '../healthConnect';
import { dayWindow, enumerateDates, isFutureDate, parseLocalDate, toISODate } from '../types';

function stubService(platform: HealthService['platform']): HealthService {
  return {
    platform,
    isAvailable: async () => true,
    getPermissionStatus: async (): Promise<HealthPermissionStatus> => 'granted',
    requestPermissions: async (): Promise<HealthPermissionStatus> => 'granted',
    getDaySummary: async (date: ISODate) => ({
      date,
      steps: 0,
      activeEnergyKcal: 0,
      restingEnergyKcal: 0,
      exerciseMinutes: 0,
      distanceMeters: 0,
      workouts: [],
    }),
    getRange: async () => [],
    getLatestWeightKg: async () => null,
    writeWeight: async () => true,
  };
}

afterEach(() => {
  resetHealthService();
});

describe('getHealthService', () => {
  it('falls back to the simulator when no native module is linked', () => {
    expect(getHealthService().platform).toBe('mock');
  });

  it('is a stable singleton', () => {
    const first = getHealthService();
    expect(getHealthService()).toBe(first);
  });

  it('is rebuilt after resetHealthService()', () => {
    const first = getHealthService();
    resetHealthService();
    const second = getHealthService();

    expect(second).not.toBe(first);
    expect(second.platform).toBe('mock');
  });

  it('reports the platform label and support flag', () => {
    expect(healthPlatformLabel()).toBe('Simulated Health Data');
    expect(isHealthSupported()).toBe(false);

    setHealthService(stubService('healthkit'));
    expect(healthPlatformLabel()).toBe('Apple Health');
    expect(isHealthSupported()).toBe(true);

    setHealthService(stubService('health_connect'));
    expect(healthPlatformLabel()).toBe('Health Connect');
    expect(isHealthSupported()).toBe(true);

    setHealthService(null);
    expect(healthPlatformLabel()).toBe('Simulated Health Data');
  });

  it('exposes a human readable permission list', () => {
    expect(HEALTH_PERMISSIONS.length).toBeGreaterThan(0);
    expect(HEALTH_PERMISSIONS).toContain('Steps');
    expect(HEALTH_PERMISSIONS).toContain('Workouts');
  });
});

describe('mapHealthKitActivityToCategory', () => {
  it('maps every known activity name in the table', () => {
    for (const [name, category] of Object.entries(HEALTHKIT_ACTIVITY_CATEGORIES)) {
      expect(mapHealthKitActivityToCategory(name)).toBe(category);
    }
  });

  it('maps every known numeric activity id', () => {
    for (const [id, name] of Object.entries(HEALTHKIT_ACTIVITY_IDS)) {
      expect(mapHealthKitActivityToCategory(Number(id))).toBe(
        HEALTHKIT_ACTIVITY_CATEGORIES[name] ?? 'other'
      );
    }
  });

  it('normalises HealthKit prefixes and casing', () => {
    expect(mapHealthKitActivityToCategory('HKWorkoutActivityTypeRunning')).toBe('cardio');
    expect(mapHealthKitActivityToCategory('TraditionalStrengthTraining')).toBe('strength');
    expect(mapHealthKitActivityToCategory('functional_strength_training')).toBe('strength');
    expect(mapHealthKitActivityToCategory('Yoga')).toBe('flexibility');
    expect(mapHealthKitActivityToCategory('Basketball')).toBe('sports');
    expect(mapHealthKitActivityToCategory('37')).toBe('cardio');
  });

  it('defaults to other', () => {
    expect(mapHealthKitActivityToCategory('SpaceWalking')).toBe('other');
    expect(mapHealthKitActivityToCategory(99999)).toBe('other');
    expect(mapHealthKitActivityToCategory('')).toBe('other');
    expect(mapHealthKitActivityToCategory(null)).toBe('other');
    expect(mapHealthKitActivityToCategory(undefined)).toBe('other');
  });
});

describe('mapHealthConnectExerciseToCategory', () => {
  it('maps every known exercise name in the table', () => {
    for (const [name, category] of Object.entries(HEALTH_CONNECT_EXERCISE_CATEGORIES)) {
      expect(mapHealthConnectExerciseToCategory(name)).toBe(category);
    }
  });

  it('maps every known numeric exercise type', () => {
    for (const [code, name] of Object.entries(HEALTH_CONNECT_EXERCISE_TYPES)) {
      expect(mapHealthConnectExerciseToCategory(Number(code))).toBe(
        HEALTH_CONNECT_EXERCISE_CATEGORIES[name] ?? 'other'
      );
    }
  });

  it('normalises constant style names', () => {
    expect(mapHealthConnectExerciseToCategory('RUNNING')).toBe('cardio');
    expect(mapHealthConnectExerciseToCategory('EXERCISE_TYPE_STRENGTH_TRAINING')).toBe('strength');
    expect(mapHealthConnectExerciseToCategory('ExerciseType.YOGA')).toBe('flexibility');
    expect(mapHealthConnectExerciseToCategory('football-american')).toBe('sports');
    expect(mapHealthConnectExerciseToCategory('56')).toBe('cardio');
  });

  it('defaults to other', () => {
    expect(mapHealthConnectExerciseToCategory('QUIDDITCH')).toBe('other');
    expect(mapHealthConnectExerciseToCategory(9999)).toBe('other');
    expect(mapHealthConnectExerciseToCategory(null)).toBe('other');
    expect(mapHealthConnectExerciseToCategory(undefined)).toBe('other');
  });
});

describe('date helpers', () => {
  it('builds a local-midnight window that never shifts the day', () => {
    const window = dayWindow('2026-03-11');
    expect(window).not.toBeNull();
    expect(window?.start.getHours()).toBe(0);
    expect(window?.start.getDate()).toBe(11);
    expect(window?.end.getDate()).toBe(12);
    expect(toISODate(window?.start as Date)).toBe('2026-03-11');
    expect((window?.end.getTime() ?? 0) - (window?.start.getTime() ?? 0)).toBeGreaterThan(0);
  });

  it('rejects malformed and impossible dates', () => {
    expect(dayWindow('2026-13-01')).toBeNull();
    expect(dayWindow('2026-02-30')).toBeNull();
    expect(parseLocalDate('nope')).toBeNull();
  });

  it('enumerates inclusive ranges and caps them', () => {
    expect(enumerateDates('2026-03-09', '2026-03-11')).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ]);
    expect(enumerateDates('2026-03-11', '2026-03-09')).toHaveLength(3);
    expect(enumerateDates('2026-01-01', '2026-12-31')).toHaveLength(90);
    expect(enumerateDates('2026-01-01', 'bad')).toEqual([]);
  });

  it('detects future dates against a fixed clock', () => {
    const now = new Date(2026, 2, 11, 23, 30, 0, 0);
    expect(isFutureDate('2026-03-12', now)).toBe(true);
    expect(isFutureDate('2026-03-11', now)).toBe(false);
    expect(isFutureDate('2026-03-10', now)).toBe(false);
  });
});
