/**
 * Keeps the visible day in step with the wall clock.
 *
 * `selectedDate` is seeded once, when the store module is first evaluated.
 * Phones keep a backgrounded app's JS state alive for days, so nothing would
 * otherwise move it off the launch day: someone who opened the app the next
 * morning would log breakfast into yesterday's diary, leaving today empty and
 * yesterday overstated. A calorie tracker that quietly files food under the
 * wrong day is worse than useless, because the user trusts the totals.
 *
 * Two triggers, because either alone leaves a gap:
 *   - returning to the foreground, which covers the app being backgrounded
 *     across midnight (the common case), and
 *   - a timer aimed at the next local midnight, which covers the app being left
 *     open and visible. The timer is scheduled to the exact moment rather than
 *     polling, so an idle app does no repeated work.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAppStore } from './appStore';

/** Milliseconds until the next local midnight, clamped to a sane range. */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const delta = next.getTime() - now.getTime();
  // A backwards clock change or a DST edge can make this non-positive; never
  // schedule a zero-delay timer, which would spin.
  if (!Number.isFinite(delta) || delta <= 0) return 60_000;
  // setTimeout truncates above ~24.8 days, and a DST transition can stretch a
  // day to 25 hours; re-arming hourly at worst is cheap and always correct.
  return Math.min(delta, 60 * 60 * 1000);
}

export function useDayRollover(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const check = (): void => {
      if (cancelled) return;
      useAppStore.getState().syncToday();
    };

    const schedule = (): void => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        check();
        schedule();
      }, msUntilNextLocalMidnight());
    };

    const onAppStateChange = (status: AppStateStatus): void => {
      if (status !== 'active') return;
      // The device clock may have moved a long way while suspended, so re-check
      // immediately and re-aim the timer at the new midnight.
      check();
      schedule();
    };

    check();
    schedule();
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);
}

export default useDayRollover;
