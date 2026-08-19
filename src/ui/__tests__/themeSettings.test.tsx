/**
 * Theme wiring: `useTheme()` must follow `settings.theme` from the app store
 * (so /settings re-renders the whole app) and fall back to the OS scheme when
 * the setting is `system`.
 */
import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { DEFAULT_SETTINGS, useAppStore } from '@/store/appStore';
import { darkPalette, lightPalette, useTheme } from '@/ui';

let mockSystemScheme: 'light' | 'dark' | null = 'dark';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));

jest.mock('@/db/repositories', () => ({
  saveSettings: jest.fn(async () => undefined),
}));

function Probe(): React.JSX.Element {
  const theme = useTheme();
  return <Text testID="probe">{`${theme.colors.bg}|${theme.isDark}`}</Text>;
}

function probeText(): string {
  return screen.getByTestId('probe').props.children as string;
}

function setTheme(theme: 'system' | 'light' | 'dark'): void {
  act(() => {
    useAppStore.getState().updateSettings({ theme });
  });
}

beforeEach(() => {
  mockSystemScheme = 'dark';
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe('theme follows the app store', () => {
  it('re-renders in light mode when the setting changes, without remounting', () => {
    render(<Probe />);
    expect(probeText()).toBe(`${darkPalette.bg}|true`);

    setTheme('light');
    expect(probeText()).toBe(`${lightPalette.bg}|false`);

    setTheme('dark');
    expect(probeText()).toBe(`${darkPalette.bg}|true`);
  });

  it('follows the OS scheme when the setting is "system"', () => {
    mockSystemScheme = 'light';
    render(<Probe />);
    expect(probeText()).toBe(`${lightPalette.bg}|false`);
  });

  it('defaults to dark when the OS reports no preference', () => {
    mockSystemScheme = null;
    render(<Probe />);
    expect(probeText()).toBe(`${darkPalette.bg}|true`);
  });

  it('ignores the OS scheme once an explicit theme is chosen', () => {
    mockSystemScheme = 'light';
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });

    render(<Probe />);
    expect(probeText()).toBe(`${darkPalette.bg}|true`);
  });
});
