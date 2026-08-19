/**
 * Bottom sheet for logging a new workout or editing a manual one.
 * All calorie logic lives in `useWorkoutForm`.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';

import { addExerciseEntry, updateExerciseEntry } from '@/db/repositories';
import { EXERCISE_CATEGORIES, EXERCISE_CATEGORY_LABELS } from '@/types/constants';
import type { ExerciseCategory, ExerciseEntry, ISODate } from '@/types';
import { useAppStore } from '@/store/appStore';
import {
  Button,
  Chip,
  DateStepper,
  Divider,
  ListRow,
  NumberField,
  Sheet,
  TextField,
  useTheme,
} from '@/ui';

import { ActivityPicker } from './ActivityPicker';
import { DEFAULT_WEIGHT_KG, useWorkoutForm } from './useWorkoutForm';

const QUICK_DURATIONS = [15, 30, 45, 60];

export interface LogWorkoutSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Date used for new entries. */
  date: ISODate;
  /** Latest body weight on record, or null when unknown. */
  weightKg: number | null;
  /** Manual entry being edited; null logs a new workout. */
  entry?: ExerciseEntry | null;
  onSaved?: () => void;
}

interface BodyProps {
  date: ISODate;
  weightKg: number | null;
  entry: ExerciseEntry | null;
  onClose: () => void;
  onSaved?: () => void;
}

function WorkoutSheetBody({
  date,
  weightKg,
  entry,
  onClose,
  onSaved,
}: BodyProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const { height } = useWindowDimensions();
  const invalidate = useAppStore((s) => s.invalidate);
  const form = useWorkoutForm({ date, weightKg, entry });
  const [pickerOpen, setPickerOpen] = useState(!entry);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    // A double tap arrives before `saving` can re-render the button.
    if (!form.canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = form.buildPayload();
      if (entry) {
        await updateExerciseEntry(entry.id, payload);
      } else {
        await addExerciseEntry(payload);
      }
      invalidate();
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // haptics are cosmetic
      }
      onSaved?.();
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save this workout.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [entry, form, invalidate, onClose, onSaved]);

  if (pickerOpen) {
    return (
      <View>
        <ActivityPicker
          selectedId={form.values.activityId}
          onSelectActivity={(activity) => {
            form.selectActivity(activity);
            setPickerOpen(false);
          }}
          onSelectCustom={(name) => {
            form.selectCustom(name);
            setPickerOpen(false);
          }}
          maxHeight={Math.max(200, height * 0.45)}
        />
        <View style={{ marginTop: spacing.md }}>
          <Button title="Cancel" variant="ghost" onPress={onClose} fullWidth />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ maxHeight: Math.max(280, height * 0.62) }}
      keyboardShouldPersistTaps="handled"
      testID="workout-form-scroll"
    >
      <View>
        <ListRow
          title={form.values.name || 'Choose an activity'}
          subtitle={
            form.isCustom
              ? 'Custom activity'
              : `${EXERCISE_CATEGORY_LABELS[form.values.category]} · ${form.met} MET`
          }
          leftIcon="fitness"
          leftColor={colors.primary}
          meta="Change"
          onPress={() => setPickerOpen(true)}
          testID="workout-activity-row"
        />

        {form.isCustom ? (
          <TextField
            label="Activity name"
            value={form.values.name}
            onChangeText={form.setName}
            placeholder="e.g. Garden bootcamp"
            error={form.nameError ?? undefined}
          />
        ) : null}

        <Divider />

        <Text style={[typography.label, { color: colors.textMuted, marginTop: spacing.md }]}>
          Category
        </Text>
        <View style={styles.chipRow}>
          {EXERCISE_CATEGORIES.map((category: ExerciseCategory) => (
            <Chip
              key={category}
              label={EXERCISE_CATEGORY_LABELS[category]}
              selected={form.values.category === category}
              onPress={() => form.setCategory(category)}
            />
          ))}
        </View>

        <NumberField
          label="Duration"
          value={form.values.durationMin}
          onChange={form.setDurationMin}
          suffix="min"
          placeholder="0"
          min={0}
          max={1440}
        />
        <View style={styles.chipRow}>
          {QUICK_DURATIONS.map((minutes) => (
            <Chip
              key={minutes}
              label={`${minutes} min`}
              selected={form.values.durationMin === minutes}
              onPress={() => form.setDurationMin(minutes)}
            />
          ))}
        </View>

        <NumberField
          label="Calories burned"
          value={form.calories}
          onChange={form.setCalories}
          suffix="kcal"
          placeholder="0"
          min={0}
          max={20000}
        />
        <View style={styles.estimateRow}>
          <Text style={[typography.caption, { color: colors.textMuted, flex: 1 }]}>
            {form.isCaloriesOverridden
              ? `Your value · estimated: ${form.estimatedCalories} kcal`
              : `Estimated: ${form.estimatedCalories} kcal (${form.met} MET × ${Math.round(
                  form.weightKgUsed
                )} kg)`}
          </Text>
          {form.isCaloriesOverridden ? (
            <Button title="Use estimate" variant="ghost" size="sm" onPress={form.useEstimate} />
          ) : null}
        </View>
        {form.usingFallbackWeight ? (
          <Text style={[typography.caption, { color: colors.warning }]}>
            {`No weight on record — estimating with ${DEFAULT_WEIGHT_KG} kg. Log your weight for a sharper number.`}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.md }}>
          <Text style={[typography.label, { color: colors.textMuted }]}>Date</Text>
          <DateStepper date={form.values.date} onChange={form.setDate} />
          {form.dateError ? (
            <Text style={[typography.caption, { color: colors.danger }]}>{form.dateError}</Text>
          ) : null}
        </View>

        <TextField
          label="Notes"
          value={form.values.notes}
          onChangeText={form.setNotes}
          placeholder="How did it feel?"
          multiline
        />

        {saveError ? (
          <Text style={[typography.caption, { color: colors.danger }]} accessibilityRole="alert">
            {saveError}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Button
            title={entry ? 'Save changes' : 'Save workout'}
            onPress={() => {
              void handleSave();
            }}
            disabled={!form.canSave}
            loading={saving}
            icon="checkmark"
            fullWidth
            accessibilityLabel={entry ? 'Save changes' : 'Save workout'}
          />
          <View style={{ height: spacing.sm }} />
          <Button title="Cancel" variant="ghost" onPress={onClose} fullWidth />
        </View>
      </View>
    </ScrollView>
  );
}

export function LogWorkoutSheet({
  visible,
  onClose,
  date,
  weightKg,
  entry = null,
  onSaved,
}: LogWorkoutSheetProps): React.JSX.Element {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={entry ? 'Edit workout' : 'Log a workout'}
      // Both bodies below scroll themselves: the form needs a taller extent than
      // the picker, and the picker's search field has to stay pinned above its
      // results. A second scroller here would nest same-axis ScrollViews.
      scrollable={false}
    >
      {visible ? (
        <WorkoutSheetBody
          date={date}
          weightKg={weightKg}
          entry={entry}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  estimateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

export default LogWorkoutSheet;
