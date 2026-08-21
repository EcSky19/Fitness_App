/**
 * Behaviour tests for the Settings, About and Privacy screens.
 *
 * These run the REAL screens against a REAL in-memory SQLite database (the same
 * `testDb` harness the repository suites use) so destructive actions, exports
 * and restores are exercised end to end. Only the platform edges are mocked:
 * navigation, the health platform, the vision key store, the file system, the
 * document picker and the OS share sheet.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert, Linking, Platform, Share } from 'react-native';

import { addFoodEntry, exportAllData, getDbStats, getSettings } from '@/db/repositories';
import type { NewFoodEntry } from '@/db/repositories';
import { setupTestDb, teardownTestDb, useTestAccount } from '@/db/repositories/__tests__/testDb';
import { SCHEMA_VERSION } from '@/db/schema';
import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';

/* -------------------------------------------------------------------------- */
/* Platform-edge mocks                                                         */
/* -------------------------------------------------------------------------- */

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  setParams: jest.fn(),
  dismissAll: jest.fn(),
};

jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/features/auth/AuthUI', () => ({
  __esModule: true,
  AccountSection: (): null => null,
}));

jest.mock('@/services/foodSearch', () => ({ ensureFoodsSeeded: jest.fn(async () => 0) }));

/**
 * Delegates to the real repositories so the rest of this suite keeps its real
 * SQLite behaviour, while letting one test make a settings write fail.
 */
let mockSettingsSaveError: Error | null = null;
jest.mock('@/db/repositories', () => {
  const actual = jest.requireActual('@/db/repositories');
  return {
    ...actual,
    saveSettings: (...args: unknown[]) =>
      mockSettingsSaveError
        ? Promise.reject(mockSettingsSaveError)
        : actual.saveSettings(...args),
  };
});

const mockIsHealthSupported = jest.fn(() => false);
const mockGetPermissionStatus = jest.fn(async () => 'undetermined' as string);
const mockRequestPermissions = jest.fn(async () => 'denied' as string);

jest.mock('@/services/health', () => {
  const actual = jest.requireActual('@/services/health') as Record<string, unknown>;
  return {
    ...actual,
    isHealthSupported: mockIsHealthSupported,
    healthPlatformLabel: jest.fn(() => 'Health'),
    getHealthService: jest.fn(() => ({
      getPermissionStatus: mockGetPermissionStatus,
      requestPermissions: mockRequestPermissions,
    })),
  };
});

const mockGetApiKey = jest.fn(async () => null as string | null);
const mockSetApiKey = jest.fn(async () => ({ persisted: true }) as { persisted: boolean });
const mockClearApiKey = jest.fn(async () => ({ persisted: true }) as { persisted: boolean });

jest.mock('@/services/vision', () => {
  const actual = jest.requireActual('@/services/vision') as Record<string, unknown>;
  return {
    ...actual,
    getApiKey: mockGetApiKey,
    setApiKey: mockSetApiKey,
    clearApiKey: mockClearApiKey,
  };
});

const mockDocumentPicker = { getDocumentAsync: jest.fn() };
jest.mock('expo-document-picker', () => mockDocumentPicker);

const mockFileText = jest.fn(async (_uri: string) => '{}');
const mockWrites = new Map<string, string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...args: string[]) {
      this.uri = args.length >= 2 ? `${args[0]}${args[1]}` : args[0];
    }
    text(): Promise<string> {
      return mockFileText(this.uri);
    }
    write(contents: string): void {
      mockWrites.set(this.uri, contents);
    }
    info(): { uri: string } {
      return { uri: this.uri };
    }
  }
  return { __esModule: true, File, Paths: { cache: 'file:///cache/' } };
});

const mockSharing = {
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async (_uri: string, _opts?: unknown) => undefined),
};
jest.mock('expo-sharing', () => mockSharing);

/* -------------------------------------------------------------------------- */
/* Spies + helpers                                                             */
/* -------------------------------------------------------------------------- */

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
const shareSpy = jest
  .spyOn(Share, 'share')
  .mockResolvedValue({ action: 'sharedAction' } as Awaited<ReturnType<typeof Share.share>>);
const canOpenSpy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);

