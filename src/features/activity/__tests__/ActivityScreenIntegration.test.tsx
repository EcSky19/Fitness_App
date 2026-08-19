/**
 * Integration smoke test: renders the Activity tab against the REAL design
 * system, domain engine and `useAsyncData`. Only the data/health/navigation
 * boundaries are mocked.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ExerciseEntry } from '@/types';

const mockRepo = {
  listExercisesByDate: jest.fn(),
  listExercisesByDateRange: jest.fn(),
  addExerciseEntry: jest.fn(),
  updateExerciseEntry: jest.fn(),
  deleteExerciseEntry: jest.fn(),
  getLatestWeight: jest.fn(),
};

const mockHealthService = {
  platform: 'healthkit' as const,
  isAvailable: jest.fn(),
  getPermissionStatus: jest.fn(),
  requestPermissions: jest.fn(),
  getDaySummary: jest.fn(),
  getRange: jest.fn(),
  getLatestWeightKg: jest.fn(),
  writeWeight: jest.fn(),
};

jest.mock('@/db/repositories', () => ({
  listExercisesByDate: (...args: unknown[]) => mockRepo.listExercisesByDate(...args),
  listExercisesByDateRange: (...args: unknown[]) => mockRepo.listExercisesByDateRange(...args),
  addExerciseEntry: (...args: unknown[]) => mockRepo.addExerciseEntry(...args),
  updateExerciseEntry: (...args: unknown[]) => mockRepo.updateExerciseEntry(...args),
  deleteExerciseEntry: (...args: unknown[]) => mockRepo.deleteExerciseEntry(...args),
  getLatestWeight: (...args: unknown[]) => mockRepo.getLatestWeight(...args),
}));
jest.mock('@/services/health', () => ({
  getHealthService: () => mockHealthService,
  syncHealthDay: jest.fn(async () => ({ ok: true, data: {} })),
  syncHealthRange: jest.fn(async () => ({ ok: true, data: {} })),
  isHealthSupported: () => true,
  healthPlatformLabel: () => 'Apple Health',
  HEALTH_PERMISSIONS: ['Steps', 'Workouts'],
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import { todayISO } from '@/domain';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';

import ActivityScreen from '../../../../app/(tabs)/activity';

const TODAY = todayISO();

const entry: ExerciseEntry = {
  id: 'manual-1',
  date: TODAY,
  name: 'Morning run',
  category: 'cardio',
  durationMin: 30,
  caloriesBurned: 300,
  source: 'manual',
  externalId: null,
  notes: null,
  loggedAt: `${TODAY}T07:00:00.000Z`,
  createdAt: `${TODAY}T07:00:00.000Z`,
  updatedAt: `${TODAY}T07:00:00.000Z`,
};

beforeEach(() => {
  useAppStore.setState({
    selectedDate: TODAY,
    settings: { ...DEFAULT_SETTINGS },
    profile: null,
    goal: null,
    isReady: true,
    dataVersion: 0,
  });

  mockRepo.listExercisesByDate.mockResolvedValue([entry]);
  mockRepo.listExercisesByDateRange.mockResolvedValue([entry]);
  mockRepo.getLatestWeight.mockResolvedValue(null);
  mockRepo.addExerciseEntry.mockResolvedValue(entry);
  mockRepo.deleteExerciseEntry.mockResolvedValue(undefined);

  mockHealthService.isAvailable.mockResolvedValue(true);
  mockHealthService.getPermissionStatus.mockResolvedValue('undetermined');
  mockHealthService.requestPermissions.mockResolvedValue('granted');
  mockHealthService.getDaySummary.mockResolvedValue(null);
});

describe('ActivityScreen (real UI + domain)', () => {
  it('renders the day, the connect card and the logged entries', async () => {
    render(<ActivityScreen />);

    expect(await screen.findByText('Morning run')).toBeTruthy();
    expect(screen.getByText('Connect Apple Health')).toBeTruthy();
    expect(screen.getByText('Workouts  300 kcal')).toBeTruthy();
    expect(screen.getByText("Adds 300 kcal to today's budget")).toBeTruthy();
  });

  it('opens the log sheet with the real MET activity picker', async () => {
    render(<ActivityScreen />);
    await screen.findByText('Morning run');

    fireEvent.press(screen.getByLabelText('Log workout'));

    expect(screen.getByText('Log a workout')).toBeTruthy();
    expect(screen.getByText('Find an activity')).toBeTruthy();
    expect(screen.getByText('Custom activity')).toBeTruthy();
  });
});
