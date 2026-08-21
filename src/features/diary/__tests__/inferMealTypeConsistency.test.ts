/**
 * `inferMealType` is a single wall-clock -> meal mapping that MUST agree no
 * matter which screen starts a food log. It used to be forked: the diary hook
 * used an 11:00 breakfast cutoff while the dashboard used 10:30, so the same
 * food logged at (say) 10:45 was attributed to breakfast from the food-search /
 * barcode-scan / scan / quick-add paths but to lunch from the dashboard's own
 * button. This test imports both live implementations and asserts they resolve
 * identically for every minute of the day, so any future re-fork of a threshold
 * is caught instead of silently shipping a self-contradicting calorie tracker.
 */
import { inferMealType as dashboardInferMealType } from '@/features/dashboard/useDashboardData';
import { inferMealType as diaryInferMealType } from '@/features/diary/useEntryDraft';

const at = (hour: number, minute: number): Date => new Date(2026, 0, 5, hour, minute);
const label = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

describe('inferMealType is a single source of truth across features', () => {
  it('attributes a 10:45 log to the same meal from the diary and the dashboard', () => {
    const midMorning = at(10, 45);
    expect(dashboardInferMealType(midMorning)).toBe(diaryInferMealType(midMorning));
    // Canonical decision: keep the 11:00 breakfast cutoff shared by the diary,
    // food-search, barcode-scan and scan entry points (the majority of logging
    // routes), so a 10:45 log is still breakfast everywhere.
    expect(diaryInferMealType(midMorning)).toBe('breakfast');
    expect(dashboardInferMealType(midMorning)).toBe('breakfast');
  });

  it('resolves every minute of the day identically from both entry points', () => {
    const disagreements: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      for (let minute = 0; minute < 60; minute += 1) {
        const when = at(hour, minute);
        const fromDashboard = dashboardInferMealType(when);
        const fromDiary = diaryInferMealType(when);
        if (fromDashboard !== fromDiary) {
          disagreements.push(
            `${label(hour, minute)}: dashboard=${fromDashboard} diary=${fromDiary}`,
          );
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});