const REAL_PLATFORM_OS = Platform.OS;
function setPlatformOS(os: typeof Platform.OS): void {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

type AlertButton = { text?: string; onPress?: () => void; style?: string };

function findAlert(titleMatch: RegExp): unknown[] | null {
  const calls = alertSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const title = calls[i][0];
    if (typeof title === 'string' && titleMatch.test(title)) return calls[i];
  }
  return null;
}

function alertBody(titleMatch: RegExp): string {
  const call = findAlert(titleMatch);
  if (!call) throw new Error(`No alert titled ${titleMatch}`);
  return typeof call[1] === 'string' ? call[1] : '';
}

async function pressAlertButton(titleMatch: RegExp, buttonText: string): Promise<void> {
  const call = findAlert(titleMatch);
  if (!call) throw new Error(`No alert titled ${titleMatch}`);
  const buttons = (call[2] as AlertButton[] | undefined) ?? [];
  const button = buttons.find((b) => b.text === buttonText);
  if (!button) throw new Error(`Alert ${String(call[0])} has no "${buttonText}" button`);
  await act(async () => {
    button.onPress?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSettings(): Promise<void> {
  const SettingsScreen = require('../settings').default as React.ComponentType;
  render(<SettingsScreen />);
  await flush();
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

beforeEach(async () => {
  await setupTestDb();
  await useTestAccount('test-account-a');

  alertSpy.mockImplementation(() => {});
  shareSpy.mockResolvedValue({ action: 'sharedAction' } as Awaited<ReturnType<typeof Share.share>>);
  canOpenSpy.mockResolvedValue(true);
  openUrlSpy.mockResolvedValue(true as never);
  mockGetApiKey.mockResolvedValue(null);
  mockSetApiKey.mockResolvedValue({ persisted: true });
  mockClearApiKey.mockResolvedValue({ persisted: true });
  mockIsHealthSupported.mockReturnValue(false);
  mockGetPermissionStatus.mockResolvedValue('undetermined');
  mockRequestPermissions.mockResolvedValue('denied');
  mockDocumentPicker.getDocumentAsync.mockReset();
  mockFileText.mockReset();
  mockFileText.mockResolvedValue('{}');

  useAppStore.setState({
    profile: null,
    goal: null,
    settings: { ...DEFAULT_SETTINGS },
    isReady: true,
    dataVersion: 0,
  });
  useAuthStore.setState({
    session: {
      accountId: 'test-account-a',
      email: 'test-account-a@example.test',
      displayName: 'Test',
      signedInAt: '2026-01-01T00:00:00.000Z',
    },
    status: 'signed_in',
  });
});

afterEach(async () => {
  await teardownTestDb();
});

/* -------------------------------------------------------------------------- */
/* About screen                                                                */
/* -------------------------------------------------------------------------- */

describe('About screen', () => {
  it('renders app information without crashing', async () => {
    const AboutScreen = require('../about').default as React.ComponentType;
    render(<AboutScreen />);
    await flush();

    expect(screen.getByTestId('about-screen')).toBeTruthy();
    expect(screen.getByTestId('about-version')).toBeTruthy();
    expect(screen.getByText(`v${SCHEMA_VERSION}`)).toBeTruthy();
  });

  it('opens a well-formed licences URL', async () => {
    const AboutScreen = require('../about').default as React.ComponentType;
    render(<AboutScreen />);
    await flush();

    await act(async () => {
      fireEvent.press(screen.getByTestId('about-open-source-licenses'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openUrlSpy).toHaveBeenCalledTimes(1);
    const url = openUrlSpy.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\//);
  });

  it('navigates to the privacy policy screen', async () => {
    const AboutScreen = require('../about').default as React.ComponentType;
    render(<AboutScreen />);
    await flush();

    fireEvent.press(screen.getByTestId('about-privacy-policy'));

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(String(mockRouter.push.mock.calls[0][0])).toMatch(/privacy$/);
  });
});

/* -------------------------------------------------------------------------- */
/* Privacy screen                                                              */
/* -------------------------------------------------------------------------- */

describe('Privacy screen', () => {
  it('renders every policy section and third-party link without crashing', async () => {
    const PrivacyScreen = require('../privacy').default as React.ComponentType;
    render(<PrivacyScreen />);
    await flush();

    expect(screen.getByTestId('privacy-screen')).toBeTruthy();
    expect(screen.getByTestId('privacy-third-party-links')).toBeTruthy();
    expect(screen.getByTestId('privacy-link-0')).toBeTruthy();
  });

  it('opens well-formed external privacy links', async () => {
    const PrivacyScreen = require('../privacy').default as React.ComponentType;
    render(<PrivacyScreen />);
    await flush();

    await act(async () => {
      fireEvent.press(screen.getByTestId('privacy-link-0'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openUrlSpy).toHaveBeenCalledTimes(1);
    expect(openUrlSpy.mock.calls[0][0]).toMatch(/^https:\/\//);
  });
});

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

describe('Settings — export', () => {
  it('shares a JSON snapshot of the data', async () => {
    await renderSettings();

    await act(async () => {
      fireEvent.press(screen.getByTestId('data-export'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(mockSharing.shareAsync).toHaveBeenCalledTimes(1);
    const sharedUri = mockSharing.shareAsync.mock.calls[0][0] as string;
    const parsed = JSON.parse(mockWrites.get(sharedUri) ?? '') as { version: number };
    expect(parsed.version).toBe(SCHEMA_VERSION);
  });

  it('surfaces a failure when the OS share sheet throws', async () => {
    mockSharing.shareAsync.mockRejectedValueOnce(new Error('sharing unavailable'));
    await renderSettings();

    await act(async () => {
      fireEvent.press(screen.getByTestId('data-export'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(findAlert(/Export failed/)).not.toBeNull();
  });

  it('shares the actual data as a file, not just a local file path', async () => {
    setPlatformOS('android');
    try {
      await addFoodEntry(SNACK);
      await renderSettings();

      fireEvent.press(screen.getByTestId('data-export'));
      // On Android the screen asks for confirmation before exporting.
      await pressAlertButton(/Export full health history/, 'Export JSON file');
      await flush();

      // The user's data must actually reach the receiving app. Sharing a bare
      // path string hands them a "backup" containing none of their data, and
      // sharing the whole JSON as `message` text can exceed Android's Binder
      // limit for exactly the long-time users with the most history to lose.
      expect(mockSharing.shareAsync).toHaveBeenCalledTimes(1);
      expect(shareSpy).not.toHaveBeenCalled();

      const [sharedUri, opts] = mockSharing.shareAsync.mock.calls[0];
      expect(opts).toMatchObject({ mimeType: 'application/json' });

      const written = mockWrites.get(sharedUri as string) ?? '';
      const parsed = JSON.parse(written) as { version?: number; foodEntries?: unknown[] };
      expect(parsed.version).toBe(SCHEMA_VERSION);
      expect((parsed.foodEntries ?? []).length).toBe(1);
    } finally {
      setPlatformOS(REAL_PLATFORM_OS);
    }
  });

  it('falls back to a text share when no share sheet is available', async () => {
    mockSharing.isAvailableAsync.mockResolvedValueOnce(false);
    await addFoodEntry(SNACK);
    await renderSettings();

    fireEvent.press(screen.getByTestId('data-export'));
    await flush();

    expect(mockSharing.shareAsync).not.toHaveBeenCalled();
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const message = (shareSpy.mock.calls[0][0] as { message?: string }).message ?? '';
    const parsed = JSON.parse(message) as { version?: number };
    expect(parsed.version).toBe(SCHEMA_VERSION);
  });
});

/* -------------------------------------------------------------------------- */
/* Import / restore                                                            */
/* -------------------------------------------------------------------------- */

const SNACK: NewFoodEntry = {
  date: '2026-08-19',
  mealType: 'snack',
  foodId: null,
  name: 'Greek yogurt',
  brand: null,
  quantity: 1,
  unit: 'serving',
  servingLabel: '1 cup (245 g)',
  gramsTotal: 245,
  macros: { calories: 146, protein: 25, carbs: 8, fat: 1 },
  photoUri: null,
  source: 'quick_add',
  visionConfidence: null,
  wasEdited: false,
};

function pickFileReturning(text: string): void {
  mockDocumentPicker.getDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///picked/backup.json', name: 'backup.json' }],
  });
  mockFileText.mockResolvedValue(text);
}

async function pressImport(): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId('data-import'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

describe('Settings — restore from backup', () => {
  it('does nothing when the file picker is cancelled', async () => {
    mockDocumentPicker.getDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
    await renderSettings();

    await pressImport();

    expect(findAlert(/Restore backup/)).toBeNull();
    expect(findAlert(/Restore/)).toBeNull();
  });

  it('rejects a file that is not valid JSON', async () => {
    pickFileReturning('this is not json at all');
    await renderSettings();

    await pressImport();

    const call = findAlert(/Could not read that file/);
    expect(call).not.toBeNull();
    expect(String(call?.[1])).toMatch(/not valid JSON/i);
    // Never reaches the merge/replace prompt.
    expect(findAlert(/Restore backup/)).toBeNull();
  });

  it('refuses a backup from a newer schema version with a clear message', async () => {
    pickFileReturning(
      JSON.stringify({
        version: SCHEMA_VERSION + 1,
        exportedAt: new Date().toISOString(),
        profile: null,
        goals: [],
        foods: [],
        foodEntries: [],
        recipes: [],
        exerciseEntries: [],
        weightLogs: [],
        settings: {},
      })
    );
    await renderSettings();

    await pressImport();
    await pressAlertButton(/Restore backup/, 'Merge');
    await flush();

    const body = alertBody(/Restore failed/);
    expect(body).toMatch(/newer than supported/i);
  });

  it('surfaces the importer warning when a photo cannot be restored', async () => {
    await addFoodEntry(SNACK);
    const payload = (await exportAllData()) as { foodEntries: { photoUri: string | null }[] };
    // A backup only carries photo *paths*; this one points outside the account
    // folder, so the importer must drop it and warn the user.
    payload.foodEntries[0].photoUri = 'file:///foreign/does-not-belong.jpg';
    pickFileReturning(JSON.stringify(payload));

    await renderSettings();

    await pressImport();
    await pressAlertButton(/Restore backup/, 'Replace');
    await flush();

    const body = alertBody(/Restore complete/);
    expect(body).toMatch(/could not be restored/i);
  });

  it('replace mode wipes existing rows before importing', async () => {
    await addFoodEntry(SNACK);
    await addFoodEntry({ ...SNACK, name: 'Banana', mealType: 'breakfast' });
    // A backup that contains a single, different entry.
    const payload = (await exportAllData()) as { foodEntries: unknown[] };
    payload.foodEntries = [payload.foodEntries[0]];
    pickFileReturning(JSON.stringify(payload));

    await renderSettings();
    expect((await getDbStats()).foodEntries).toBe(2);

    await pressImport();
    await pressAlertButton(/Restore backup/, 'Replace');
    await flush();

    expect(findAlert(/Restore complete/)).not.toBeNull();
    expect((await getDbStats()).foodEntries).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Clear all data                                                              */
/* -------------------------------------------------------------------------- */

async function openClearSheet(): Promise<void> {
  fireEvent.press(screen.getByTestId('data-clear'));
  await act(async () => {
    await pressAlertButton(/Clear all data\?/, 'Continue');
  });
}

describe('Settings — clear all data', () => {
  it('wipes the database and returns the user to onboarding after confirmation', async () => {
    await addFoodEntry(SNACK);
    useAppStore.setState({
      profile: { id: 'p' } as never,
      goal: { id: 'g' } as never,
    });
    await renderSettings();
    expect((await getDbStats()).foodEntries).toBe(1);

    await openClearSheet();
    fireEvent.changeText(screen.getByTestId('clear-confirm-input'), 'DELETE');
    await act(async () => {
      fireEvent.press(screen.getByTestId('clear-confirm'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect((await getDbStats()).foodEntries).toBe(0);
    expect(useAppStore.getState().profile).toBeNull();
    expect(useAppStore.getState().goal).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('does not delete anything until the confirmation word matches', async () => {
    await addFoodEntry(SNACK);
    await renderSettings();

    await openClearSheet();
    fireEvent.changeText(screen.getByTestId('clear-confirm-input'), 'nope');
    await act(async () => {
      fireEvent.press(screen.getByTestId('clear-confirm'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect((await getDbStats()).foodEntries).toBe(1);
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/onboarding');
  });
});

/* -------------------------------------------------------------------------- */
/* Vision provider privacy gate                                                */
/* -------------------------------------------------------------------------- */

describe('Settings — vision provider', () => {
  it('asks before switching to a provider that uploads photos', async () => {
    await renderSettings();
    const openai = await screen.findByLabelText('OpenAI');

    await act(async () => {
      fireEvent.press(openai);
    });

    // The switch must NOT take effect until the user confirms the upload.
    expect(findAlert(/Send photos to OpenAI/)).not.toBeNull();
    expect(useAppStore.getState().settings.visionProvider).toBe('mock');

    await pressAlertButton(/Send photos to OpenAI/, 'Use provider');

    expect(useAppStore.getState().settings.visionProvider).toBe('openai');
  });
});

/* -------------------------------------------------------------------------- */
/* Vision API key handling (secrets)                                           */
/* -------------------------------------------------------------------------- */

async function renderSettingsWithProvider(providerId: string): Promise<void> {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, visionProvider: providerId } });
  await renderSettings();
}

describe('Settings — vision API key', () => {
  it('saves a typed key against the active provider and clears the field', async () => {
    await renderSettingsWithProvider('openai');

    fireEvent.changeText(screen.getByTestId('vision-key-input'), 'sk-live-abcd1234');
    await act(async () => {
      fireEvent.press(screen.getByTestId('vision-key-save'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(mockSetApiKey).toHaveBeenCalledWith('openai', 'sk-live-abcd1234');
    expect(screen.getByTestId('vision-key-input').props.value).toBe('');
  });

  it('warns when the key could only be held for the session', async () => {
    mockSetApiKey.mockResolvedValueOnce({ persisted: false });
    await renderSettingsWithProvider('openai');

    fireEvent.changeText(screen.getByTestId('vision-key-input'), 'sk-live-abcd1234');
    await act(async () => {
      fireEvent.press(screen.getByTestId('vision-key-save'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(findAlert(/only saved for this session/i)).not.toBeNull();
  });

  it('surfaces an error when the secure store write throws', async () => {
    mockSetApiKey.mockRejectedValueOnce(new Error('keychain locked'));
    await renderSettingsWithProvider('openai');

    fireEvent.changeText(screen.getByTestId('vision-key-input'), 'sk-live-abcd1234');
    await act(async () => {
      fireEvent.press(screen.getByTestId('vision-key-save'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    const call = findAlert(/Could not save key/);
    expect(call).not.toBeNull();
    expect(String(call?.[1])).toMatch(/keychain locked/);
  });

  it('masks a saved key so the raw value never reaches the screen', async () => {
    mockGetApiKey.mockResolvedValue('sk-live-SUPERSECRETvalue-7788');
    await renderSettingsWithProvider('openai');

    const mask = await screen.findByTestId('vision-key-mask');
    expect(mask.props.children).toMatch(/7788$/);
    expect(JSON.stringify(mask.props.children)).not.toContain('SUPERSECRET');
  });

  it('warns when a persisted key could not be cleared', async () => {
    mockGetApiKey.mockResolvedValue('sk-live-abcd1234');
    mockClearApiKey.mockResolvedValueOnce({ persisted: false });
    await renderSettingsWithProvider('openai');

    await screen.findByTestId('vision-key-mask');
    await act(async () => {
      fireEvent.press(screen.getByTestId('vision-key-clear'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(mockClearApiKey).toHaveBeenCalledWith('openai');
    expect(findAlert(/Could not clear persisted key/)).not.toBeNull();
  });

  it('switches back to the on-device provider with no upload prompt', async () => {
    await renderSettingsWithProvider('openai');

    await act(async () => {
      fireEvent.press(await screen.findByLabelText('Demo (on-device)'));
    });
    await flush();

    expect(findAlert(/Send photos/)).toBeNull();
    expect(useAppStore.getState().settings.visionProvider).toBe('mock');
  });
});

/* -------------------------------------------------------------------------- */
/* Health connect                                                              */
/* -------------------------------------------------------------------------- */

describe('Settings — connect health', () => {
  it('tells the user when the platform denies access', async () => {
    mockIsHealthSupported.mockReturnValue(true);
    mockRequestPermissions.mockResolvedValue('denied');
    await renderSettings();

    await act(async () => {
      fireEvent.press(screen.getByTestId('health-connect'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(findAlert(/Not connected/)).not.toBeNull();
  });

  it('does not warn when access is granted', async () => {
    mockIsHealthSupported.mockReturnValue(true);
    mockRequestPermissions.mockResolvedValue('granted');
    mockGetPermissionStatus.mockResolvedValue('granted');
    await renderSettings();

    await act(async () => {
      fireEvent.press(screen.getByTestId('health-connect'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    expect(findAlert(/Not connected/)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Merge import                                                                */
/* -------------------------------------------------------------------------- */

describe('Settings — merge restore', () => {
  it('keeps existing rows and adds only the missing ones', async () => {
    await addFoodEntry(SNACK);
    const payload = (await exportAllData()) as {
      foodEntries: Record<string, unknown>[];
    };
    // A backup whose single entry is NOT already in the database.
    payload.foodEntries[0] = {
      ...payload.foodEntries[0],
      id: 'backup-entry-new',
      name: 'Imported apple',
    };
    pickFileReturning(JSON.stringify(payload));

    await renderSettings();
    expect((await getDbStats()).foodEntries).toBe(1);

    await pressImport();
    await pressAlertButton(/Restore backup/, 'Merge');
    await flush();

    expect(findAlert(/Restore complete/)).not.toBeNull();
    // Original kept, backup added.
    expect((await getDbStats()).foodEntries).toBe(2);
  });
});

describe('Settings — data section', () => {
  it('shows the true stored-record counts', async () => {
    await addFoodEntry(SNACK);
    await addFoodEntry({ ...SNACK, name: 'Banana', mealType: 'breakfast' });
    await renderSettings();

    // Label is humanised from the raw stat key, value is the real row count.
    expect(await screen.findByText('Food Entries')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('refuses a structurally valid file that is not a MacroTrack backup', async () => {
    pickFileReturning(JSON.stringify({ hello: 'world' }));
    await renderSettings();

    await pressImport();
    await pressAlertButton(/Restore backup/, 'Merge');
    await flush();

    expect(alertBody(/Restore failed/)).toMatch(/version/i);
  });

  it('navigates to the in-app privacy and about screens', async () => {
    await renderSettings();

    fireEvent.press(screen.getByTestId('setting-privacy'));
    fireEvent.press(screen.getByTestId('setting-about'));

    expect(mockRouter.push).toHaveBeenCalledWith('/privacy');
    expect(mockRouter.push).toHaveBeenCalledWith('/about');
  });
});

describe('Settings — toggles persist', () => {
  it('persists "add exercise to my budget" across a remount', async () => {
    await renderSettings();
    expect(useAppStore.getState().settings.addExerciseToTarget).toBe(true);

    await act(async () => {
      fireEvent(screen.getByTestId('setting-exercise-switch'), 'valueChange', false);
    });
    await flush();

    // Immediately reflected in the store...
    expect(useAppStore.getState().settings.addExerciseToTarget).toBe(false);
    // ...and written to the database.
    expect((await getSettings()).addExerciseToTarget).toBe(false);

    // Simulate a cold start: wipe the cache and re-read from SQLite.
    await act(async () => {
      useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
      await useAppStore.getState().bootstrap();
    });
    expect(useAppStore.getState().settings.addExerciseToTarget).toBe(false);
  });

  it('reverts and reports a toggle whose write never reached the database', async () => {
    // The store update is optimistic. If the write fails and we stay silent the
    // toggle looks saved, then quietly reverts on the next cold start.
    await renderSettings();
    const initialUnit = useAppStore.getState().settings.weightUnit;
    const otherLabel = initialUnit === 'kg' ? 'Pounds' : 'Kilograms';

    mockSettingsSaveError = new Error('disk is full');
    try {
      await act(async () => {
        fireEvent.press(screen.getByText(otherLabel));
      });
      await flush();

      expect(screen.getByTestId('settings-save-error')).toBeTruthy();
      expect(useAppStore.getState().settings.weightUnit).toBe(initialUnit);
    } finally {
      mockSettingsSaveError = null;
    }
  });
});

