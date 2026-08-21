/**
 * Weigh-in history: month grouping, signed deltas, direction colours for
 * cutting vs bulking, delete confirmation and the "show all" affordance.
 */
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, StyleSheet } from 'react-native';

jest.mock('@/db/repositories', () => require('../testSupport').repositoriesMockFactory());

import { useAppStore } from '@/store/appStore';
import { useTheme } from '@/ui';
import type { WeightLog } from '@/types';

import { makeWeightLog } from '../testSupport';
import { HISTORY_PAGE_SIZE, WeightHistoryList } from '../WeightHistoryList';

const repos = jest.requireMock('@/db/repositories') as {
  deleteWeightLog: jest.Mock;
};

type AlertButton = { text?: string; style?: string; onPress?: () => void };

/** Oldest first, as the component expects. */
const LOGS: WeightLog[] = [
  makeWeightLog({ id: 'a', date: '2026-01-04', weightKg: 82 }),
  makeWeightLog({ id: 'b', date: '2026-02-02', weightKg: 81 }),
  makeWeightLog({
    id: 'c',
    date: '2026-02-18',
    weightKg: 80.5,
    bodyFatPct: 22,
    note: 'morning',
    source: 'healthkit',
  }),
];

function isoPlusDays(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function textOf(testID: string): string {
  return String(screen.getByTestId(testID).props.children);
}

function colorOf(testID: string): string | undefined {
  const flat = StyleSheet.flatten(screen.getByTestId(testID).props.style) as
    | { color?: string }
    | undefined;
  return flat?.color;
}

function themeColors(): { success: string; danger: string; textMuted: string } {
  const { result } = renderHook(() => useTheme());
  return result.current.colors;
}

function renderList(overrides: Partial<React.ComponentProps<typeof WeightHistoryList>> = {}) {
  const props = {
    logs: LOGS,
    unit: 'kg' as const,
    goalKg: 70,
    onEdit: jest.fn(),
    ...overrides,
  };
  return { ...render(<WeightHistoryList {...props} />), props };
}

describe('WeightHistoryList', () => {
  beforeEach(() => {
    useAppStore.setState({ dataVersion: 0 });
  });

  it('renders nothing when there are no logs', () => {
    render(<WeightHistoryList logs={[]} unit="kg" goalKg={70} onEdit={jest.fn()} />);
    expect(screen.queryByTestId('weight-history-list')).toBeNull();
  });

  it('groups entries under month headers, newest month first', () => {
    renderList();
    expect(screen.getByText(/february 2026/i)).toBeTruthy();
    expect(screen.getByText(/january 2026/i)).toBeTruthy();
    expect(screen.getByText('82.0 kg')).toBeTruthy();
    expect(screen.getByText('80.5 kg')).toBeTruthy();
  });

  it('shows an em dash for the oldest entry and signed deltas afterwards', () => {
    renderList();
    expect(textOf('weight-delta-a')).toBe('\u2014');
    expect(textOf('weight-delta-b')).toBe('-1.0 kg');
    expect(textOf('weight-delta-c')).toBe('-0.5 kg');
  });

  it('shows positive deltas with a plus sign', () => {
    renderList({
      logs: [
        makeWeightLog({ id: 'a', date: '2026-02-01', weightKg: 80 }),
        makeWeightLog({ id: 'b', date: '2026-02-08', weightKg: 81.4 }),
      ],
    });
    expect(textOf('weight-delta-b')).toBe('+1.4 kg');
  });

  it('converts deltas to the display unit', () => {
    renderList({ unit: 'lb' });
    expect(textOf('weight-delta-b')).toBe('-2.2 lb');
    expect(screen.getByText('180.8 lb')).toBeTruthy();
  });

  it('renders body fat, note and a source badge for health imports', () => {
    renderList();
    expect(screen.getByText(/22% body fat/)).toBeTruthy();
    expect(screen.getByText(/morning/)).toBeTruthy();
    expect(screen.getByText('Apple Health')).toBeTruthy();
  });

  it('colours a loss green while cutting and red while bulking', () => {
    const colors = themeColors();

    renderList({ goalKg: 70 });
    expect(colorOf('weight-delta-c')).toBe(colors.success);
    screen.unmount();

    renderList({ goalKg: 90 });
    expect(colorOf('weight-delta-c')).toBe(colors.danger);
    expect(colors.success).not.toBe(colors.danger);
  });

  it('colours a gain green while bulking', () => {
    const colors = themeColors();
    const gaining = [
      makeWeightLog({ id: 'a', date: '2026-02-01', weightKg: 80 }),
      makeWeightLog({ id: 'b', date: '2026-02-08', weightKg: 81 }),
    ];

    renderList({ logs: gaining, goalKg: 90 });
    expect(colorOf('weight-delta-b')).toBe(colors.success);
    screen.unmount();

    renderList({ logs: gaining, goalKg: 70 });
    expect(colorOf('weight-delta-b')).toBe(colors.danger);
  });

  it('stays neutral when there is no goal', () => {
    const colors = themeColors();
    renderList({ goalKg: null });
    expect(colorOf('weight-delta-c')).toBe(colors.textMuted);
  });

  it('calls onEdit when a row is tapped', () => {
    const { props } = renderList();
    fireEvent.press(screen.getByText('80.5 kg'));
    expect(props.onEdit).toHaveBeenCalledWith(LOGS[2]);
  });

  it('confirms before deleting on long press', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDeleted = jest.fn();
    renderList({ onDeleted });

    fireEvent(screen.getByText('81.0 kg'), 'longPress');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(repos.deleteWeightLog).not.toHaveBeenCalled();

    const buttons = (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    expect(buttons.map((button) => button.text)).toEqual(['Cancel', 'Delete']);

    const destructive = buttons.find((button) => button.style === 'destructive');
    destructive?.onPress?.();

    await waitFor(() => expect(repos.deleteWeightLog).toHaveBeenCalledWith('b'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(LOGS[1]));
    alertSpy.mockRestore();
  });

  it('warns instead of failing silently when a delete write fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDeleted = jest.fn();
    repos.deleteWeightLog.mockRejectedValueOnce(new Error('db is locked'));
    renderList({ onDeleted });

    fireEvent(screen.getByText('81.0 kg'), 'longPress');
    const confirmButtons = (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    confirmButtons.find((button) => button.style === 'destructive')?.onPress?.();

    await waitFor(() => expect(repos.deleteWeightLog).toHaveBeenCalledWith('b'));
    // The write rejected: the user must be told, not left believing the
    // weigh-in was removed. Every other delete path in the app surfaces this.
    await waitFor(() => expect(alertSpy.mock.calls.length).toBeGreaterThan(1));
    expect(alertSpy.mock.calls[alertSpy.mock.calls.length - 1][0]).toBe(
      'Could not delete weigh-in'
    );
    expect(onDeleted).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('does not delete when the confirmation is cancelled', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    renderList();

    fireEvent(screen.getByText('82.0 kg'), 'longPress');
    const buttons = (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    buttons.find((button) => button.style === 'cancel')?.onPress?.();

    expect(repos.deleteWeightLog).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it(`limits the list to ${HISTORY_PAGE_SIZE} rows until "Show all" is pressed`, () => {
    const many = Array.from({ length: HISTORY_PAGE_SIZE + 20 }, (_, index) =>
      makeWeightLog({
        id: `log-${index}`,
        date: isoPlusDays('2025-06-01', index),
        weightKg: 90 - index * 0.1,
      })
    );

    renderList({ logs: many });

    expect(screen.queryByTestId('weight-delta-log-0')).toBeNull();
    expect(screen.getByTestId(`weight-delta-log-${many.length - 1}`)).toBeTruthy();

    fireEvent.press(screen.getByText(`Show all ${many.length} weigh-ins`));

    expect(screen.getByTestId('weight-delta-log-0')).toBeTruthy();
    expect(screen.queryByText(`Show all ${many.length} weigh-ins`)).toBeNull();
  });
});
