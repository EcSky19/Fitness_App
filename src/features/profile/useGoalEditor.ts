/**
 * Goal editing state.
 *
 * Shared by the onboarding wizard (steps 5-6) and the profile screen's
 * "Edit goal" sheet so both flows compute targets in exactly one way.
 *
 * ALL nutrition math is delegated to `@/domain`; nothing here re-implements
 * BMR / TDEE / macro maths.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  MIN_CALORIES_FEMALE,
  MIN_CALORIES_MALE,
  calcAge,
  calcBMR,
  calcCalorieTarget,
  calcMacroTargets,
  calcTDEE,
  clamp,
  macrosToCalories,
  rateBounds,
  roundTo,
  suggestRateKgPerWeek,
  todayISO,
} from '@/domain';
import { ACTIVITY_MULTIPLIERS } from '@/types/constants';
import type {
  ActivityLevel,
  Goal,
  GoalType,
  MacroSplitPreset,
  MacroTargets,
  Sex,
  UserProfile,
} from '@/types';

/* -------------------------------------------------------------------------- */
/* Safety floor                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Lowest daily intake generally considered safe without medical supervision.
 * Mirrors the floor `calcCalorieTarget` already enforces, so only a manual
 * override can ever land below it.
 */
export const SAFETY_FLOOR_KCAL: Record<Sex, number> = {
  male: MIN_CALORIES_MALE,
  female: MIN_CALORIES_FEMALE,
};

export function safetyFloorCalories(sex: Sex): number {
  return SAFETY_FLOOR_KCAL[sex] ?? MIN_CALORIES_FEMALE;
}

/**
 * `rateBounds` is signed: a cut spans `-1 .. -0.1`, a bulk `0.1 .. 0.5`.
 * The UI thinks in "faster / slower", so nudges are applied to the magnitude
 * and re-signed here.
 */
export function nudgeRateValue(
  current: number,
  bounds: { min: number; max: number; step: number },
  direction: 1 | -1
): number {
  const sign = bounds.min < 0 || bounds.max < 0 ? -1 : 1;
  return roundTo(clamp(current + direction * bounds.step * sign, bounds.min, bounds.max), 3);
}

/** Magnitude bounds of a signed rate range, for disabling the stepper buttons. */
export function rateMagnitudeBounds(bounds: { min: number; max: number }): {
  slowest: number;
  fastest: number;
} {
  const a = Math.abs(bounds.min);
  const b = Math.abs(bounds.max);
  return { slowest: Math.min(a, b), fastest: Math.max(a, b) };
}

/* -------------------------------------------------------------------------- */
/* Plan computation                                                           */
/* -------------------------------------------------------------------------- */

export interface PlanInputs {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  rateKgPerWeek: number;
  macroSplit: MacroSplitPreset;
}

export interface PlanBreakdown {
  bmr: number;
  tdee: number;
  activityMultiplier: number;
  /** Calorie target before any manual override. */
  calories: number;
  /** `calories - tdee`: negative = deficit, positive = surplus. */
  delta: number;
  targets: MacroTargets;
  floor: number;
  belowFloor: boolean;
}

/** Full BMR -> TDEE -> target -> macros chain, keeping every intermediate value. */
export function computePlan(input: PlanInputs): PlanBreakdown {
  const bmr = roundTo(
    calcBMR({
      sex: input.sex,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      ageYears: input.ageYears,
    }),
    0
  );
  const tdee = roundTo(calcTDEE(bmr, input.activityLevel), 0);
  const calories = roundTo(
    calcCalorieTarget({
      tdee,
      goalType: input.goalType,
      rateKgPerWeek: input.rateKgPerWeek,
      sex: input.sex,
    }),
    0
  );
  const targets = calcMacroTargets(calories, input.macroSplit, { weightKg: input.weightKg });
  const floor = safetyFloorCalories(input.sex);

  return {
    bmr,
    tdee,
    activityMultiplier: ACTIVITY_MULTIPLIERS[input.activityLevel],
    calories,
    delta: roundTo(calories - tdee, 0),
    targets,
    floor,
    belowFloor: calories < floor,
  };
}

/* -------------------------------------------------------------------------- */
/* Manual override                                                            */
/* -------------------------------------------------------------------------- */

