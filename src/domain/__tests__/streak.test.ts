import { addDaysISO } from '../dates';
import { computeLoggingStreak } from '../streak';

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
