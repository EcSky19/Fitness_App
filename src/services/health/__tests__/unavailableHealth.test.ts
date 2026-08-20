/**
 * Release builds must never present simulated health data as real.
 *
 * The simulated provider reports itself available and grants permission on
 * request, which is what makes the app demoable. Shipped to a user, that same
 * behaviour would fold invented workouts into their real diary and inflate the
 * calorie budget they are trying to stay under, so a release build without a
 * native health library gets the unavailable provider instead.
 */
import type { ISODate } from '@/types';
import {
  UnavailableHealthService,
  createUnavailableHealthService,
  getHealthService,
  healthPlatformLabel,
  isHealthSupported,
  resetHealthService,
} from '@/services/health';
import { createMockHealthService } from '../mockHealth';

const DATE = '2024-05-04' as ISODate;

declare const global: { __DEV__?: boolean };

/** Runs `fn` with `__DEV__` forced to `value`, then restores it. */
async function withDevFlag(value: boolean, fn: () => Promise<void>): Promise<void> {
  const original = global.__DEV__;
  global.__DEV__ = value;
  resetHealthService();
  try {
    await fn();
  } finally {
    global.__DEV__ = original;
    resetHealthService();
  }
}

describe('UnavailableHealthService', () => {
  const service = new UnavailableHealthService();

  it('is honest about not being available', async () => {
    await expect(service.isAvailable()).resolves.toBe(false);
    await expect(service.getPermissionStatus()).resolves.toBe('unavailable');
  });

  it('never grants permission, however many times it is asked', async () => {
    await expect(service.requestPermissions()).resolves.toBe('unavailable');
    await expect(service.requestPermissions()).resolves.toBe('unavailable');
    await expect(service.getPermissionStatus()).resolves.toBe('unavailable');
  });

  it('returns an empty day rather than plausible fiction', async () => {
    const day = await service.getDaySummary(DATE);

    expect(day).toEqual({
      date: DATE,
      steps: 0,
      activeEnergyKcal: 0,
      restingEnergyKcal: 0,
      exerciseMinutes: 0,
      distanceMeters: 0,
      workouts: [],
    });
  });

  it('returns empty days across a range', async () => {
    const days = await service.getRange('2024-05-01' as ISODate, '2024-05-03' as ISODate);

    expect(days).toHaveLength(3);
    expect(days.every((d) => d.steps === 0 && d.workouts.length === 0)).toBe(true);
  });

  it('reports no weight and refuses to write one', async () => {
    await expect(service.getLatestWeightKg()).resolves.toBeNull();
    await expect(service.writeWeight()).resolves.toBe(false);
  });

  it('differs from the simulator, which does fabricate data', async () => {
    const simulated = await createMockHealthService().getDaySummary(DATE);
    const real = await createUnavailableHealthService().getDaySummary(DATE);

    expect(simulated.steps).toBeGreaterThan(0);
    expect(real.steps).toBe(0);
  });
});

describe('provider selection by build type', () => {
  afterEach(() => {
    resetHealthService();
  });

  it('uses the simulator in development so the app stays demoable', async () => {
    await withDevFlag(true, async () => {
      expect(getHealthService().platform).toBe('mock');
      expect(healthPlatformLabel()).toBe('Simulated Health Data');
    });
  });

  it('uses the unavailable provider in a release build', async () => {
    await withDevFlag(false, async () => {
      expect(getHealthService().platform).toBe('unavailable');
      expect(healthPlatformLabel()).toBe('Health sync');
    });
  });

  it('never claims health is supported without a real platform', async () => {
    await withDevFlag(false, async () => {
      expect(isHealthSupported()).toBe(false);
    });
    await withDevFlag(true, async () => {
      expect(isHealthSupported()).toBe(false);
    });
  });

  it('does not grant permission in a release build', async () => {
    await withDevFlag(false, async () => {
      await expect(getHealthService().requestPermissions()).resolves.toBe('unavailable');
    });
  });

  it('reports zero burn in a release build, so no fake calories reach the budget', async () => {
    await withDevFlag(false, async () => {
      const day = await getHealthService().getDaySummary(DATE);
      expect(day.activeEnergyKcal).toBe(0);
      expect(day.workouts).toEqual([]);
    });
  });
});
