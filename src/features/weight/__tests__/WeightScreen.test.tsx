/**
 * Weight tab composition: empty state, hero/chart/history wiring, goal prompt
 * and the health import row.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('@/db/repositories', () => require('../testSupport').repositoriesMockFactory());
jest.mock('@/services/health', () => require('../testSupport').healthMockFactory());
jest.mock('expo-router', () => require('../testSupport').routerMockFactory());

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import type { WeightLog } from '@/types';

import WeightScreen from '../../../../app/(tabs)/weight';
import { makeProfile, makeWeightLog } from '../testSupport';

const repos = jest.requireMock('@/db/repositories') as {
  listWeightLogs: jest.Mock;
  addWeightLog: jest.Mock;
  saveProfile: jest.Mock;
};
const health = jest.requireMock('@/services/health') as {
  isHealthSupported: jest.Mock;
  healthPlatformLabel: jest.Mock;
  __service: { getLatestWeightKg: jest.Mock };
};
const routerModule = jest.requireMock('expo-router') as {
  router: { push: jest.Mock };
};

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** Newest first, like the repository. */
const LOGS: WeightLog[] = [
  makeWeightLog({ id: 'c', date: isoDaysAgo(0), weightKg: 80 }),
  makeWeightLog({ id: 'b', date: isoDaysAgo(7), weightKg: 81 }),
  makeWeightLog({ id: 'a', date: isoDaysAgo(21), weightKg: 82.5 }),
];

function setLogs(logs: WeightLog[]): void {
  repos.listWeightLogs.mockResolvedValue(logs);
}

async function renderScreen(): Promise<void> {
  render(<WeightScreen />);
  await waitFor(() => expect(repos.listWeightLogs).toHaveBeenCalled());
}

beforeEach(() => {
  setLogs([]);
  repos.addWeightLog.mockResolvedValue(undefined);
  repos.saveProfile.mockResolvedValue(undefined);
  health.isHealthSupported.mockReturnValue(true);
  health.healthPlatformLabel.mockReturnValue('Apple Health');
  health.__service.getLatestWeightKg.mockResolvedValue(null);
  useAppStore.setState({
    profile: makeProfile({ goalWeightKg: 70, heightCm: 170, currentWeightKg: 80 }),
    settings: { ...DEFAULT_SETTINGS, weightUnit: 'kg', healthSyncEnabled: false },
    dataVersion: 0,
  });
});

describe('WeightScreen', () => {
  it('shows an empty state with a CTA that opens the log sheet', async () => {
    await renderScreen();

    expect(await screen.findByText('No weigh-ins yet')).toBeTruthy();
    expect(screen.queryByTestId('weight-history-list')).toBeNull();
    expect(screen.queryByText('Save weigh-in')).toBeNull();

    fireEvent.press(screen.getByText('Log your first weight'));

    expect(await screen.findByText('Save weigh-in')).toBeTruthy();
    expect(screen.getByTestId('weight-form-date')).toBeTruthy();
  });

  it('renders the hero, chart, stats and history once logs exist', async () => {
    setLogs(LOGS);
    await renderScreen();

    expect(await screen.findByTestId('weight-hero-current')).toHaveTextContent('80.0 kg');
    expect(screen.getByTestId('weight-hero-goal')).toHaveTextContent('70.0 kg');
    expect(screen.getByTestId('weight-hero-remaining')).toHaveTextContent('10.0 kg to lose');
    expect(screen.getByTestId('weight-stats-row')).toBeTruthy();
    expect(screen.getByTestId('weight-history-list')).toBeTruthy();
    expect(screen.getByTestId('weight-delta-b')).toHaveTextContent('-1.5 kg');
    expect(screen.getByTestId('weight-delta-c')).toHaveTextContent('-1.0 kg');
  });

  it('renders weights in the display unit', async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, weightUnit: 'lb', healthSyncEnabled: false },
    });
    setLogs(LOGS);
    await renderScreen();

    expect(await screen.findByTestId('weight-hero-current')).toHaveTextContent('176.4 lb');
  });

  it('prompts for a goal weight and links to the profile tab', async () => {
    useAppStore.setState({ profile: makeProfile({ goalWeightKg: null }) });
    setLogs(LOGS);
    await renderScreen();

    fireEvent.press(await screen.findByText('Go to profile'));
    expect(routerModule.router.push).toHaveBeenCalledWith('/(tabs)/profile');
  });

  it('hides the health import row unless sync is enabled', async () => {
    setLogs(LOGS);
    await renderScreen();
    expect(screen.queryByText('Import latest from Apple Health')).toBeNull();
  });

  it('imports the latest weight from health into the sheet', async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, weightUnit: 'kg', healthSyncEnabled: true },
    });
    health.__service.getLatestWeightKg.mockResolvedValue(77.3);
    setLogs(LOGS);
    await renderScreen();

    fireEvent.press(await screen.findByText('Import latest from Apple Health'));

    await waitFor(() => expect(health.__service.getLatestWeightKg).toHaveBeenCalled());
    expect(await screen.findByDisplayValue('77.3')).toBeTruthy();
  });

  it('surfaces a message when health has no weight to import', async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, weightUnit: 'kg', healthSyncEnabled: true },
    });
    health.__service.getLatestWeightKg.mockResolvedValue(null);
    setLogs(LOGS);
    await renderScreen();

    fireEvent.press(await screen.findByText('Import latest from Apple Health'));

    expect(await screen.findByText('No weight found in Apple Health.')).toBeTruthy();
  });

  it('opens the edit sheet prefilled when a history row is tapped', async () => {
    setLogs(LOGS);
    await renderScreen();

    fireEvent.press(await screen.findByLabelText(/^82\.5 kg,/));

    expect(await screen.findByText('Save changes')).toBeTruthy();
    expect(screen.getByDisplayValue('82.5')).toBeTruthy();
  });

  it('reports load failures without crashing', async () => {
    repos.listWeightLogs.mockRejectedValue(new Error('db offline'));
    await renderScreen();

    expect(await screen.findByText('db offline')).toBeTruthy();
    expect(screen.getByText('No weigh-ins yet')).toBeTruthy();
  });
});
