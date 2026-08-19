import {
  addDaysISO,
  diffDaysISO,
  formatDateLabel,
  formatDateShort,
  isFutureISO,
  isoToDate,
  lastNDaysISO,
  rangeISO,
  startOfWeekISO,
  toISO,
  todayISO,
} from '../dates';

describe('dates — parsing and formatting', () => {
  it('formats a Date from its LOCAL calendar fields', () => {
    expect(toISO(new Date(2025, 0, 5))).toBe('2025-01-05');
    expect(toISO(new Date(2025, 11, 31, 23, 59, 59))).toBe('2025-12-31');
  });

  it('parses an ISO date as LOCAL midnight, not UTC', () => {
    const d = isoToDate('2025-03-08');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('round-trips toISO(isoToDate(x)) === x for tricky dates', () => {
    for (const iso of [
      '2025-01-01',
      '2025-03-09', // US DST spring forward
      '2025-11-02', // US DST fall back
      '2024-02-29', // leap day
      '2025-12-31',
    ]) {
      expect(toISO(isoToDate(iso))).toBe(iso);
    }
  });

  it('returns today for todayISO()', () => {
    expect(todayISO()).toBe(toISO(new Date()));
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('dates — calendar arithmetic', () => {
  it('adds days across a DST spring-forward boundary', () => {
    expect(addDaysISO('2025-03-08', 1)).toBe('2025-03-09');
    expect(addDaysISO('2025-03-09', 1)).toBe('2025-03-10');
    expect(addDaysISO('2025-03-08', 7)).toBe('2025-03-15');
  });

  it('adds days across a DST fall-back boundary', () => {
    expect(addDaysISO('2025-11-01', 1)).toBe('2025-11-02');
    expect(addDaysISO('2025-11-02', 1)).toBe('2025-11-03');
  });

  it('adds days across month boundaries', () => {
    expect(addDaysISO('2025-01-31', 1)).toBe('2025-02-01');
    expect(addDaysISO('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysISO('2025-04-30', 1)).toBe('2025-05-01');
  });

  it('adds days across year boundaries', () => {
    expect(addDaysISO('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysISO('2025-12-25', 10)).toBe('2026-01-04');
  });

  it('supports zero and negative offsets', () => {
    expect(addDaysISO('2025-06-15', 0)).toBe('2025-06-15');
    expect(addDaysISO('2025-06-15', -15)).toBe('2025-05-31');
  });

  it('diffs whole calendar days (left - right), DST-proof', () => {
    expect(diffDaysISO('2025-03-10', '2025-03-08')).toBe(2);
    expect(diffDaysISO('2025-11-03', '2025-11-01')).toBe(2);
    expect(diffDaysISO('2025-01-01', '2025-01-01')).toBe(0);
    expect(diffDaysISO('2025-01-01', '2025-01-10')).toBe(-9);
    expect(diffDaysISO('2026-01-01', '2025-01-01')).toBe(365);
    expect(diffDaysISO('2025-01-01', '2024-01-01')).toBe(366); // 2024 is a leap year
  });

  it('is exactly inverse of addDaysISO', () => {
    for (const start of ['2025-03-07', '2025-11-01', '2024-12-30']) {
      for (const n of [-30, -1, 0, 1, 5, 100]) {
        expect(diffDaysISO(addDaysISO(start, n), start)).toBe(n);
      }
    }
  });
});

describe('dates — labels', () => {
  it('labels relative days', () => {
    expect(formatDateLabel(todayISO())).toBe('Today');
    expect(formatDateLabel(addDaysISO(todayISO(), -1))).toBe('Yesterday');
    expect(formatDateLabel(addDaysISO(todayISO(), 1))).toBe('Tomorrow');
  });

  it('labels other days with weekday + short date', () => {
    expect(formatDateLabel('2020-01-06')).toBe('Mon, Jan 6');
    expect(formatDateLabel('2020-12-25')).toBe('Fri, Dec 25');
  });

  it('formats a short date', () => {
    expect(formatDateShort('2020-01-06')).toBe('Jan 6');
    expect(formatDateShort('2020-12-25')).toBe('Dec 25');
  });
});

describe('dates — ranges', () => {
  it('builds an inclusive ascending range across a month boundary', () => {
    expect(rangeISO('2025-01-30', '2025-02-02')).toEqual([
      '2025-01-30',
      '2025-01-31',
      '2025-02-01',
      '2025-02-02',
    ]);
  });

  it('builds a range across a year boundary and a DST boundary', () => {
    expect(rangeISO('2025-12-31', '2026-01-02')).toEqual([
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
    ]);
    expect(rangeISO('2025-03-08', '2025-03-10')).toEqual([
      '2025-03-08',
      '2025-03-09',
      '2025-03-10',
    ]);
  });

  it('returns a single day when start === end, and [] when reversed', () => {
    expect(rangeISO('2025-05-01', '2025-05-01')).toEqual(['2025-05-01']);
    expect(rangeISO('2025-05-10', '2025-05-01')).toEqual([]);
  });

  it('finds the Sunday-based start of week', () => {
    expect(startOfWeekISO('2025-01-08')).toBe('2025-01-05'); // Wed -> Sun
    expect(startOfWeekISO('2025-01-05')).toBe('2025-01-05'); // Sun -> itself
    expect(startOfWeekISO('2025-01-11')).toBe('2025-01-05'); // Sat -> Sun
    expect(startOfWeekISO('2025-01-01')).toBe('2024-12-29'); // crosses the year
  });

  it('returns the last N days ending at the anchor', () => {
    expect(lastNDaysISO(3, '2025-03-10')).toEqual(['2025-03-08', '2025-03-09', '2025-03-10']);
    expect(lastNDaysISO(1, '2025-03-10')).toEqual(['2025-03-10']);
    expect(lastNDaysISO(0)).toEqual([]);
    expect(lastNDaysISO(-5)).toEqual([]);

    const week = lastNDaysISO(7);
    expect(week).toHaveLength(7);
    expect(week[6]).toBe(todayISO());
    expect(week[0]).toBe(addDaysISO(todayISO(), -6));
  });
});

describe('dates — predicates and resilience', () => {
  it('detects future dates', () => {
    expect(isFutureISO(addDaysISO(todayISO(), 1))).toBe(true);
    expect(isFutureISO(todayISO())).toBe(false);
    expect(isFutureISO(addDaysISO(todayISO(), -1))).toBe(false);
  });

  it('degrades gracefully on malformed input', () => {
    expect(Number.isNaN(isoToDate('not-a-date').getTime())).toBe(false);
    expect(toISO(new Date('nope'))).toBe(todayISO());
    expect(addDaysISO('garbage', 0)).toBe(todayISO());
    expect(diffDaysISO('garbage', '2025-01-01')).toBe(0);
    expect(rangeISO('garbage', '2025-01-01')).toEqual([]);
    expect(addDaysISO('2025-01-01', Number.NaN)).toBe('2025-01-01');
  });
});
