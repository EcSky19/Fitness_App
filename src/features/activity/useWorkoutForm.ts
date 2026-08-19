/**
 * Form state for logging / editing a workout.
 *
 * Calorie rule: the burn is auto-estimated from MET x body weight x duration
 * until the user types their own number. From that moment the manual value wins
 * and is preserved while they keep tweaking the duration. Clearing the field
 * (or picking a different activity) hands control back to the estimator.
 */
import { useCallback, useMemo, useState } from 'react';

import { calcCaloriesBurned, findActivity, isFutureISO } from '@/domain';
import type { ExerciseCategory, ExerciseEntry, ISODate } from '@/types';

/** Structural mirror of an entry in `MET_ACTIVITIES`. */
export interface MetActivityOption {
  id: string;
  name: string;
  category: ExerciseCategory;
  met: number;
}

/**
 * Body weight assumed when nothing is on record (rounded adult average).
 * The UI surfaces this so the user knows the estimate is approximate.
 */
export const DEFAULT_WEIGHT_KG = 70;

/** MET applied to free-text "custom" activities: general moderate effort. */
export const CUSTOM_ACTIVITY_MET = 5;

export interface WorkoutFormOptions {
  /** Date the sheet opens on (usually the screen's selected date). */
  date: ISODate;
  /** Latest weight on record; null falls back to {@link DEFAULT_WEIGHT_KG}. */
  weightKg: number | null;
  /** Entry being edited, if any. */
  entry?: ExerciseEntry | null;
}

export interface WorkoutFormValues {
  activityId: string | null;
  name: string;
  category: ExerciseCategory;
  durationMin: number | null;
  /** User-typed calories; null means "follow the estimate". */
  caloriesOverride: number | null;
  notes: string;
  date: ISODate;
}

export type WorkoutPayload = Omit<ExerciseEntry, 'id' | 'createdAt' | 'updatedAt'>;

export interface WorkoutForm {
  values: WorkoutFormValues;
  /** True while the activity is free text rather than a MET preset. */
  isCustom: boolean;
  isEditing: boolean;
  met: number;
  weightKgUsed: number;
  usingFallbackWeight: boolean;
  estimatedCalories: number;
  /** What will actually be saved. */
  calories: number;
  isCaloriesOverridden: boolean;
  canSave: boolean;
  dateError: string | null;
  durationError: string | null;
  nameError: string | null;
  selectActivity: (activity: MetActivityOption) => void;
  selectCustom: (name: string) => void;
  setName: (name: string) => void;
  setCategory: (category: ExerciseCategory) => void;
  setDurationMin: (minutes: number | null) => void;
  setCalories: (calories: number | null) => void;
  useEstimate: () => void;
  setNotes: (notes: string) => void;
  setDate: (date: ISODate) => void;
  reset: () => void;
  buildPayload: () => WorkoutPayload;
}

function initialValues(options: WorkoutFormOptions): WorkoutFormValues {
  const { entry } = options;
  if (entry) {
    return {
      activityId: null,
      name: entry.name,
      category: entry.category,
      durationMin: entry.durationMin,
      caloriesOverride: entry.caloriesBurned,
      notes: entry.notes ?? '',
      date: entry.date,
    };
  }
  return {
    activityId: null,
    name: '',
    category: 'cardio',
    durationMin: null,
    caloriesOverride: null,
    notes: '',
    date: options.date,
  };
}

function safeFindActivity(id: string | null): MetActivityOption | null {
  if (!id) return null;
  try {
    return (findActivity(id) as MetActivityOption | null | undefined) ?? null;
  } catch {
    return null;
  }
}

export function useWorkoutForm(options: WorkoutFormOptions): WorkoutForm {
  const { weightKg, entry } = options;
  const [values, setValues] = useState<WorkoutFormValues>(() => initialValues(options));

  const patch = useCallback((next: Partial<WorkoutFormValues>) => {
    setValues((current) => ({ ...current, ...next }));
  }, []);

  const usingFallbackWeight = !(typeof weightKg === 'number' && weightKg > 0);
  const weightKgUsed = usingFallbackWeight ? DEFAULT_WEIGHT_KG : (weightKg as number);

  const activity = useMemo(() => safeFindActivity(values.activityId), [values.activityId]);
  const met = activity?.met ?? CUSTOM_ACTIVITY_MET;

  const estimatedCalories = useMemo(() => {
    const minutes = values.durationMin;
    if (!minutes || minutes <= 0) return 0;
    try {
      const kcal = calcCaloriesBurned(met, weightKgUsed, minutes);
      return Number.isFinite(kcal) ? Math.max(0, Math.round(kcal)) : 0;
    } catch {
      return 0;
    }
  }, [met, weightKgUsed, values.durationMin]);

  const isCaloriesOverridden = values.caloriesOverride !== null;
  const calories = isCaloriesOverridden ? (values.caloriesOverride as number) : estimatedCalories;

  const isFuture = useMemo(() => {
    try {
      return isFutureISO(values.date);
    } catch {
      return false;
    }
  }, [values.date]);

  const trimmedName = values.name.trim();
  const nameError = trimmedName.length === 0 ? 'Pick or name an activity.' : null;
  const durationError =
    values.durationMin !== null && values.durationMin <= 0
      ? 'Duration must be more than 0 minutes.'
      : null;
  const dateError = isFuture ? "You can't log a workout in the future." : null;

  const hasDuration = values.durationMin !== null && values.durationMin > 0;
  const canSave = !nameError && hasDuration && !durationError && !dateError;

  const selectActivity = useCallback(
    (next: MetActivityOption) => {
      patch({
        activityId: next.id,
        name: next.name,
        category: next.category,
        caloriesOverride: null,
      });
    },
    [patch]
  );

  const selectCustom = useCallback(
    (name: string) => {
      patch({ activityId: null, name, caloriesOverride: null });
    },
    [patch]
  );

  const setName = useCallback((name: string) => patch({ name }), [patch]);
  const setCategory = useCallback((category: ExerciseCategory) => patch({ category }), [patch]);
  const setDurationMin = useCallback(
    (minutes: number | null) => patch({ durationMin: minutes }),
    [patch]
  );
  const setCalories = useCallback((next: number | null) => patch({ caloriesOverride: next }), [patch]);
  const useEstimate = useCallback(() => patch({ caloriesOverride: null }), [patch]);
  const setNotes = useCallback((notes: string) => patch({ notes }), [patch]);
  const setDate = useCallback((date: ISODate) => patch({ date }), [patch]);
  const reset = useCallback(() => setValues(initialValues(options)), [options]);

  const buildPayload = useCallback((): WorkoutPayload => {
    const notes = values.notes.trim();
    return {
      date: values.date,
      name: values.name.trim(),
      category: values.category,
      durationMin: values.durationMin ?? 0,
      caloriesBurned: calories,
      source: 'manual',
      externalId: null,
      notes: notes.length > 0 ? notes : null,
      loggedAt: entry?.loggedAt ?? new Date().toISOString(),
    };
  }, [calories, entry, values]);

  return {
    values,
    isCustom: values.activityId === null,
    isEditing: Boolean(entry),
    met,
    weightKgUsed,
    usingFallbackWeight,
    estimatedCalories,
    calories,
    isCaloriesOverridden,
    canSave,
    dateError,
    durationError,
    nameError,
    selectActivity,
    selectCustom,
    setName,
    setCategory,
    setDurationMin,
    setCalories,
    useEstimate,
    setNotes,
    setDate,
    reset,
    buildPayload,
  };
}
