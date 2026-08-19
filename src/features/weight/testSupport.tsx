/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fixtures + test doubles shared by the weight feature tests.
 *
 * Only the modules with side effects are faked (`@/db/repositories`,
 * `@/services/health`, `expo-router`); `@/ui`, `@/domain` and
 * `@/hooks/useAsyncData` are exercised for real.
 *
 * This file is only imported from `__tests__`.
 */
import React from 'react';

import type { ISODate, UserProfile, WeightLog } from '@/types';

type AnyProps = Record<string, any>;

export function makeWeightLog(overrides: Partial<WeightLog> & { date: ISODate }): WeightLog {
  return {
    id: `log-${overrides.date}`,
    weightKg: 80,
    bodyFatPct: null,
    note: null,
    source: 'manual',
    createdAt: `${overrides.date}T08:00:00.000Z`,
    updatedAt: `${overrides.date}T08:00:00.000Z`,
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'profile-1',
    name: 'Test User',
    sex: 'female',
    birthDate: '1995-04-01',
    heightCm: 170,
    currentWeightKg: 80,
    goalWeightKg: 70,
    activityLevel: 'moderate',
    weightUnit: 'kg',
    heightUnit: 'cm',
    onboardedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function repositoriesMockFactory(): Record<string, unknown> {
  return {
    listWeightLogs: jest.fn(async () => [] as WeightLog[]),
    listWeightLogsByRange: jest.fn(async () => [] as WeightLog[]),
    getWeightLogByDate: jest.fn(async () => null),
    getLatestWeight: jest.fn(async () => null),
    addWeightLog: jest.fn(async () => undefined),
    updateWeightLog: jest.fn(async () => undefined),
    deleteWeightLog: jest.fn(async () => undefined),
    getProfile: jest.fn(async () => null),
    saveProfile: jest.fn(async () => undefined),
    getActiveGoal: jest.fn(async () => null),
    getSettings: jest.fn(async () => ({})),
    saveSettings: jest.fn(async () => undefined),
  };
}

export function healthMockFactory(): Record<string, unknown> {
  const service = {
    platform: 'mock',
    isAvailable: jest.fn(async () => true),
    getPermissionStatus: jest.fn(async () => 'granted'),
    requestPermissions: jest.fn(async () => 'granted'),
    getDaySummary: jest.fn(async () => null),
    getRange: jest.fn(async () => []),
    getLatestWeightKg: jest.fn(async () => null),
    writeWeight: jest.fn(async () => true),
  };
  return {
    getHealthService: jest.fn(() => service),
    healthPlatformLabel: jest.fn(() => 'Apple Health'),
    isHealthSupported: jest.fn(() => true),
    __service: service,
  };
}

export function routerMockFactory(): Record<string, unknown> {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    canGoBack: jest.fn(() => true),
    setParams: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
  };
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/(tabs)/weight',
    useFocusEffect: (callback: () => void) => {
      React.useEffect(() => {
        callback();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
    Link: ({ children }: AnyProps) => <>{children}</>,
    Stack: { Screen: () => null },
  };
}
