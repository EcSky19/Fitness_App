/**
 * Food-logging streak state: the current run plus the personal-best run.
 *
 * Deliberately independent of `useDashboardData`'s `selectedDate`: the streak
 * always reflects the real logging streak as of today, even while the user is
 * browsing an earlier day in the diary or dashboard.
 */
import { useCallback } from 'react';

import { listLoggedDates } from '@/db/repositories';
import { addDaysISO, computeLoggingStreak, computeLongestStreak, todayISO } from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';

/** Long enough that no real streak gets truncated, short enough to stay a cheap query. */
const LOOKBACK_DAYS = 400;

export interface LoggingStreak {
  /** Consecutive days ending today (or yesterday, if today isn't logged yet). */
  current: number;
  /** Longest run ever, within the lookback window — a personal best. */
  longest: number;
}

const ZERO_STREAK: LoggingStreak = { current: 0, longest: 0 };

export function useLoggingStreak(): LoggingStreak {
  const loader = useCallback(async (): Promise<LoggingStreak> => {
    const today = todayISO();
    const dates = await listLoggedDates(addDaysISO(today, -LOOKBACK_DAYS));
    return {
      current: computeLoggingStreak(dates, today),
      longest: computeLongestStreak(dates, today),
    };
  }, []);

  const { data } = useAsyncData<LoggingStreak>(loader, [], ZERO_STREAK);
  return data;
}
