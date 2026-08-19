import React from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import type { ExerciseEntry, HealthDaySummary } from '@/types';

import { TEST_TODAY } from './domainMock';

const mockRepo = {
  listExercisesByDate: jest.fn(),
  listExercisesByDateRange: jest.fn(),
  addExerciseEntry: jest.fn(),
  updateExerciseEntry: jest.fn(),
  deleteExerciseEntry: jest.fn(),
  getLatestWeight: jest.fn(),
  getProfile: jest.fn(),
  listEntriesByDate: jest.fn(),
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

const mockSyncHealthDay = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('@/ui', () => require('./uiMock'));
jest.mock('@/domain', () => require('./domainMock'));
// Wrappers, not `mockRepo` itself: the factory runs while `mockRepo` is still in TDZ.
jest.mock('@/db/repositories', () => ({
  listExercisesByDate: (...args: unknown[]) => mockRepo.listExercisesByDate(...args),
  listExercisesByDateRange: (...args: unknown[]) => mockRepo.listExercisesByDateRange(...args),
  addExerciseEntry: (...args: unknown[]) => mockRepo.addExerciseEntry(...args),
  updateExerciseEntry: (...args: unknown[]) => mockRepo.updateExerciseEntry(...args),
  deleteExerciseEntry: (...args: unknown[]) => mockRepo.deleteExerciseEntry(...args),
  getLatestWeight: (...args: unknown[]) => mockRepo.getLatestWeight(...args),
  getProfile: (...args: unknown[]) => mockRepo.getProfile(...args),
  listEntriesByDate: (...args: unknown[]) => mockRepo.listEntriesByDate(...args),
}));
jest.mock('@/services/health', () => ({
  getHealthService: () => mockHealthService,
  syncHealthDay: (...args: unknown[]) => mockSyncHealthDay(...args),
  syncHealthRange: jest.fn(async () => ({ ok: true, data: { days: 7, importedWorkouts: 0 } })),
  isHealthSupported: () => true,
  healthPlatformLabel: () => 'Apple Health',
  HEALTH_PERMISSIONS: ['Steps', 'Active energy', 'Workouts', 'Body mass'],
}));
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
  },
  useRouter: () => ({ push: (...args: unknown[]) => mockRouterPush(...args) }),
  useLocalSearchParams: () => ({}),
}));

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';

import ActivityScreen from '../../../../app/(tabs)/activity';

const manualEntry: ExerciseEntry = {
  id: 'manual-1',
  date: TEST_TODAY,
  name: 'Morning run',
  category: 'cardio',
  durationMin: 30,
  caloriesBurned: 300,
  source: 'manual',
  externalId: null,
  notes: null,
  loggedAt: `${TEST_TODAY}T07:00:00.000Z`,
  createdAt: `${TEST_TODAY}T07:00:00.000Z`,
  updatedAt: `${TEST_TODAY}T07:00:00.000Z`,
};

const importedEntry: ExerciseEntry = {
  id: 'hk-1',
  date: TEST_TODAY,
  name: 'Outdoor Cycle',
  category: 'cardio',
  durationMin: 45,
  caloriesBurned: 220,
  source: 'healthkit',
  externalId: 'workout-abc',
  notes: null,
  loggedAt: `${TEST_TODAY}T17:00:00.000Z`,
  createdAt: `${TEST_TODAY}T17:05:00.000Z`,
  updatedAt: `${TEST_TODAY}T17:05:00.000Z`,
};

const olderEntry: ExerciseEntry = {
  ...manualEntry,
  id: 'manual-0',
  date: '2026-03-08',
  name: 'Weights',
  category: 'strength',
  durationMin: 20,
  caloriesBurned: 150,
};

const daySummary: HealthDaySummary = {
  date: TEST_TODAY,
  steps: 8421,
  activeEnergyKcal: 560,
  restingEnergyKcal: 1500,
  exerciseMinutes: 47,
  distanceMeters: 6300,
  workouts: [
    {
      externalId: 'workout-abc',
      name: 'Outdoor Cycle',
      category: 'cardio',
      startAt: `${TEST_TODAY}T17:00:00.000Z`,
      durationMin: 45,
      caloriesBurned: 220,
    },
  ],
};

function setEntries(today: ExerciseEntry[], week: ExerciseEntry[] = today): void {
  mockRepo.listExercisesByDate.mockResolvedValue(today);
  mockRepo.listExercisesByDateRange.mockResolvedValue(week);
}

