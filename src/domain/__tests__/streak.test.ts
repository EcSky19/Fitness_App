import { addDaysISO } from '../dates';
import { computeLoggingStreak, computeLongestStreak } from '../streak';

const TODAY = '2026-09-03';

function daysBack(n: number): string {
  return addDaysISO(TODAY, -n);
}

describe('computeLoggingStreak', () => {
  it('is 0 when nothing was ever logged', () => {
    expect(computeLoggingStreak([], TODAY)).toBe(0);
  });

  it('counts a run of consecutive days ending today', () => {
    const logged = [daysBack(0), daysBack(1), daysBack(2)];
    expect(computeLoggingStreak(logged, TODAY)).toBe(3);
  });

  it('stays alive off yesterday when today has no entry yet', () => {
    const logged = [daysBack(1), daysBack(2), daysBack(3)];
    expect(computeLoggingStreak(logged, TODAY)).toBe(3);
  });

  it('is 0 once a full day has passed with nothing logged', () => {
    const logged = [daysBack(2), daysBack(3), daysBack(4)];
    expect(computeLoggingStreak(logged, TODAY)).toBe(0);
  });

  it('stops at the first gap looking backward', () => {
    const logged = [daysBack(0), daysBack(1), daysBack(3), daysBack(4)];
    expect(computeLoggingStreak(logged, TODAY)).toBe(2);
  });

  it('ignores dates after the reference date', () => {
    const logged = [daysBack(0), addDaysISO(TODAY, 1), addDaysISO(TODAY, 2)];
    expect(computeLoggingStreak(logged, TODAY)).toBe(1);
  });

  it('ignores duplicate dates and out-of-order input', () => {
    const logged = [daysBack(1), daysBack(0), daysBack(0), daysBack(2), daysBack(1)];
    expect(computeLoggingStreak(logged, TODAY)).toBe(3);
  });

  it('accepts a Set as well as an array', () => {
    const logged = new Set([daysBack(0), daysBack(1)]);
    expect(computeLoggingStreak(logged, TODAY)).toBe(2);
  });
});

describe('computeLongestStreak', () => {
  it('is 0 when nothing was ever logged', () => {
    expect(computeLongestStreak([], TODAY)).toBe(0);
  });

  it('is 1 for a single logged day', () => {
    expect(computeLongestStreak([daysBack(5)], TODAY)).toBe(1);
  });

  it('finds the longest run even when it is not the most recent one', () => {
    // A 4-day run three weeks back beats the 2-day run ending today.
    const logged = [
      daysBack(0),
      daysBack(1),
      daysBack(20),
      daysBack(21),
      daysBack(22),
      daysBack(23),
    ];
    expect(computeLongestStreak(logged, TODAY)).toBe(4);
  });

  it('ignores dates after the reference date', () => {
    const logged = [daysBack(0), addDaysISO(TODAY, 1), addDaysISO(TODAY, 2), addDaysISO(TODAY, 3)];
    expect(computeLongestStreak(logged, TODAY)).toBe(1);
  });

  it('ignores duplicate dates and out-of-order input', () => {
    const logged = [daysBack(2), daysBack(0), daysBack(1), daysBack(1), daysBack(0)];
    expect(computeLongestStreak(logged, TODAY)).toBe(3);
  });

  it('accepts a Set as well as an array', () => {
    const logged = new Set([daysBack(0), daysBack(1), daysBack(2)]);
    expect(computeLongestStreak(logged, TODAY)).toBe(3);
  });
});
