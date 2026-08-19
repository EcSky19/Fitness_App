import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Button,
  NumberField,
  SegmentedControl,
  Sheet,
  TextField,
  useTheme,
} from '@/ui';
import { cmToFtIn, fromDisplayWeight, ftInToCm, roundTo, toDisplayWeight } from '@/domain';
import type { ActivityLevel, HeightUnit, Sex, UserProfile, WeightUnit } from '@/types';

import { ActivityLevelPicker } from './ActivityLevelPicker';
import { LIMITS, MONTH_NAMES, daysInMonth, toISODate } from './useOnboardingForm';

export type ProfileField =
  | 'name'
  | 'sex'
  | 'birthDate'
  | 'height'
  | 'weight'
  | 'goalWeight'
  | 'activityLevel';

export const PROFILE_FIELD_TITLES: Record<ProfileField, string> = {
  name: 'Name',
  sex: 'Sex',
  birthDate: 'Date of birth',
  height: 'Height',
  weight: 'Current weight',
  goalWeight: 'Goal weight',
  activityLevel: 'Activity level',
};

/** Fields that change the calorie maths and therefore trigger the recalc prompt. */
export const TARGET_AFFECTING_FIELDS: ProfileField[] = [
  'sex',
  'birthDate',
  'height',
  'weight',
  'activityLevel',
];

/* -------------------------------------------------------------------------- */
/* Reusable input groups (shared with the onboarding wizard)                  */
/* -------------------------------------------------------------------------- */

export interface BirthDateFieldsProps {
  month: number | null;
  day: number | null;
  year: number | null;
  onChange: (patch: { month?: number | null; day?: number | null; year?: number | null }) => void;
  error?: string;
  ageYears?: number | null;
}

/**
 * Dependency-free date of birth entry: three `NumberField`s (month / day /
 * year) with live validation. No date-picker package is installed and none is
 * added, so this stays pure RN.
 */
export function BirthDateFields({
  month,
  day,
  year,
  onChange,
  error,
  ageYears,
}: BirthDateFieldsProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const currentYear = new Date().getFullYear();
  const maxDay = daysInMonth(year ?? 2000, month ?? 1);
  const monthName = month && month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : null;

  return (
    <View>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <View style={styles.flex}>
          <NumberField
            label="Month"
            value={month}
            onChange={(v) => onChange({ month: v })}
            placeholder="MM"
            min={1}
            max={12}
            testID="dob-month"
          />
        </View>
        <View style={styles.flex}>
          <NumberField
            label="Day"
            value={day}
            onChange={(v) => onChange({ day: v })}
            placeholder="DD"
            min={1}
            max={maxDay}
            testID="dob-day"
          />
        </View>
        <View style={styles.flexWide}>
          <NumberField
            label="Year"
            value={year}
            onChange={(v) => onChange({ year: v })}
            placeholder="YYYY"
            min={currentYear - LIMITS.age.max}
            max={currentYear - LIMITS.age.min}
            testID="dob-year"
          />
        </View>
      </View>
      <Text
        style={[
          typography.caption,
          { color: error ? colors.danger : colors.textMuted, marginTop: spacing.xs },
        ]}
        testID="dob-hint"
      >
        {error ??
          (monthName && day && year && ageYears !== null && ageYears !== undefined
            ? `${monthName} ${day}, ${year} · ${ageYears} years old`
            : 'Used only to estimate your metabolic rate.')}
      </Text>
    </View>
  );
}

export interface HeightFieldsProps {
  unit: HeightUnit;
  onUnitChange: (u: HeightUnit) => void;
  cm: number | null;
  ft: number | null;
  inches: number | null;
  onChange: (patch: { cm?: number | null; ft?: number | null; inches?: number | null }) => void;
  error?: string;
}

