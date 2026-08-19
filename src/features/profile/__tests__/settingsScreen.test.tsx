import React from 'react';
import { Alert, Share } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useAppStore, DEFAULT_SETTINGS } from '@/store/appStore';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3' } } }));

const keyStore: Record<string, string | null> = {};

jest.mock('@/services/vision', () => ({
  listVisionProviders: jest.fn(() => [
    { id: 'mock', label: 'Mock', requiresApiKey: false, configured: true },
    { id: 'openai', label: 'OpenAI', requiresApiKey: true, configured: Boolean(keyStore.openai) },
    { id: 'gemini', label: 'Gemini', requiresApiKey: true, configured: Boolean(keyStore.gemini) },
  ]),
  getApiKey: jest.fn(async (id: string) => keyStore[id] ?? null),
  setApiKey: jest.fn(async (id: string, key: string) => {
    keyStore[id] = key;
  }),
  clearApiKey: jest.fn(async (id: string) => {
    keyStore[id] = null;
  }),
}));

jest.mock('@/services/health', () => ({
  HEALTH_PERMISSIONS: ['steps', 'activeEnergyBurned'],
  isHealthSupported: jest.fn(() => true),
  healthPlatformLabel: jest.fn(() => 'Apple Health'),
  getHealthService: jest.fn(() => ({
    getPermissionStatus: jest.fn(async () => 'undetermined'),
    requestPermissions: jest.fn(async () => 'granted'),
  })),
}));

jest.mock('@/db/repositories', () => ({
  getDbStats: jest.fn(async () => ({ foodEntries: 42, weightLogs: 7 })),
  exportAllData: jest.fn(async () => ({ profile: { name: 'Alex' }, entries: [] })),
  clearAllData: jest.fn(async () => undefined),
  saveSettings: jest.fn(async () => undefined),
}));

import * as repos from '@/db/repositories';
import * as vision from '@/services/vision';

import SettingsScreen from '../../../../app/settings';

const REAL_KEY = 'sk-live-SUPERSECRET-abcd1234';

/** Every string rendered into the tree, so a leaked secret cannot hide. */
function flattenText(node: unknown, out: string[]): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'number') out.push(String(node));
  else if (Array.isArray(node)) node.forEach((child) => flattenText(child, out));
  else if (node && typeof node === 'object' && 'children' in node) {
    flattenText((node as { children?: unknown }).children, out);
  }
  return out;
}

function renderedText(): string[] {
  return flattenText(screen.toJSON(), []);
}

/** Flushes the pending async reload the screen kicks off after a write. */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function setProvider(id: string): void {
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, visionProvider: id as never },
    isReady: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(keyStore)) delete keyStore[k];
  setProvider('mock');
});

describe('Settings — units and appearance', () => {
  it('persists a unit change through the store and the repository', async () => {
    render(<SettingsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByText('Pounds'));

    expect(useAppStore.getState().settings.weightUnit).toBe('lb');
    expect(repos.saveSettings).toHaveBeenCalledWith({ weightUnit: 'lb' });
    await flushAsync();
  });

  it('shows the app version from expo-constants', async () => {
    render(<SettingsScreen />);
    await flushAsync();
    expect(screen.getByTestId('app-version').props.children).toBe('1.2.3');
  });
});

describe('Settings — AI provider key', () => {
  it('explains that the mock provider needs no key', async () => {
    render(<SettingsScreen />);
    await flushAsync();
    expect(screen.getByTestId('vision-mock-note')).toBeTruthy();
    expect(screen.queryByTestId('vision-key-input')).toBeNull();
    expect(screen.getByText(/simulated data/i)).toBeTruthy();
  });

  it('masks the key after saving and never renders it in full', async () => {
    setProvider('openai');
    render(<SettingsScreen />);

    await flushAsync();
    expect(screen.getByTestId('vision-key-input')).toBeTruthy();
    expect(screen.queryByTestId('vision-key-mask')).toBeNull();

    fireEvent.changeText(screen.getByTestId('vision-key-input'), REAL_KEY);
    fireEvent.press(screen.getByTestId('vision-key-save'));

    await waitFor(() => expect(vision.setApiKey).toHaveBeenCalledWith('openai', REAL_KEY));
    await flushAsync();

    const mask = screen.getByTestId('vision-key-mask').props.children as string;
    expect(mask).toContain('1234');
    expect(mask).toContain('••••••••');
    expect(mask).not.toContain('SUPERSECRET');

    // The raw key must not survive anywhere in the rendered tree.
    expect(screen.queryByText(REAL_KEY)).toBeNull();
    expect(renderedText().join('\u0000')).not.toContain('SUPERSECRET');
    // The input is cleared so the key is not left sitting in the field.
    expect(screen.getByTestId('vision-key-input').props.value).toBe('');
    expect(screen.getByTestId('vision-key-badge')).toBeTruthy();
  });

  it('clears a stored key', async () => {
    keyStore.openai = REAL_KEY;
    setProvider('openai');
    render(<SettingsScreen />);

    await flushAsync();
    expect(screen.getByTestId('vision-key-mask')).toBeTruthy();
    fireEvent.press(screen.getByTestId('vision-key-clear'));

    await waitFor(() => expect(vision.clearApiKey).toHaveBeenCalledWith('openai'));
    await flushAsync();
    expect(screen.queryByTestId('vision-key-mask')).toBeNull();
  });
});

describe('Settings — data', () => {
  it('renders the database stats', async () => {
    render(<SettingsScreen />);
    await flushAsync();
    expect(screen.getByTestId('db-stats')).toBeTruthy();
    expect(screen.getByText('Food Entries')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('exports pretty JSON through Share', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    render(<SettingsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByTestId('data-export'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    await flushAsync();
    await flushAsync();
    const message = shareSpy.mock.calls[0][0].message as string;
    expect(message).toContain('\n  ');
    expect(JSON.parse(message)).toEqual({ profile: { name: 'Alex' }, entries: [] });
    shareSpy.mockRestore();
  });

  it('reports an export failure instead of throwing', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    (repos.exportAllData as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    render(<SettingsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByTestId('data-export'));
    await flushAsync();

    expect(alertSpy).toHaveBeenCalledWith('Export failed', 'disk full');
    alertSpy.mockRestore();
  });

  it('requires a double confirmation before clearing all data', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    render(<SettingsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByTestId('data-clear'));

    // 1st gate: a native alert, nothing deleted yet, no confirm sheet yet.
    expect(alertSpy).toHaveBeenCalled();
    expect(repos.clearAllData).not.toHaveBeenCalled();
    expect(screen.queryByTestId('clear-confirm-sheet')).toBeNull();

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const proceed = buttons.find((b) => b.text === 'Continue');
    expect(proceed).toBeDefined();
    await act(async () => {
      proceed?.onPress?.();
    });

    // 2nd gate: the typed acknowledgement.
    expect(screen.getByTestId('clear-confirm-sheet')).toBeTruthy();
    fireEvent.press(screen.getByTestId('clear-confirm'));
    expect(repos.clearAllData).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('clear-confirm-input'), 'nope');
    fireEvent.press(screen.getByTestId('clear-confirm'));
    expect(repos.clearAllData).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('clear-confirm-input'), 'DELETE');
    fireEvent.press(screen.getByTestId('clear-confirm'));

    await waitFor(() => expect(repos.clearAllData).toHaveBeenCalledTimes(1));
    await flushAsync();
    expect(useAppStore.getState().profile).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
    alertSpy.mockRestore();
  });
});
