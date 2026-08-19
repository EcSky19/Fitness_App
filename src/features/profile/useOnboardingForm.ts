/**
 * Onboarding wizard state.
 *
 * Holds every field of the 6-step first-run flow, validates each step and
 * assembles the final `saveProfile` / `saveGoal` / `addWeightLog` payload.
 *
 * Canonical storage is metric: `heightCm` / `weightKg`. Imperial values only
 * exist at the input boundary and are converted the moment a unit is toggled,
 * so switching units mid-edit never loses or drifts the underlying value.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  clamp,
  cmToFtIn,
  fromDisplayWeight,
  ftInToCm,
  rateBounds,
  roundTo,
  suggestRateKgPerWeek,
  toDisplayWeight,
  todayISO,
} from '@/domain';
import type {
  ActivityLevel,
  EntrySource,
  Goal,
  GoalType,
  HeightUnit,
  ISODate,
  MacroSplitPreset,
  Sex,
  UserProfile,
  WeightUnit,
} from '@/types';

import {
  EMPTY_OVERRIDE,
  computePlan,
  nudgeRateValue,
  resolveTargets,
  safetyFloorCalories,
  type ManualOverride,
  type PlanBreakdown,
} from './useGoalEditor';

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

export const LIMITS = {
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 30, max: 300 },
  age: { min: 13, max: 100 },
} as const;

export const ONBOARDING_STEPS = [
  { key: 'welcome', title: 'Welcome to MacroTrack', subtitle: 'Targets that actually fit you.' },
  { key: 'about', title: 'About you', subtitle: 'Used to estimate your metabolism.' },
  { key: 'body', title: 'Your body', subtitle: 'Height and current weight.' },
  { key: 'activity', title: 'Activity level', subtitle: 'How much do you move in a normal week?' },
  { key: 'goal', title: 'Your goal', subtitle: 'Pick a direction and a pace.' },
  { key: 'plan', title: 'Your plan', subtitle: 'Here is where your numbers come from.' },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];

export const STEP_COUNT = ONBOARDING_STEPS.length;

function boundsFor(goalType: GoalType): { min: number; max: number; step: number } {
  return rateBounds(goalType);
}

/* -------------------------------------------------------------------------- */
/* Date helpers (dependency-free month / day / year picker)                    */
/* -------------------------------------------------------------------------- */

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 31;
  return new Date(year, month, 0).getDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Builds a real calendar date, or null when the numbers do not form one. */
export function toISODate(year: number | null, month: number | null, day: number | null): ISODate | null {
  if (year === null || month === null || day === null) return null;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  if (year < 1900 || year > new Date().getFullYear()) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Whole years between `birthDate` and today, without pulling in `@/domain`. */
function ageFromISO(iso: ISODate, now = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number);
  let age = now.getFullYear() - y;
  const monthDiff = now.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d)) age -= 1;
  return age;
}

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export interface OnboardingFields {
  name: string;
  sex: Sex;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  heightUnit: HeightUnit;
  /** Display value in cm (only used when heightUnit === 'cm'). */
  heightCmInput: number | null;
  heightFt: number | null;
  heightIn: number | null;
  weightUnit: WeightUnit;
  /** Display value in `weightUnit`. */
  weightInput: number | null;
  goalWeightInput: number | null;
  activityLevel: ActivityLevel | null;
  goalType: GoalType | null;
  rateKgPerWeek: number;
  macroSplit: MacroSplitPreset;
  isManualOverride: boolean;
  override: ManualOverride;
}

export interface OnboardingWeightLog {
  date: ISODate;
  weightKg: number;
  bodyFatPct: number | null;
  note: string | null;
  source: EntrySource;
}

export interface OnboardingPayload {
  profile: Partial<UserProfile>;
  goal: Partial<Goal>;
  weightLog: OnboardingWeightLog;
  plan: PlanBreakdown;
}

export interface OnboardingForm {
  step: number;
  stepKey: OnboardingStepKey;
  stepCount: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  fields: OnboardingFields;
  /** Derived canonical values (metric), null while invalid. */
  birthDate: ISODate | null;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  goalWeightKg: number | null;
  /** Weeks until `goalWeightKg` at the chosen rate; null when not applicable. */
  weeksToGoal: number | null;
  plan: PlanBreakdown | null;
  targets: PlanBreakdown['targets'] | null;
  belowFloor: boolean;
  floor: number;
  errors: Record<string, string>;
  canGoNext: boolean;
  next: () => void;
  back: () => void;
  goToStep: (n: number) => void;
  set: <K extends keyof OnboardingFields>(key: K, value: OnboardingFields[K]) => void;
  setSex: (s: Sex) => void;
  setGoalType: (t: GoalType) => void;
  setRate: (r: number) => void;
  nudgeRate: (direction: 1 | -1) => void;
  rateBoundsForGoal: { min: number; max: number; step: number };
  setWeightUnit: (u: WeightUnit) => void;
  setHeightUnit: (u: HeightUnit) => void;
  setManualEnabled: (enabled: boolean) => void;
  setOverrideField: (field: keyof ManualOverride, value: number | null) => void;
  buildPayload: () => OnboardingPayload | null;
}