/** Height entry that swaps between a cm field and ft + in fields. */
export function HeightFields({
  unit,
  onUnitChange,
  cm,
  ft,
  inches,
  onChange,
  error,
}: HeightFieldsProps): React.JSX.Element {
  const { spacing } = useTheme();
  return (
    <View>
      <SegmentedControl<HeightUnit>
        options={[
          { label: 'cm', value: 'cm' },
          { label: 'ft / in', value: 'ft_in' },
        ]}
        value={unit}
        onChange={onUnitChange}
        size="sm"
        testID="height-unit-toggle"
      />
      <View style={{ marginTop: spacing.md }}>
        {unit === 'cm' ? (
          <NumberField
            label="Height"
            value={cm}
            onChange={(v) => onChange({ cm: v })}
            suffix="cm"
            placeholder="175"
            min={LIMITS.heightCm.min}
            max={LIMITS.heightCm.max}
            error={error}
            testID="height-cm"
          />
        ) : (
          <View style={[styles.row, { gap: spacing.sm }]}>
            <View style={styles.flex}>
              <NumberField
                label="Feet"
                value={ft}
                onChange={(v) => onChange({ ft: v })}
                suffix="ft"
                placeholder="5"
                min={3}
                max={8}
                testID="height-ft"
              />
            </View>
            <View style={styles.flex}>
              <NumberField
                label="Inches"
                value={inches}
                onChange={(v) => onChange({ inches: v })}
                suffix="in"
                placeholder="9"
                min={0}
                max={11}
                error={error}
                testID="height-in"
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

export interface WeightFieldProps {
  label: string;
  unit: WeightUnit;
  onUnitChange?: (u: WeightUnit) => void;
  value: number | null;
  onChange: (v: number | null) => void;
  error?: string;
  helper?: string;
  testID?: string;
}

/** Weight entry with an optional kg/lb toggle that preserves the value. */
export function WeightField({
  label,
  unit,
  onUnitChange,
  value,
  onChange,
  error,
  helper,
  testID = 'weight-field',
}: WeightFieldProps): React.JSX.Element {
  const { spacing } = useTheme();
  return (
    <View>
      {onUnitChange ? (
        <SegmentedControl<WeightUnit>
          options={[
            { label: 'kg', value: 'kg' },
            { label: 'lb', value: 'lb' },
          ]}
          value={unit}
          onChange={onUnitChange}
          size="sm"
          testID="weight-unit-toggle"
        />
      ) : null}
      <View style={onUnitChange ? { marginTop: spacing.md } : undefined}>
        <NumberField
          label={label}
          value={value}
          onChange={onChange}
          suffix={unit}
          decimals={1}
          placeholder={unit === 'kg' ? '75' : '165'}
          error={error}
          helper={helper}
          testID={testID}
        />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Sheet                                                                      */
/* -------------------------------------------------------------------------- */

interface Draft {
  name: string;
  sex: Sex;
  month: number | null;
  day: number | null;
  year: number | null;
  heightUnit: HeightUnit;
  cm: number | null;
  ft: number | null;
  inches: number | null;
  weightUnit: WeightUnit;
  weight: number | null;
  goalWeight: number | null;
  activityLevel: ActivityLevel;
}

function makeDraft(
  profile: UserProfile,
  weightUnit: WeightUnit,
  heightUnit: HeightUnit
): Draft {
  const [y, m, d] = (profile.birthDate ?? '').split('-').map((n) => Number(n));
  const { ft, in: inches } = cmToFtIn(profile.heightCm);
  return {
    name: profile.name,
    sex: profile.sex,
    month: Number.isFinite(m) ? m : null,
    day: Number.isFinite(d) ? d : null,
    year: Number.isFinite(y) ? y : null,
    heightUnit,
    cm: profile.heightCm > 0 ? roundTo(profile.heightCm, 0) : null,
    ft,
    inches,
    weightUnit,
    weight:
      profile.currentWeightKg > 0
        ? roundTo(toDisplayWeight(profile.currentWeightKg, weightUnit), 1)
        : null,
    goalWeight:
      profile.goalWeightKg && profile.goalWeightKg > 0
        ? roundTo(toDisplayWeight(profile.goalWeightKg, weightUnit), 1)
        : null,
    activityLevel: profile.activityLevel,
  };
}

export interface ProfileFieldSheetProps {
  field: ProfileField | null;
  profile: UserProfile;
  weightUnit: WeightUnit;
  heightUnit: HeightUnit;
  onClose: () => void;
  onSave: (patch: Partial<UserProfile>, field: ProfileField) => void;
  saving?: boolean;
}

/** Small single-field editor for the body stats card. */
export function ProfileFieldSheet({
  field,
  profile,
  weightUnit,
  heightUnit,
  onClose,
  onSave,
  saving = false,
}: ProfileFieldSheetProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [draft, setDraft] = useState<Draft>(() => makeDraft(profile, weightUnit, heightUnit));

  useEffect(() => {
    if (field) setDraft(makeDraft(profile, weightUnit, heightUnit));
  }, [field, profile, weightUnit, heightUnit]);

  const patch = (p: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...p }));

  const heightCm = useMemo<number | null>(() => {
    if (draft.heightUnit === 'cm') return draft.cm;
    if (draft.ft === null && draft.inches === null) return null;
    const cm = ftInToCm(draft.ft ?? 0, draft.inches ?? 0);
    return cm > 0 ? roundTo(cm, 1) : null;
  }, [draft.cm, draft.ft, draft.heightUnit, draft.inches]);

  const weightKg = useMemo<number | null>(
    () => (draft.weight === null ? null : roundTo(fromDisplayWeight(draft.weight, draft.weightUnit), 2)),
    [draft.weight, draft.weightUnit]
  );

  const goalWeightKg = useMemo<number | null>(
    () =>
      draft.goalWeight === null
        ? null
        : roundTo(fromDisplayWeight(draft.goalWeight, draft.weightUnit), 2),
    [draft.goalWeight, draft.weightUnit]
  );

  const birthDate = useMemo(
    () => toISODate(draft.year, draft.month, draft.day),
    [draft.day, draft.month, draft.year]
  );

  const ageYears = useMemo(() => {
    if (!birthDate) return null;
    const [y, m, d] = birthDate.split('-').map(Number);
    const now = new Date();
    let age = now.getFullYear() - y;
    const md = now.getMonth() + 1 - m;
    if (md < 0 || (md === 0 && now.getDate() < d)) age -= 1;
    return age;
  }, [birthDate]);

  const error = useMemo<string | null>(() => {
    switch (field) {
      case 'name':
        return draft.name.trim().length === 0 ? 'Name cannot be empty.' : null;
      case 'birthDate':
        if (!birthDate) return 'Enter a real date.';
        if (ageYears === null || ageYears < LIMITS.age.min || ageYears > LIMITS.age.max) {
          return `Age must be between ${LIMITS.age.min} and ${LIMITS.age.max}.`;
        }
        return null;
      case 'height':
        if (heightCm === null) return 'Enter your height.';
        return heightCm < LIMITS.heightCm.min || heightCm > LIMITS.heightCm.max
          ? `Height must be between ${LIMITS.heightCm.min} and ${LIMITS.heightCm.max} cm.`
          : null;
      case 'weight':
        if (weightKg === null) return 'Enter your weight.';
        return weightKg < LIMITS.weightKg.min || weightKg > LIMITS.weightKg.max
          ? `Weight must be between ${LIMITS.weightKg.min} and ${LIMITS.weightKg.max} kg.`
          : null;
      case 'goalWeight':
        if (goalWeightKg === null) return null;
        return goalWeightKg < LIMITS.weightKg.min || goalWeightKg > LIMITS.weightKg.max
          ? `Goal weight must be between ${LIMITS.weightKg.min} and ${LIMITS.weightKg.max} kg.`
          : null;
      default:
        return null;
    }
  }, [ageYears, birthDate, draft.name, field, goalWeightKg, heightCm, weightKg]);

  const handleSave = useCallback(() => {
    if (!field || error) return;
    switch (field) {
      case 'name':
        onSave({ name: draft.name.trim() }, field);
        break;
      case 'sex':
        onSave({ sex: draft.sex }, field);
        break;
      case 'birthDate':
        if (birthDate) onSave({ birthDate }, field);
        break;
      case 'height':
        if (heightCm !== null) onSave({ heightCm, heightUnit: draft.heightUnit }, field);
        break;
      case 'weight':
        if (weightKg !== null) onSave({ currentWeightKg: weightKg, weightUnit: draft.weightUnit }, field);
        break;
      case 'goalWeight':
        onSave({ goalWeightKg }, field);
        break;
      case 'activityLevel':
        onSave({ activityLevel: draft.activityLevel }, field);
        break;
    }
  }, [birthDate, draft, error, field, goalWeightKg, heightCm, onSave, weightKg]);

  return (
    <Sheet
      visible={field !== null}
      onClose={onClose}
      title={field ? PROFILE_FIELD_TITLES[field] : undefined}
    >
      <View style={{ gap: spacing.md }} testID="profile-field-sheet">
        {field === 'name' ? (
          <TextField
            label="Name"
            value={draft.name}
            onChangeText={(name) => patch({ name })}
            placeholder="Alex"
            autoFocus
            error={error ?? undefined}
            testID="field-name"
          />
        ) : null}

        {field === 'sex' ? (
          <View>
            <SegmentedControl<Sex>
              options={[
                { label: 'Male', value: 'male' },
                { label: 'Female', value: 'female' },
              ]}
              value={draft.sex}
              onChange={(sex) => patch({ sex })}
              testID="field-sex"
            />
            <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>
              Used by the BMR formula only.
            </Text>
          </View>
        ) : null}

        {field === 'birthDate' ? (
          <BirthDateFields
            month={draft.month}
            day={draft.day}
            year={draft.year}
            ageYears={ageYears}
            error={error ?? undefined}
            onChange={(p) =>
              patch({
                month: p.month !== undefined ? p.month : draft.month,
                day: p.day !== undefined ? p.day : draft.day,
                year: p.year !== undefined ? p.year : draft.year,
              })
            }
          />
        ) : null}

        {field === 'height' ? (
          <HeightFields
            unit={draft.heightUnit}
            onUnitChange={(unit) => {
              if (unit === draft.heightUnit) return;
              if (unit === 'ft_in') {
                const { ft, in: inches } = cmToFtIn(draft.cm ?? 0);
                patch({ heightUnit: unit, ft, inches });
              } else {
                const cm = ftInToCm(draft.ft ?? 0, draft.inches ?? 0);
                patch({ heightUnit: unit, cm: cm > 0 ? roundTo(cm, 0) : null });
              }
            }}
            cm={draft.cm}
            ft={draft.ft}
            inches={draft.inches}
            error={error ?? undefined}
            onChange={(p) =>
              patch({
                cm: p.cm !== undefined ? p.cm : draft.cm,
                ft: p.ft !== undefined ? p.ft : draft.ft,
                inches: p.inches !== undefined ? p.inches : draft.inches,
              })
            }
          />
        ) : null}

        {field === 'weight' || field === 'goalWeight' ? (
          <WeightField
            label={field === 'weight' ? 'Current weight' : 'Goal weight'}
            unit={draft.weightUnit}
            onUnitChange={(unit) => {
              if (unit === draft.weightUnit) return;
              const convert = (v: number | null) =>
                v === null ? null : roundTo(toDisplayWeight(fromDisplayWeight(v, draft.weightUnit), unit), 1);
              patch({
                weightUnit: unit,
                weight: convert(draft.weight),
                goalWeight: convert(draft.goalWeight),
              });
            }}
            value={field === 'weight' ? draft.weight : draft.goalWeight}
            onChange={(v) => patch(field === 'weight' ? { weight: v } : { goalWeight: v })}
            error={error ?? undefined}
            helper={
              field === 'weight' ? 'Saving also adds a weigh-in for today.' : 'Optional.'
            }
            testID={field === 'weight' ? 'field-weight' : 'field-goal-weight'}
          />
        ) : null}

        {field === 'activityLevel' ? (
          <ActivityLevelPicker
            value={draft.activityLevel}
            onChange={(activityLevel) => patch({ activityLevel })}
            testID="field-activity"
          />
        ) : null}

        <View style={[styles.actions, { gap: spacing.sm }]}>
          <Button title="Cancel" variant="ghost" onPress={onClose} testID="field-cancel" />
          <Button
            title="Save"
            onPress={handleSave}
            disabled={error !== null}
            loading={saving}
            testID="field-save"
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  flex: { flex: 1 },
  flexWide: { flex: 1.4 },
  row: { flexDirection: 'row' },
});
