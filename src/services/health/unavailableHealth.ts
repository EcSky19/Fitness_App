/**
 * Health provider used when the platform integration is genuinely absent.
 *
 * The simulated provider (`mockHealth.ts`) exists so the app is demoable
 * without a HealthKit / Health Connect build, but it reports itself as
 * available and grants permission on request. In a shipped build that is
 * actively harmful: a user would tap "Connect", be told they were connected,
 * and then see invented workouts and step counts folded into their real diary.
 * Fabricated burned calories inflate the eating budget, which is the opposite
 * of what a calorie tracker is for.
 *
 * So release builds without a native library get this provider instead: it is
 * honest about being unavailable, never grants permission, and returns empty
 * days rather than plausible fiction.
 */
import type {
  HealthDaySummary,
  HealthPermissionStatus,
  HealthService,
  ISODate,
} from '@/types';

import { emptyDaySummary, enumerateDates } from './types';

export class UnavailableHealthService implements HealthService {
  readonly platform = 'unavailable' as const;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    return 'unavailable';
  }

  async requestPermissions(): Promise<HealthPermissionStatus> {
    return 'unavailable';
  }

  async getDaySummary(date: ISODate): Promise<HealthDaySummary> {
    return emptyDaySummary(date);
  }

  async getRange(startDate: ISODate, endDate: ISODate): Promise<HealthDaySummary[]> {
    return enumerateDates(startDate, endDate).map((date) => emptyDaySummary(date));
  }

  async getLatestWeightKg(): Promise<number | null> {
    return null;
  }

  async writeWeight(): Promise<boolean> {
    return false;
  }
}

export function createUnavailableHealthService(): HealthService {
  return new UnavailableHealthService();
}

export default createUnavailableHealthService;
