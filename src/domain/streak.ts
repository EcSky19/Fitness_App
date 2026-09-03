/**
 * Logging-streak math: how many consecutive days (ending today or yesterday)
 * the user logged at least one food entry.
 *
 * Pure TypeScript: no React Native, no Expo, no I/O.
 */
import type { ISODate } from '@/types';
import { addDaysISO } from './dates';

/**
 * Counts consecutive logged days ending at `referenceDate`, walking backward.
 *
 * A streak stays "alive" through today even before today has been logged: if
 * `referenceDate` itself has no entry yet, the count instead anchors on
 * `referenceDate - 1` so someone who logged every day through yesterday still
 * sees their streak (it will lapse to 0 once a full day passes with nothing
 * logged). If neither `referenceDate` nor the day before has an entry, the
 * streak is 0 regardless of how it looked further back — a single missed day
 * breaks it.
 */
export function computeLoggingStreak(
  loggedDates: Iterable<ISODate>,
  referenceDate: ISODate
): number {
  const logged = new Set(loggedDates);

  let cursor = referenceDate;
  if (!logged.has(cursor)) {
    cursor = addDaysISO(referenceDate, -1);
    if (!logged.has(cursor)) return 0;
  }

  let streak = 0;
  while (logged.has(cursor)) {
    streak += 1;
    cursor = addDaysISO(cursor, -1);
  }
  return streak;
}
