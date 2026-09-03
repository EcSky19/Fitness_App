/**
 * Logging-streak math: how many consecutive days (ending today or yesterday)
 * the user logged at least one food entry.
 *
 * Pure TypeScript: no React Native, no Expo, no I/O.
 */
import type { ISODate } from '@/types';
import { addDaysISO, diffDaysISO } from './dates';

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

/**
 * Longest run of consecutive logged days on or before `referenceDate`
 * (a personal best, not necessarily the run still in progress).
 *
 * Dates after `referenceDate` are ignored so a clock skew or a stray future
 * entry can never inflate today's record, and duplicate dates collapse
 * before the run length is measured.
 */
export function computeLongestStreak(
  loggedDates: Iterable<ISODate>,
  referenceDate: ISODate
): number {
  const sorted = [...new Set(loggedDates)]
    .filter((date) => date <= referenceDate)
    .sort();
  if (sorted.length === 0) return 0;

  let longest = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    current = diffDaysISO(sorted[i], sorted[i - 1]) === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}
