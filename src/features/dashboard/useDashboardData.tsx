/**
 * Data orchestration for the Today dashboard.
 *
 * All nutrition math is delegated to `@/domain` (`buildDailySummary`); this
 * module only fetches rows, resolves targets and groups them per day.
 */
import { useCallback, useMemo } from 'react';

import {
  listEntriesByDate,
  listEntriesByDateRange,
  listExercisesByDate,
  listExercisesByDateRange,
  listWeightLogs,
} from '@/db/repositories';
import { buildDailySummary, buildTargetsForProfile, lastNDaysISO } from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useAppStore } from '@/store/appStore';
import type {
  DailySummary,
  ExerciseEntry,
  FoodEntry,
  Goal,
  ISODate,
  MacroTargets,
  UserProfile,
  WeightLog,
} from '@/types';

export const ZERO_TARGETS: MacroTargets = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/** Number of days rendered by the weekly strip. */
export const WEEK_LENGTH = 7;

/** Division that never yields NaN/Infinity. */
export function safeRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  const ratio = value / total;
  return Number.isFinite(ratio) ? Math.max(ratio, 0) : 0;
}

export function safePercent(value: number, total: number): number {
  return Math.round(safeRatio(value, total) * 100);
}

/** Rounds and adds thousands separators without relying on Intl. */
export function formatNumber(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded)}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatGrams(value: number): string {
  return `${Math.round(Number.isFinite(value) ? value : 0)}`;
}

// `inferMealType` used to live here with a 10:30 breakfast cutoff that
// disagreed with the diary's 11:00 one, so the same food could land in a
// different meal depending on which screen opened the logger. It now has a
// single source of truth in the diary hook; this re-export keeps the existing
// `@/features/dashboard/useDashboardData` import site (app/(tabs)/index.tsx)
// working unchanged.
export { inferMealType } from '@/features/diary/useEntryDraft';

export function resolveTargets(goal: Goal | null, profile: UserProfile | null): MacroTargets {
  if (goal && goal.targets && Number.isFinite(goal.targets.calories)) return goal.targets;
  if (profile) {
    try {
      const derived = buildTargetsForProfile(profile, 'maintain', 0, 'balanced');
      if (derived && Number.isFinite(derived.calories)) return derived;
    } catch {
      // Fall back to zeroed targets rather than crashing the home screen.
    }
  }
  return ZERO_TARGETS;
}

interface RawDashboardData {
  days: ISODate[];
  entries: FoodEntry[];
  exercises: ExerciseEntry[];
  weightLogs: WeightLog[];
  rangeEntries: FoodEntry[];
  rangeExercises: ExerciseEntry[];
}

const EMPTY_RAW: RawDashboardData = {
  days: [],
  entries: [],
  exercises: [],
  weightLogs: [],
  rangeEntries: [],
  rangeExercises: [],
};

export interface DashboardState {
  selectedDate: ISODate;
  profile: UserProfile | null;
  goal: Goal | null;
  targets: MacroTargets;
  /** False when neither an active goal nor a profile yields calorie targets. */
  hasTargets: boolean;
  addExerciseToTarget: boolean;
  summary: DailySummary;
  week: DailySummary[];
  entries: FoodEntry[];
  exercises: ExerciseEntry[];
  weightLogs: WeightLog[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function groupByDate<T extends { date: ISODate }>(rows: T[]): Map<ISODate, T[]> {
  const grouped = new Map<ISODate, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.date);
    if (bucket) bucket.push(row);
    else grouped.set(row.date, [row]);
  }
  return grouped;
}

export function useDashboardData(): DashboardState {
  const selectedDate = useAppStore((s) => s.selectedDate);
  const profile = useAppStore((s) => s.profile);
  const goal = useAppStore((s) => s.goal);
  const addExerciseToTarget = useAppStore((s) => s.settings.addExerciseToTarget);

  const targets = useMemo(() => resolveTargets(goal, profile), [goal, profile]);

  const loader = useCallback(async (): Promise<RawDashboardData> => {
    const days = [...(lastNDaysISO(WEEK_LENGTH, selectedDate) ?? [])].sort();
    const start = days[0] ?? selectedDate;
    const end = days[days.length - 1] ?? selectedDate;

    const [entries, exercises, weightLogs, rangeEntries, rangeExercises] = await Promise.all([
      listEntriesByDate(selectedDate),
      listExercisesByDate(selectedDate),
      listWeightLogs(120),
      listEntriesByDateRange(start, end),
      listExercisesByDateRange(start, end),
    ]);

    return {
      days: days.length > 0 ? days : [selectedDate],
      entries: entries ?? [],
      exercises: exercises ?? [],
      weightLogs: weightLogs ?? [],
      rangeEntries: rangeEntries ?? [],
      rangeExercises: rangeExercises ?? [],
    };
  }, [selectedDate]);

  const { data, loading, error, reload } = useAsyncData<RawDashboardData>(
    loader,
    [selectedDate],
    EMPTY_RAW
  );

  const summary = useMemo(
    () =>
      buildDailySummary({
        date: selectedDate,
        entries: data.entries,
        exercises: data.exercises,
        targets,
        addExerciseToTarget,
      }),
    [selectedDate, data.entries, data.exercises, targets, addExerciseToTarget]
  );

  const week = useMemo(() => {
    const entriesByDate = groupByDate(data.rangeEntries);
    const exercisesByDate = groupByDate(data.rangeExercises);
    const days = data.days.length > 0 ? data.days : [selectedDate];
    return days.map((date) =>
      buildDailySummary({
        date,
        entries: entriesByDate.get(date) ?? [],
        exercises: exercisesByDate.get(date) ?? [],
        targets,
        addExerciseToTarget,
      })
    );
  }, [
    data.days,
    data.rangeEntries,
    data.rangeExercises,
    selectedDate,
    targets,
    addExerciseToTarget,
  ]);

  const weightLogs = useMemo(
    () => [...data.weightLogs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [data.weightLogs]
  );

  return {
    selectedDate,
    profile,
    goal,
    targets,
    hasTargets: Number.isFinite(targets.calories) && targets.calories > 0,
    addExerciseToTarget,
    summary,
    week,
    entries: data.entries,
    exercises: data.exercises,
    weightLogs,
    loading,
    error,
    reload,
  };
}
