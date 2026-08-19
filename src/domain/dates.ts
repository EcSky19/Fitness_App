/**
 * ISO date (`'YYYY-MM-DD'`) helpers.
 *
 * Two rules keep the classic off-by-one-day bug away:
 *  1. `isoToDate` builds a **local** midnight `Date` (`new Date(y, m - 1, d)`),
 *     never `new Date('2025-03-08')` which is parsed as UTC.
 *  2. Calendar arithmetic (`addDaysISO`, `diffDaysISO`, `rangeISO`) runs on UTC
 *     timestamps of naked calendar dates, so DST transitions can never produce
 *     a 23/25 hour day or a fractional day difference.
 *
 * Pure TypeScript: no React Native, no Expo, no locale dependencies.
 */
import type { ISODate } from '@/types';

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const MS_PER_DAY = 86400000;

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

interface CalendarParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
}

/** Parse `'YYYY-MM-DD'` into calendar parts, or `null` when unparseable. */
function parseParts(d: ISODate): CalendarParts | null {
  if (typeof d !== 'string') return null;
  const match = ISO_PATTERN.exec(d.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** UTC timestamp for the naked calendar date — used for DST-proof arithmetic. */
function toUtcStamp(d: ISODate): number | null {
  const parts = parseParts(d);
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function stampToISO(stamp: number): ISODate {
  const date = new Date(stamp);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Format a `Date` using its **local** calendar fields. */
export function toISO(d: Date): ISODate {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return toISO(new Date());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today in the device's local timezone. */
export function todayISO(): ISODate {
  return toISO(new Date());
}

/**
 * Parse `'YYYY-MM-DD'` to **local midnight**.
 * Invalid input falls back to today's local midnight (never an `Invalid Date`).
 */
export function isoToDate(d: ISODate): Date {
  const parts = parseParts(d);
  if (!parts) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** Calendar-day addition. `addDaysISO('2025-03-08', 1) === '2025-03-09'` even across DST. */
export function addDaysISO(d: ISODate, n: number): ISODate {
  const stamp = toUtcStamp(d);
  const days = Number.isFinite(n) ? Math.trunc(n) : 0;
  if (stamp === null) return addDaysISO(todayISO(), days);
  return stampToISO(stamp + days * MS_PER_DAY);
}

/**
 * Whole calendar days between two dates, `a - b` (matching `date-fns`
 * `differenceInCalendarDays(left, right)`): later-first yields a positive value.
 */
export function diffDaysISO(a: ISODate, b: ISODate): number {
  const left = toUtcStamp(a);
  const right = toUtcStamp(b);
  if (left === null || right === null) return 0;
  return Math.round((left - right) / MS_PER_DAY);
}

/** `'Today' | 'Yesterday' | 'Tomorrow' | 'Mon, Jan 5'` */
export function formatDateLabel(d: ISODate): string {
  const offset = diffDaysISO(d, todayISO());
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  const date = isoToDate(d);
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/** `'Jan 5'` */
export function formatDateShort(d: ISODate): string {
  const date = isoToDate(d);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/** Inclusive ascending range. Returns `[]` when `end` precedes `start`. */
export function rangeISO(start: ISODate, end: ISODate): ISODate[] {
  const from = toUtcStamp(start);
  const to = toUtcStamp(end);
  if (from === null || to === null || to < from) return [];
  const out: ISODate[] = [];
  for (let stamp = from; stamp <= to; stamp += MS_PER_DAY) {
    out.push(stampToISO(stamp));
  }
  return out;
}

/** Start of the containing week, Sunday-based (matches `date-fns` default). */
export function startOfWeekISO(d: ISODate): ISODate {
  const date = isoToDate(d);
  return addDaysISO(toISO(date), -date.getDay());
}

/** `n` ascending dates ending at `end` (default today), inclusive of `end`. */
export function lastNDaysISO(n: number, end: ISODate = todayISO()): ISODate[] {
  const count = Number.isFinite(n) ? Math.trunc(n) : 0;
  if (count <= 0) return [];
  const last = toUtcStamp(end) === null ? todayISO() : end;
  return rangeISO(addDaysISO(last, -(count - 1)), last);
}

/** True when `d` is strictly after today (local calendar). */
export function isFutureISO(d: ISODate): boolean {
  return diffDaysISO(d, todayISO()) > 0;
}
