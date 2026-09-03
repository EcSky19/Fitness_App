/**
 * Current food-logging streak (consecutive days with at least one entry).
 *
 * Deliberately independent of `useDashboardData`'s `selectedDate`: the streak
 * always reflects the real logging streak as of today, even while the user is
 * browsing an earlier day in the diary or dashboard.
 */
import { useCallback } from 'react';

import { listLoggedDates } from '@/db/repositories';
import { addDaysISO, computeLoggingStreak, todayISO } from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';

/** Long enough that no real streak gets truncated, short enough to stay a cheap query. */
const LOOKBACK_DAYS = 400;

export function useLoggingStreak(): number {
  const loader = useCallback(async (): Promise<number> => {
    const today = todayISO();
    const dates = await listLoggedDates(addDaysISO(today, -LOOKBACK_DAYS));
    return computeLoggingStreak(dates, today);
  }, []);

  const { data } = useAsyncData<number>(loader, [], 0);
  return data;
}
