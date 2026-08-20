/**
 * The visible day must follow the wall clock.
 *
 * `selectedDate` is seeded once, when the store module is first evaluated, and
 * a phone keeps a backgrounded app's JS state alive for days. Without an
 * explicit rollover the diary stays on the launch day, so breakfast logged the
 * next morning lands in yesterday — today reads empty and yesterday reads
 * overstated. Both totals are then wrong for a user who trusts them.
 */
import { act } from '@testing-library/react-native';

import { useAppStore } from '../appStore';
import { msUntilNextLocalMidnight } from '../useDayRollover';

/** Freezes the wall clock at a local date/time. */
function setNow(iso: string): void {
  jest.setSystemTime(new Date(iso));
}

describe('syncToday', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setNow('2024-03-10T09:00:00');
    useAppStore.setState({
      selectedDate: '2024-03-10',
      lastKnownToday: '2024-03-10',
      dataVersion: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing while the day has not changed', () => {
    setNow('2024-03-10T23:59:00');

    act(() => {
      expect(useAppStore.getState().syncToday()).toBe(false);
    });

    expect(useAppStore.getState().selectedDate).toBe('2024-03-10');
    expect(useAppStore.getState().dataVersion).toBe(0);
  });

  it('moves the diary to the new day once midnight passes', () => {
    setNow('2024-03-11T07:30:00');

    act(() => {
      expect(useAppStore.getState().syncToday()).toBe(true);
    });

    expect(useAppStore.getState().selectedDate).toBe('2024-03-11');
    expect(useAppStore.getState().lastKnownToday).toBe('2024-03-11');
  });

  it('invalidates cached data so screens re-query the new day', () => {
    setNow('2024-03-11T07:30:00');

    act(() => {
      useAppStore.getState().syncToday();
    });

    expect(useAppStore.getState().dataVersion).toBe(1);
  });

  it('keeps the user where they are when they stepped back deliberately', () => {
    // Reviewing an earlier day: rolling them forward would lose their place.
    useAppStore.setState({ selectedDate: '2024-03-04', lastKnownToday: '2024-03-10' });
    setNow('2024-03-11T07:30:00');

    act(() => {
      expect(useAppStore.getState().syncToday()).toBe(false);
    });

    expect(useAppStore.getState().selectedDate).toBe('2024-03-04');
    // The anchor still advances, so tomorrow's check compares against reality.
    expect(useAppStore.getState().lastKnownToday).toBe('2024-03-11');
  });

  it('survives the app being left open for several days', () => {
    setNow('2024-03-14T06:00:00');

    act(() => {
      expect(useAppStore.getState().syncToday()).toBe(true);
    });

    expect(useAppStore.getState().selectedDate).toBe('2024-03-14');
  });

  it('follows the clock backwards across a date line', () => {
    setNow('2024-03-09T22:00:00');

    act(() => {
      expect(useAppStore.getState().syncToday()).toBe(true);
    });

    expect(useAppStore.getState().selectedDate).toBe('2024-03-09');
  });

  it('is idempotent — a second check on the same day is a no-op', () => {
    setNow('2024-03-11T07:30:00');

    act(() => {
      useAppStore.getState().syncToday();
      expect(useAppStore.getState().syncToday()).toBe(false);
    });

    expect(useAppStore.getState().dataVersion).toBe(1);
  });
});

describe('msUntilNextLocalMidnight', () => {
  it('counts down to the next local midnight, not a UTC one', () => {
    const ms = msUntilNextLocalMidnight(new Date(2024, 2, 10, 23, 0, 0));
    expect(ms).toBe(60 * 60 * 1000);
  });

  it('never returns a zero or negative delay that would spin the timer', () => {
    const exactlyMidnight = msUntilNextLocalMidnight(new Date(2024, 2, 10, 0, 0, 0));
    expect(exactlyMidnight).toBeGreaterThan(0);
  });

  it('re-arms at least hourly so a DST shift cannot overshoot the day', () => {
    const ms = msUntilNextLocalMidnight(new Date(2024, 2, 10, 3, 0, 0));
    expect(ms).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