const INITIAL_FIELDS: OnboardingFields = {
  name: '',
  sex: 'male',
  birthMonth: null,
  birthDay: null,
  birthYear: null,
  heightUnit: 'cm',
  heightCmInput: null,
  heightFt: null,
  heightIn: null,
  weightUnit: 'kg',
  weightInput: null,
  goalWeightInput: null,
  activityLevel: null,
  goalType: null,
  rateKgPerWeek: 0,
  macroSplit: 'balanced',
  isManualOverride: false,
  override: { ...EMPTY_OVERRIDE },
};

export interface UseOnboardingFormOptions {
  /** Seed the unit toggles from saved app settings. */
  initialWeightUnit?: WeightUnit;
  initialHeightUnit?: HeightUnit;
  initialStep?: number;
}

export function useOnboardingForm(options: UseOnboardingFormOptions = {}): OnboardingForm {
  const [step, setStep] = useState(options.initialStep ?? 0);
  const [fields, setFields] = useState<OnboardingFields>(() => ({
    ...INITIAL_FIELDS,
    weightUnit: options.initialWeightUnit ?? INITIAL_FIELDS.weightUnit,
    heightUnit: options.initialHeightUnit ?? INITIAL_FIELDS.heightUnit,
  }));

  /* ---------------------------------------------------------------------- */
  /* Derived canonical values                                               */
  /* ---------------------------------------------------------------------- */

  const birthDate = useMemo(
    () => toISODate(fields.birthYear, fields.birthMonth, fields.birthDay),
    [fields.birthDay, fields.birthMonth, fields.birthYear]
  );

  const ageYears = useMemo(() => (birthDate ? ageFromISO(birthDate) : null), [birthDate]);

  const heightCm = useMemo<number | null>(() => {
    if (fields.heightUnit === 'cm') {
      return fields.heightCmInput === null ? null : roundTo(fields.heightCmInput, 1);
    }
    if (fields.heightFt === null && fields.heightIn === null) return null;
    const cm = ftInToCm(fields.heightFt ?? 0, fields.heightIn ?? 0);
    return cm > 0 ? roundTo(cm, 1) : null;
  }, [fields.heightCmInput, fields.heightFt, fields.heightIn, fields.heightUnit]);

  const weightKg = useMemo<number | null>(
    () =>
      fields.weightInput === null
        ? null
        : roundTo(fromDisplayWeight(fields.weightInput, fields.weightUnit), 2),
    [fields.weightInput, fields.weightUnit]
  );

  const goalWeightKg = useMemo<number | null>(
    () =>
      fields.goalWeightInput === null
        ? null
        : roundTo(fromDisplayWeight(fields.goalWeightInput, fields.weightUnit), 2),
    [fields.goalWeightInput, fields.weightUnit]
  );

  const rateBoundsForGoal = useMemo(
    () => boundsFor(fields.goalType ?? 'maintain'),
    [fields.goalType]
  );

  const plan = useMemo<PlanBreakdown | null>(() => {
    if (
      ageYears === null ||
      heightCm === null ||
      weightKg === null ||
      fields.activityLevel === null ||
      fields.goalType === null
    ) {
      return null;
    }
    return computePlan({
      sex: fields.sex,
      weightKg,
      heightCm,
      ageYears,
      activityLevel: fields.activityLevel,
      goalType: fields.goalType,
      rateKgPerWeek: fields.rateKgPerWeek,
      macroSplit: fields.macroSplit,
    });
  }, [
    ageYears,
    heightCm,
    weightKg,
    fields.activityLevel,
    fields.goalType,
    fields.macroSplit,
    fields.rateKgPerWeek,
    fields.sex,
  ]);

  const targets = useMemo(
    () => (plan ? resolveTargets(plan.targets, fields.isManualOverride, fields.override) : null),
    [plan, fields.isManualOverride, fields.override]
  );

  const floor = safetyFloorCalories(fields.sex);
  const belowFloor = targets ? targets.calories < floor : false;

  const weeksToGoal = useMemo<number | null>(() => {
    if (weightKg === null || goalWeightKg === null) return null;
    const rate = Math.abs(fields.rateKgPerWeek);
    if (rate <= 0) return null;
    const delta = Math.abs(weightKg - goalWeightKg);
    if (delta <= 0) return 0;
    return Math.ceil(delta / rate);
  }, [fields.rateKgPerWeek, goalWeightKg, weightKg]);

  /* ---------------------------------------------------------------------- */
  /* Validation                                                             */
  /* ---------------------------------------------------------------------- */

  const errors = useMemo<Record<string, string>>(() => {
    const e: Record<string, string> = {};

    if (step === 1) {
      if (fields.name.trim().length === 0) e.name = 'Tell us what to call you.';
      if (fields.birthMonth === null || fields.birthDay === null || fields.birthYear === null) {
        e.birthDate = 'Enter your full date of birth.';
      } else if (birthDate === null) {
        e.birthDate = 'That date does not exist.';
      } else if (ageYears === null || ageYears < LIMITS.age.min || ageYears > LIMITS.age.max) {
        e.birthDate = `Age must be between ${LIMITS.age.min} and ${LIMITS.age.max}.`;
      }
    }

    if (step === 2) {
      if (heightCm === null) {
        e.height = 'Enter your height.';
      } else if (heightCm < LIMITS.heightCm.min || heightCm > LIMITS.heightCm.max) {
        e.height = `Height must be between ${LIMITS.heightCm.min} and ${LIMITS.heightCm.max} cm.`;
      }
      if (weightKg === null) {
        e.weight = 'Enter your current weight.';
      } else if (weightKg < LIMITS.weightKg.min || weightKg > LIMITS.weightKg.max) {
        e.weight = `Weight must be between ${LIMITS.weightKg.min} and ${LIMITS.weightKg.max} kg.`;
      }
    }

    if (step === 3 && fields.activityLevel === null) {
      e.activityLevel = 'Pick the option closest to your week.';
    }

    if (step === 4) {
      if (fields.goalType === null) {
        e.goalType = 'Pick a goal.';
      } else if (fields.goalType !== 'maintain' && Math.abs(fields.rateKgPerWeek) <= 0) {
        e.rate = 'Choose a weekly pace.';
      }
      if (fields.goalWeightInput !== null && goalWeightKg !== null) {
        if (goalWeightKg < LIMITS.weightKg.min || goalWeightKg > LIMITS.weightKg.max) {
          e.goalWeight = `Goal weight must be between ${LIMITS.weightKg.min} and ${LIMITS.weightKg.max} kg.`;
        }
      }
    }

    if (step === 5) {
      if (targets === null) e.plan = 'Something is missing — go back and check your details.';
      else if (targets.calories <= 0) e.plan = 'Calorie target must be greater than zero.';
    }

    return e;
  }, [
    step,
    fields.name,
    fields.birthMonth,
    fields.birthDay,
    fields.birthYear,
    fields.activityLevel,
    fields.goalType,
    fields.rateKgPerWeek,
    fields.goalWeightInput,
    birthDate,
    ageYears,
    heightCm,
    weightKg,
    goalWeightKg,
    targets,
  ]);

  const canGoNext = Object.keys(errors).length === 0;

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                */
  /* ---------------------------------------------------------------------- */

  const set = useCallback(
    <K extends keyof OnboardingFields>(key: K, value: OnboardingFields[K]) => {
      setFields((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const setSex = useCallback((s: Sex) => setFields((prev) => ({ ...prev, sex: s })), []);

  const setGoalType = useCallback((t: GoalType) => {
    setFields((prev) => {
      if (prev.goalType === t) return prev;
      const b = boundsFor(t);
      return {
        ...prev,
        goalType: t,
        rateKgPerWeek: roundTo(clamp(suggestRateKgPerWeek(t), b.min, b.max), 3),
        goalWeightInput: t === 'maintain' ? null : prev.goalWeightInput,
      };
    });
  }, []);

  const setRate = useCallback((r: number) => {
    setFields((prev) => {
      const b = boundsFor(prev.goalType ?? 'maintain');
      return { ...prev, rateKgPerWeek: roundTo(clamp(r, b.min, b.max), 3) };
    });
  }, []);

  const nudgeRate = useCallback((direction: 1 | -1) => {
    setFields((prev) => {
      const b = boundsFor(prev.goalType ?? 'maintain');
      return { ...prev, rateKgPerWeek: nudgeRateValue(prev.rateKgPerWeek, b, direction) };
    });
  }, []);

  const setWeightUnit = useCallback((u: WeightUnit) => {
    setFields((prev) => {
      if (prev.weightUnit === u) return prev;
      const convert = (v: number | null): number | null =>
        v === null ? null : roundTo(toDisplayWeight(fromDisplayWeight(v, prev.weightUnit), u), 1);
      return {
        ...prev,
        weightUnit: u,
        weightInput: convert(prev.weightInput),
        goalWeightInput: convert(prev.goalWeightInput),
      };
    });
  }, []);

  const setHeightUnit = useCallback((u: HeightUnit) => {
    setFields((prev) => {
      if (prev.heightUnit === u) return prev;
      if (u === 'ft_in') {
        if (prev.heightCmInput === null) return { ...prev, heightUnit: u };
        const { ft, in: inches } = cmToFtIn(prev.heightCmInput);
        return { ...prev, heightUnit: u, heightFt: ft, heightIn: inches };
      }
      if (prev.heightFt === null && prev.heightIn === null) return { ...prev, heightUnit: u };
      const cm = ftInToCm(prev.heightFt ?? 0, prev.heightIn ?? 0);
      return { ...prev, heightUnit: u, heightCmInput: cm > 0 ? roundTo(cm, 0) : null };
    });
  }, []);

  const setManualEnabled = useCallback(
    (enabled: boolean) => {
      setFields((prev) => {
        if (!enabled) return { ...prev, isManualOverride: false, override: { ...EMPTY_OVERRIDE } };
        const seed = plan?.targets;
        const alreadySeeded = prev.override.calories !== null;
        return {
          ...prev,
          isManualOverride: true,
          override:
            alreadySeeded || !seed
              ? prev.override
              : {
                  calories: seed.calories,
                  protein: seed.protein,
                  carbs: seed.carbs,
                  fat: seed.fat,
                },
        };
      });
    },
    [plan]
  );

  const setOverrideField = useCallback((field: keyof ManualOverride, value: number | null) => {
    setFields((prev) => ({
      ...prev,
      isManualOverride: true,
      override: { ...prev.override, [field]: value },
    }));
  }, []);

  const goToStep = useCallback((n: number) => {
    setStep(Math.max(0, Math.min(STEP_COUNT - 1, Math.trunc(n))));
  }, []);

  const next = useCallback(() => {
    if (!canGoNext) return;
    setStep((prev) => Math.min(STEP_COUNT - 1, prev + 1));
  }, [canGoNext]);

  const back = useCallback(() => setStep((prev) => Math.max(0, prev - 1)), []);

  /* ---------------------------------------------------------------------- */
  /* Payload                                                                */
  /* ---------------------------------------------------------------------- */

  const buildPayload = useCallback((): OnboardingPayload | null => {
    if (
      !plan ||
      !targets ||
      birthDate === null ||
      heightCm === null ||
      weightKg === null ||
      fields.activityLevel === null ||
      fields.goalType === null
    ) {
      return null;
    }

    const now = new Date().toISOString();
    const date = todayISO();

    return {
      profile: {
        name: fields.name.trim(),
        sex: fields.sex,
        birthDate,
        heightCm,
        currentWeightKg: weightKg,
        goalWeightKg: fields.goalType === 'maintain' ? null : goalWeightKg,
        activityLevel: fields.activityLevel,
        weightUnit: fields.weightUnit,
        heightUnit: fields.heightUnit,
        onboardedAt: now,
      },
      goal: {
        type: fields.goalType,
        rateKgPerWeek: fields.goalType === 'maintain' ? 0 : fields.rateKgPerWeek,
        macroSplit: fields.isManualOverride ? 'custom' : fields.macroSplit,
        targets,
        isManualOverride: fields.isManualOverride,
        startedAt: date,
        isActive: true,
      },
      weightLog: {
        date,
        weightKg,
        bodyFatPct: null,
        note: 'Starting weight',
        source: 'manual',
      },
      plan,
    };
  }, [
    plan,
    targets,
    birthDate,
    heightCm,
    weightKg,
    goalWeightKg,
    fields.activityLevel,
    fields.goalType,
    fields.isManualOverride,
    fields.macroSplit,
    fields.name,
    fields.heightUnit,
    fields.rateKgPerWeek,
    fields.sex,
    fields.weightUnit,
  ]);

  return {
    step,
    stepKey: ONBOARDING_STEPS[step].key,
    stepCount: STEP_COUNT,
    isFirstStep: step === 0,
    isLastStep: step === STEP_COUNT - 1,
    fields,
    birthDate,
    ageYears,
    heightCm,
    weightKg,
    goalWeightKg,
    weeksToGoal,
    plan,
    targets,
    belowFloor,
    floor,
    errors,
    canGoNext,
    next,
    back,
    goToStep,
    set,
    setSex,
    setGoalType,
    setRate,
    nudgeRate,
    rateBoundsForGoal,
    setWeightUnit,
    setHeightUnit,
    setManualEnabled,
    setOverrideField,
    buildPayload,
  };
}