export interface ManualOverride {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export const EMPTY_OVERRIDE: ManualOverride = {
  calories: null,
  protein: null,
  carbs: null,
  fat: null,
};

/** Computed targets with any non-null manual value substituted in. */
export function resolveTargets(
  computed: MacroTargets,
  enabled: boolean,
  override: ManualOverride
): MacroTargets {
  if (!enabled) return computed;
  return {
    calories: override.calories ?? computed.calories,
    protein: override.protein ?? computed.protein,
    carbs: override.carbs ?? computed.carbs,
    fat: override.fat ?? computed.fat,
  };
}

/** kcal implied by the macro grams minus the calorie target. */
export function macroCalorieGap(targets: MacroTargets): number {
  return roundTo(macrosToCalories(targets) - targets.calories, 0);
}

function overrideFromTargets(t: MacroTargets): ManualOverride {
  return { calories: t.calories, protein: t.protein, carbs: t.carbs, fat: t.fat };
}

function ageOf(profile: UserProfile): number | null {
  const age = calcAge(profile.birthDate);
  return Number.isFinite(age) && age > 0 ? age : null;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseGoalEditorArgs {
  profile: UserProfile | null;
  goal: Goal | null;
  /** Most recent weigh-in; drives "recalculate from my current stats". */
  latestWeightKg?: number | null;
}

export interface GoalEditorState {
  ready: boolean;
  goalType: GoalType;
  rateKgPerWeek: number;
  bounds: { min: number; max: number; step: number };
  macroSplit: MacroSplitPreset;
  isManualOverride: boolean;
  override: ManualOverride;
  weightKg: number;
  /** Targets currently persisted on the active goal (the "before" column). */
  baseTargets: MacroTargets | null;
  plan: PlanBreakdown | null;
  /** Plan targets with the manual override applied (the "after" column). */
  targets: MacroTargets | null;
  belowFloor: boolean;
  floor: number;
  hasChanges: boolean;
  setGoalType: (t: GoalType) => void;
  setRateKgPerWeek: (r: number) => void;
  nudgeRate: (direction: 1 | -1) => void;
  setMacroSplit: (s: MacroSplitPreset) => void;
  setManualEnabled: (enabled: boolean) => void;
  setOverrideField: (field: keyof ManualOverride, value: number | null) => void;
  setWeightKg: (kg: number) => void;
  recalculate: () => void;
  reset: () => void;
  buildGoalPayload: () => Partial<Goal> | null;
}

const DEFAULT_SPLIT: MacroSplitPreset = 'balanced';

export function useGoalEditor({
  profile,
  goal,
  latestWeightKg = null,
}: UseGoalEditorArgs): GoalEditorState {
  const initialType: GoalType = goal?.type ?? 'maintain';
  const [goalType, setGoalTypeState] = useState<GoalType>(initialType);
  const [rateKgPerWeek, setRateState] = useState<number>(
    goal?.rateKgPerWeek ?? suggestRateKgPerWeek(initialType)
  );
  const [macroSplit, setMacroSplitState] = useState<MacroSplitPreset>(
    goal?.macroSplit && goal.macroSplit !== 'custom' ? goal.macroSplit : DEFAULT_SPLIT
  );
  const [isManualOverride, setManualOverride] = useState<boolean>(goal?.isManualOverride ?? false);
  const [override, setOverride] = useState<ManualOverride>(() =>
    goal?.isManualOverride && goal.targets ? overrideFromTargets(goal.targets) : { ...EMPTY_OVERRIDE }
  );
  const [weightKg, setWeightKgState] = useState<number>(
    latestWeightKg ?? profile?.currentWeightKg ?? 0
  );

  const baseTargetsRef = useRef<MacroTargets | null>(goal?.targets ?? null);
  const baseTargets = baseTargetsRef.current;

  const bounds = useMemo(() => rateBounds(goalType), [goalType]);

  const plan = useMemo<PlanBreakdown | null>(() => {
    if (!profile || !(weightKg > 0) || !(profile.heightCm > 0)) return null;
    const ageYears = ageOf(profile);
    if (ageYears === null) return null;
    return computePlan({
      sex: profile.sex,
      weightKg,
      heightCm: profile.heightCm,
      ageYears,
      activityLevel: profile.activityLevel,
      goalType,
      rateKgPerWeek,
      macroSplit,
    });
  }, [profile, weightKg, goalType, rateKgPerWeek, macroSplit]);

  const targets = useMemo<MacroTargets | null>(
    () => (plan ? resolveTargets(plan.targets, isManualOverride, override) : null),
    [plan, isManualOverride, override]
  );

  const floor = profile ? safetyFloorCalories(profile.sex) : MIN_CALORIES_FEMALE;
  const belowFloor = targets ? targets.calories < floor : false;

  const setGoalType = useCallback((t: GoalType) => {
    setGoalTypeState((prev) => {
      if (prev === t) return prev;
      const next = rateBounds(t);
      setRateState(roundTo(clamp(suggestRateKgPerWeek(t), next.min, next.max), 3));
      return t;
    });
  }, []);

  const setRateKgPerWeek = useCallback(
    (r: number) => setRateState(roundTo(clamp(r, bounds.min, bounds.max), 3)),
    [bounds.max, bounds.min]
  );

  const nudgeRate = useCallback(
    (direction: 1 | -1) => {
      setRateState((prev) => nudgeRateValue(prev, bounds, direction));
    },
    [bounds]
  );

  const setMacroSplit = useCallback((s: MacroSplitPreset) => setMacroSplitState(s), []);

  const setManualEnabled = useCallback(
    (enabled: boolean) => {
      setManualOverride(enabled);
      if (enabled) {
        setOverride((prev) => {
          if (prev.calories !== null) return prev;
          return plan ? overrideFromTargets(plan.targets) : prev;
        });
      } else {
        setOverride({ ...EMPTY_OVERRIDE });
      }
    },
    [plan]
  );

  const setOverrideField = useCallback((field: keyof ManualOverride, value: number | null) => {
    setManualOverride(true);
    setOverride((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setWeightKg = useCallback((kg: number) => setWeightKgState(kg), []);

  const recalculate = useCallback(() => {
    setManualOverride(false);
    setOverride({ ...EMPTY_OVERRIDE });
    const fresh = latestWeightKg ?? profile?.currentWeightKg ?? 0;
    if (fresh > 0) setWeightKgState(fresh);
  }, [latestWeightKg, profile]);

  const reset = useCallback(() => {
    const type: GoalType = goal?.type ?? 'maintain';
    setGoalTypeState(type);
    setRateState(goal?.rateKgPerWeek ?? suggestRateKgPerWeek(type));
    setMacroSplitState(goal?.macroSplit && goal.macroSplit !== 'custom' ? goal.macroSplit : DEFAULT_SPLIT);
    setManualOverride(goal?.isManualOverride ?? false);
    setOverride(
      goal?.isManualOverride && goal.targets
        ? overrideFromTargets(goal.targets)
        : { ...EMPTY_OVERRIDE }
    );
    setWeightKgState(latestWeightKg ?? profile?.currentWeightKg ?? 0);
  }, [goal, latestWeightKg, profile]);

  const hasChanges = useMemo(() => {
    if (!goal) return true;
    if (goal.type !== goalType) return true;
    if (roundTo(goal.rateKgPerWeek, 3) !== roundTo(rateKgPerWeek, 3)) return true;
    if (goal.isManualOverride !== isManualOverride) return true;
    if (!targets || !goal.targets) return true;
    return (
      goal.targets.calories !== targets.calories ||
      goal.targets.protein !== targets.protein ||
      goal.targets.carbs !== targets.carbs ||
      goal.targets.fat !== targets.fat
    );
  }, [goal, goalType, rateKgPerWeek, isManualOverride, targets]);

  const buildGoalPayload = useCallback((): Partial<Goal> | null => {
    if (!targets) return null;
    return {
      type: goalType,
      rateKgPerWeek: goalType === 'maintain' ? 0 : rateKgPerWeek,
      macroSplit: isManualOverride ? 'custom' : macroSplit,
      targets,
      isManualOverride,
      startedAt: goal?.startedAt ?? todayISO(),
      isActive: true,
    };
  }, [goal, goalType, isManualOverride, macroSplit, rateKgPerWeek, targets]);

  return {
    ready: profile !== null && plan !== null,
    goalType,
    rateKgPerWeek,
    bounds,
    macroSplit,
    isManualOverride,
    override,
    weightKg,
    baseTargets,
    plan,
    targets,
    belowFloor,
    floor,
    hasChanges,
    setGoalType,
    setRateKgPerWeek,
    nudgeRate,
    setMacroSplit,
    setManualEnabled,
    setOverrideField,
    setWeightKg,
    recalculate,
    reset,
    buildGoalPayload,
  };
}
