/**
 * Stand-in for `@/domain` used by the activity tests. Mirrors the real
 * signatures with a small, deterministic activity table and a frozen "today".
 *
 * Not a test file (no `.test.` suffix) — imported by the tests in this folder.
 */
import type { ExerciseCategory, ISODate, Macros } from '@/types';

export const TEST_TODAY: ISODate = '2026-03-10';

export interface TestActivity {
  id: string;
  name: string;
  category: ExerciseCategory;
  met: number;
}

export const MET_ACTIVITIES: TestActivity[] = [
  { id: 'running_8', name: 'Running (8 km/h)', category: 'cardio', met: 8.3 },
  { id: 'walking_5', name: 'Walking (5 km/h)', category: 'cardio', met: 3.5 },
  { id: 'cycling_20', name: 'Cycling (20 km/h)', category: 'cardio', met: 8 },
  { id: 'weights', name: 'Weight training', category: 'strength', met: 5 },
  { id: 'soccer', name: 'Soccer', category: 'sports', met: 7 },
  { id: 'yoga', name: 'Yoga', category: 'flexibility', met: 3 },
];

export function calcCaloriesBurned(met: number, weightKg: number, durationMin: number): number {
  return Math.round(((met * 3.5 * weightKg) / 200) * durationMin);
}

export function findActivity(id: string): TestActivity | undefined {
  return MET_ACTIVITIES.find((activity) => activity.id === id);
}

export function searchActivities(query: string): TestActivity[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return MET_ACTIVITIES;
  return MET_ACTIVITIES.filter((activity) => activity.name.toLowerCase().includes(needle));
}

export function todayISO(): ISODate {
  return TEST_TODAY;
}

export function addDaysISO(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function lastNDaysISO(n: number, end: ISODate = TEST_TODAY): ISODate[] {
  return Array.from({ length: n }, (_, i) => addDaysISO(end, -(n - 1 - i)));
}

export function formatDateLabel(date: ISODate): string {
  if (date === TEST_TODAY) return 'Today';
  if (date === addDaysISO(TEST_TODAY, -1)) return 'Yesterday';
  return date;
}

export function isFutureISO(date: ISODate): boolean {
  return date > TEST_TODAY;
}

export function formatEnergy(kcal: number): string {
  return `${Math.round(kcal)} kcal`;
}

export function roundTo(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce<Macros>(
    (acc, m) => ({
      calories: acc.calories + m.calories,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