function connectHealth(): void {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, healthSyncEnabled: true } });
  mockHealthService.getPermissionStatus.mockResolvedValue('granted');
  mockHealthService.getDaySummary.mockResolvedValue(daySummary);
}

beforeEach(() => {
  useAppStore.setState({
    selectedDate: TEST_TODAY,
    settings: { ...DEFAULT_SETTINGS },
    profile: null,
    goal: null,
    isReady: true,
    dataVersion: 0,
  });

  setEntries([]);
  mockRepo.getLatestWeight.mockResolvedValue(80);
  mockRepo.addExerciseEntry.mockResolvedValue({ ...manualEntry, id: 'new-1' });
  mockRepo.updateExerciseEntry.mockResolvedValue({ ...manualEntry });
  mockRepo.deleteExerciseEntry.mockResolvedValue(undefined);

  mockHealthService.isAvailable.mockResolvedValue(true);
  mockHealthService.getPermissionStatus.mockResolvedValue('undetermined');
  mockHealthService.requestPermissions.mockResolvedValue('granted');
  mockHealthService.getDaySummary.mockResolvedValue(daySummary);
  mockSyncHealthDay.mockResolvedValue({
    ok: true,
    data: { importedWorkouts: 1, activeEnergyKcal: 560, steps: 8421 },
  });

  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

/** Runs the destructive action of the last Alert.alert confirmation. */
function pressAlertDestructive(): void {
  const alertMock = Alert.alert as jest.Mock;
  const buttons = alertMock.mock.calls[alertMock.mock.calls.length - 1][2] as
    | { text?: string; onPress?: () => void }[]
    | undefined;
  const destructive = buttons?.find((button) => button.text === 'Delete');
  destructive?.onPress?.();
}

/** The empty state offers its own "Log workout" action, so disambiguate. */
function pressLogWorkout(): void {
  fireEvent.press(screen.getAllByLabelText('Log workout')[0]);
}

describe('ActivityScreen — health connection', () => {
  it('shows the connect card, the platform name and the requested permissions', async () => {
    render(<ActivityScreen />);
    await screen.findByTestId('activity-empty');

    expect(await screen.findByTestId('health-connect-card')).toBeTruthy();
    expect(screen.getByText('Connect Apple Health')).toBeTruthy();
    expect(screen.getByText('• Steps')).toBeTruthy();
    expect(screen.getByText('• Active energy')).toBeTruthy();
    expect(screen.getByText('• Workouts')).toBeTruthy();
    expect(screen.queryByTestId('health-stats-card')).toBeNull();
  });

  it('explains a denied permission and opens the device settings', async () => {
    mockHealthService.getPermissionStatus.mockResolvedValue('denied');
    render(<ActivityScreen />);

    expect(await screen.findByText(/access was turned down/i)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open device settings'));
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('explains that simulated data is used when health is unavailable', async () => {
    mockHealthService.getPermissionStatus.mockResolvedValue('unavailable');
    render(<ActivityScreen />);

    expect(await screen.findByText(/simulated health data/i)).toBeTruthy();
  });

  it('connects, enables the setting, syncs and then shows the stats', async () => {
    mockHealthService.requestPermissions.mockImplementation(async () => {
      mockHealthService.getPermissionStatus.mockResolvedValue('granted');
      return 'granted';
    });
    render(<ActivityScreen />);
    fireEvent.press(await screen.findByLabelText('Connect Apple Health'));

    await waitFor(() => expect(screen.getByTestId('health-stats-card')).toBeTruthy());

    expect(mockHealthService.requestPermissions).toHaveBeenCalled();
    expect(mockSyncHealthDay).toHaveBeenCalledWith(TEST_TODAY);
    expect(useAppStore.getState().settings.healthSyncEnabled).toBe(true);
    expect(within(screen.getByTestId('health-stats-card')).getByText('560')).toBeTruthy();
  });

  it('keeps the connect card and reports the error when permission is refused', async () => {
    mockHealthService.requestPermissions.mockResolvedValue('denied');
    render(<ActivityScreen />);

    fireEvent.press(await screen.findByLabelText('Connect Apple Health'));

    expect(await screen.findByTestId('health-connect-error')).toBeTruthy();
    expect(useAppStore.getState().settings.healthSyncEnabled).toBe(false);
    expect(screen.queryByTestId('health-stats-card')).toBeNull();
  });

  it('never breaks the screen when the health service throws', async () => {
    mockHealthService.getPermissionStatus.mockRejectedValue(new Error('HealthKit exploded'));
    setEntries([manualEntry]);
    render(<ActivityScreen />);

    expect(await screen.findByText('Morning run')).toBeTruthy();
    expect(screen.getByLabelText('Log workout')).toBeTruthy();
  });

  it('renders the day stats when already connected', async () => {
    connectHealth();
    render(<ActivityScreen />);

    const card = within(await screen.findByTestId('health-stats-card'));
    expect(card.getByText('560')).toBeTruthy();
    expect(card.getByText('47')).toBeTruthy();
    expect(card.getByText('6.3')).toBeTruthy();
    expect(card.getByText('Not synced yet')).toBeTruthy();
  });
});

describe('ActivityScreen — burn totals', () => {
  it('totals workouts and unattributed daily activity', async () => {
    connectHealth();
    setEntries([manualEntry, importedEntry]);
    render(<ActivityScreen />);

    // 300 + 220 logged, 560 active energy - 220 already imported = 340 daily.
    expect(await screen.findByText('860')).toBeTruthy();
    expect(screen.getByText('Workouts  520 kcal')).toBeTruthy();
    expect(screen.getByText('Daily activity  340 kcal')).toBeTruthy();
    expect(screen.getByText("Adds 520 kcal to today's budget")).toBeTruthy();
  });

  it('says when the burn is not added to the budget and links to settings', async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, addExerciseToTarget: false },
    });
    setEntries([manualEntry]);
    render(<ActivityScreen />);

    expect(
      await screen.findByText('Not added to your budget — change in Settings')
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('burn-summary-card'));
    expect(mockRouterPush).toHaveBeenCalledWith('/settings');
  });

  it('charts the last 7 days with totals and an average', async () => {
    setEntries([manualEntry, importedEntry], [olderEntry, manualEntry, importedEntry]);
    render(<ActivityScreen />);

    expect(await screen.findByTestId('line-chart')).toBeTruthy();
    expect(screen.getByText('points:7')).toBeTruthy();
    expect(screen.getByText('series:0,0,0,0,150,0,520')).toBeTruthy();
    expect(screen.getByText('670')).toBeTruthy(); // weekly total
    expect(screen.getByText('96')).toBeTruthy(); // daily average
    expect(screen.getByText('95')).toBeTruthy(); // active minutes
  });
});

describe('ActivityScreen — entries', () => {
  it('shows an empty state that opens the log sheet', async () => {
    setEntries([]);
    render(<ActivityScreen />);

    expect(await screen.findByTestId('activity-empty')).toBeTruthy();
    expect(screen.getByText('No workouts yet')).toBeTruthy();

    fireEvent.press(screen.getAllByLabelText('Log workout')[0]);
    expect(screen.getByTestId('sheet')).toBeTruthy();
  });

  it('badges imported entries and refuses to edit them', async () => {
    connectHealth();
    setEntries([manualEntry, importedEntry]);
    render(<ActivityScreen />);

    expect(await screen.findByTestId('badge-Apple Health')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Outdoor Cycle'));

    expect(Alert.alert).toHaveBeenCalledWith('From Apple Health', expect.stringMatching(/read-only/i));
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('opens a prefilled edit sheet for manual entries', async () => {
    setEntries([manualEntry]);
    render(<ActivityScreen />);

    fireEvent.press(await screen.findByLabelText('Morning run'));

    expect(screen.getByTestId('sheet')).toBeTruthy();
    expect(screen.getByText('Edit workout')).toBeTruthy();
    expect(screen.getByLabelText('Duration').props.value).toBe('30');
    expect(screen.getByLabelText('Calories burned').props.value).toBe('300');
  });

  it('warns that an imported workout may come back before deleting it', async () => {
    connectHealth();
    setEntries([manualEntry, importedEntry]);
    render(<ActivityScreen />);

    fireEvent.press(await screen.findByLabelText('Delete Outdoor Cycle'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete imported workout',
      expect.stringMatching(/next sync may import it again/i),
      expect.any(Array)
    );

    pressAlertDestructive();
    await waitFor(() => expect(mockRepo.deleteExerciseEntry).toHaveBeenCalledWith('hk-1'));
  });

  it('deletes a manual entry after confirmation', async () => {
    setEntries([manualEntry]);
    render(<ActivityScreen />);

    fireEvent.press(await screen.findByLabelText('Delete Morning run'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete workout',
      expect.stringMatching(/can't be undone/i),
      expect.any(Array)
    );

    pressAlertDestructive();
    await waitFor(() => expect(mockRepo.deleteExerciseEntry).toHaveBeenCalledWith('manual-1'));
  });
});

describe('ActivityScreen — logging a workout', () => {
  it('keeps manual logging working after a sync failure', async () => {
    connectHealth();
    mockSyncHealthDay.mockResolvedValue({ ok: false, error: 'HealthKit request timed out' });
    render(<ActivityScreen />);

    fireEvent.press(await screen.findByLabelText('Sync health data now'));
    expect(await screen.findByTestId('health-sync-error')).toBeTruthy();
    expect(screen.getByText('HealthKit request timed out')).toBeTruthy();

    pressLogWorkout();
    fireEvent.press(screen.getByTestId('activity-option-running_8'));
    fireEvent.press(screen.getByLabelText('30 min'));
    fireEvent.press(screen.getByLabelText('Save workout'));

    await waitFor(() => expect(mockRepo.addExerciseEntry).toHaveBeenCalled());
    expect(mockRepo.addExerciseEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        date: TEST_TODAY,
        name: 'Running (8 km/h)',
        category: 'cardio',
        durationMin: 30,
        caloriesBurned: 349, // 8.3 MET x 80 kg x 30 min
        source: 'manual',
        externalId: null,
      })
    );
  });

  it('lets the user override the estimated calories', async () => {
    render(<ActivityScreen />);

    await screen.findByTestId('activity-empty');
    pressLogWorkout();
    fireEvent.press(screen.getByTestId('activity-option-running_8'));
    fireEvent.press(screen.getByLabelText('45 min'));

    expect(screen.getByText(/Estimated: 523 kcal/)).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Calories burned'), '600');
    expect(screen.getByText(/Your value · estimated: 523 kcal/)).toBeTruthy();

    // Changing the duration must not clobber the manual number.
    fireEvent.press(screen.getByLabelText('60 min'));
    expect(screen.getByLabelText('Calories burned').props.value).toBe('600');

    fireEvent.press(screen.getByLabelText('Save workout'));
    await waitFor(() =>
      expect(mockRepo.addExerciseEntry).toHaveBeenCalledWith(
        expect.objectContaining({ durationMin: 60, caloriesBurned: 600 })
      )
    );
  });

  it('restores the estimate when the override is cleared', async () => {
    render(<ActivityScreen />);

    await screen.findByTestId('activity-empty');
    pressLogWorkout();
    fireEvent.press(screen.getByTestId('activity-option-running_8'));
    fireEvent.press(screen.getByLabelText('30 min'));
    fireEvent.changeText(screen.getByLabelText('Calories burned'), '600');
    fireEvent.changeText(screen.getByLabelText('Calories burned'), '');

    expect(screen.getByLabelText('Calories burned').props.value).toBe('349');
    expect(screen.getByText(/Estimated: 349 kcal/)).toBeTruthy();
  });

  it('disables saving until an activity and a duration are set', async () => {
    render(<ActivityScreen />);

    await screen.findByTestId('activity-empty');
    pressLogWorkout();
    fireEvent.press(screen.getByTestId('activity-picker-custom'));

    const save = screen.getByLabelText('Save workout');
    expect(save.props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('Activity name'), 'Snow shovelling');
    expect(screen.getByLabelText('Save workout').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('Duration'), '0');
    expect(screen.getByLabelText('Save workout').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('Duration'), '25');
    expect(screen.getByLabelText('Save workout').props.accessibilityState.disabled).toBe(false);
  });

  it('warns and still estimates when no weight is on record', async () => {
    mockRepo.getLatestWeight.mockResolvedValue(null);
    render(<ActivityScreen />);

    await screen.findByTestId('activity-empty');
    pressLogWorkout();
    fireEvent.press(screen.getByTestId('activity-option-running_8'));
    fireEvent.press(screen.getByLabelText('30 min'));

    expect(screen.getByText(/No weight on record — estimating with 70 kg/)).toBeTruthy();
    expect(screen.getByText(/Estimated: 305 kcal/)).toBeTruthy(); // 8.3 MET x 70 kg x 30 min
  });

  it('reads the weight from a WeightLog row when the repository returns one', async () => {
    mockRepo.getLatestWeight.mockResolvedValue({
      id: 'w1',
      date: TEST_TODAY,
      weightKg: 100,
      bodyFatPct: null,
      note: null,
      source: 'manual',
      createdAt: `${TEST_TODAY}T06:00:00.000Z`,
      updatedAt: `${TEST_TODAY}T06:00:00.000Z`,
    });
    render(<ActivityScreen />);

    await screen.findByTestId('activity-empty');
    pressLogWorkout();
    fireEvent.press(screen.getByTestId('activity-option-running_8'));
    fireEvent.press(screen.getByLabelText('30 min'));

    expect(screen.getByText(/Estimated: 436 kcal/)).toBeTruthy(); // 8.3 MET x 100 kg x 30 min
  });

  it('searches the MET list and supports a custom activity', async () => {
    render(<ActivityScreen />);

    await screen.findByTestId('activity-empty');
    pressLogWorkout();
    fireEvent.changeText(screen.getByLabelText('Find an activity'), 'yoga');

    expect(screen.getByTestId('activity-option-yoga')).toBeTruthy();
    expect(screen.queryByTestId('activity-option-running_8')).toBeNull();
    expect(screen.getByText('Use "yoga"')).toBeTruthy();

    fireEvent.press(screen.getByTestId('activity-option-yoga'));
    fireEvent.press(screen.getByLabelText('15 min'));
    fireEvent.press(screen.getByLabelText('Save workout'));

    await waitFor(() =>
      expect(mockRepo.addExerciseEntry).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Yoga', category: 'flexibility', durationMin: 15 })
      )
    );
  });

  it('saves an edited manual entry through updateExerciseEntry', async () => {
    setEntries([manualEntry]);
    render(<ActivityScreen />);

    fireEvent.press(await screen.findByLabelText('Morning run'));
    fireEvent.changeText(screen.getByLabelText('Duration'), '55');
    fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() =>
      expect(mockRepo.updateExerciseEntry).toHaveBeenCalledWith(
        'manual-1',
        expect.objectContaining({ durationMin: 55, caloriesBurned: 300, source: 'manual' })
      )
    );
  });

  it('surfaces a save failure without closing the sheet', async () => {
    mockRepo.addExerciseEntry.mockRejectedValue(new Error('database is locked'));
    render(<ActivityScreen />);

    await screen.findByTestId('activity-empty');
    pressLogWorkout();
    fireEvent.press(screen.getByTestId('activity-option-running_8'));
    fireEvent.press(screen.getByLabelText('30 min'));
    fireEvent.press(screen.getByLabelText('Save workout'));

    expect(await screen.findByText('database is locked')).toBeTruthy();
    expect(screen.getByTestId('sheet')).toBeTruthy();
  });
});

describe('ActivityScreen — dates and refresh', () => {
  it('blocks logging on a future date', async () => {
    useAppStore.setState({ selectedDate: '2026-03-12' });
    render(<ActivityScreen />);

    expect(await screen.findByTestId('future-date-notice')).toBeTruthy();
    expect(screen.queryByLabelText('Log workout')).toBeNull();
  });

  it('reloads and syncs on pull-to-refresh when health is connected', async () => {
    connectHealth();
    setEntries([manualEntry]);
    render(<ActivityScreen />);
    await screen.findByText('Morning run');

    mockRepo.listExercisesByDate.mockClear();
    mockSyncHealthDay.mockClear();

    fireEvent.press(screen.getByLabelText('mock-refresh'));

    await waitFor(() => expect(mockSyncHealthDay).toHaveBeenCalledWith(TEST_TODAY));
    await waitFor(() => expect(mockRepo.listExercisesByDate).toHaveBeenCalled());
  });

  it('reloads the day when the date changes', async () => {
    setEntries([manualEntry]);
    render(<ActivityScreen />);
    await screen.findByText('Morning run');

    fireEvent.press(screen.getByLabelText('previous-day'));

    await waitFor(() =>
      expect(mockRepo.listExercisesByDate).toHaveBeenCalledWith('2026-03-09')
    );
  });

  it('shows an inline error when the entries fail to load', async () => {
    mockRepo.listExercisesByDate.mockRejectedValue(new Error('no such table'));
    render(<ActivityScreen />);

    expect(await screen.findByTestId('activity-data-error')).toBeTruthy();
    expect(screen.getAllByLabelText('Log workout')[0]).toBeTruthy();
  });
});
