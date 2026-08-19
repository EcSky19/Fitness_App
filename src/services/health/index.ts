/**
 * Health platform integration.
 *
 *   import { getHealthService, syncHealthDay } from '@/services/health';
 *
 * `getHealthService()` returns a singleton chosen at runtime:
 *   iOS + `react-native-health` linked      -> Apple HealthKit
 *   Android + `react-native-health-connect` -> Health Connect
 *   anything else (Expo Go, web, tests)     -> deterministic simulated data
 *
 * Neither native library is a dependency of this project; they are loaded
 * through a guarded optional require (see `nativeModule.ts`), so the app builds
 * and runs today and upgrades itself the moment one is added to a dev build.
 */
import { Platform } from 'react-native';

import type { HealthService } from '@/types';

import { createHealthConnectService } from './healthConnect';
import { createHealthKitService } from './healthKit';
import { createMockHealthService } from './mockHealth';
import { loadNativeHealthModule } from './nativeModule';
import { HEALTH_PLATFORM_LABELS } from './types';

let instance: HealthService | null = null;

/** Picks the best provider for this runtime. Never throws. */
function createHealthService(): HealthService {
  try {
    const os = Platform.OS;
    if (os === 'ios' || os === 'android') {
      const native = loadNativeHealthModule(os);
      if (native) {
        return os === 'ios' ? createHealthKitService(native) : createHealthConnectService(native);
      }
    }
  } catch {
    // Fall through to the simulator.
  }
  return createMockHealthService();
}

/** Process-wide singleton health service. */
export function getHealthService(): HealthService {
  if (!instance) instance = createHealthService();
  return instance;
}

/** Test hook: drops the singleton so the next call re-detects the platform. */
export function resetHealthService(): void {
  instance = null;
}

/** Test/demo hook: forces a specific service. Pass `null` to restore detection. */
export function setHealthService(service: HealthService | null): void {
  instance = service;
}

/** True when a real platform integration (not the simulator) is active. */
export function isHealthSupported(): boolean {
  return getHealthService().platform !== 'mock';
}

/** 'Apple Health' | 'Health Connect' | 'Simulated Health Data'. */
export function healthPlatformLabel(): string {
  return HEALTH_PLATFORM_LABELS[getHealthService().platform];
}

export { entrySourceFor, syncHealthDay, syncHealthRange } from './sync';
export type { ExternalExerciseInput } from './sync';

export {
  HEALTH_PERMISSIONS,
  HEALTH_PLATFORM_LABELS,
  MAX_SYNC_DAYS,
  dayWindow,
  emptyDaySummary,
  enumerateDates,
  isISODate,
} from './types';
export type { HealthDaySyncResult, HealthPlatform, HealthRangeSyncResult } from './types';

export { MockHealthService, buildMockDaySummary, createMockHealthService } from './mockHealth';
export {
  HealthKitService,
  createHealthKitService,
  mapHealthKitActivityToCategory,
} from './healthKit';
export {
  HealthConnectService,
  createHealthConnectService,
  mapHealthConnectExerciseToCategory,
} from './healthConnect';
export {
  HEALTHKIT_PACKAGE,
  HEALTH_CONNECT_PACKAGE,
  isNativeHealthModuleAvailable,
  loadNativeHealthModule,
  nativeHealthPackageFor,
  registerNativeHealthModule,
  resetNativeHealthModule,
} from './nativeModule';
