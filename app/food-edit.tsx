import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getActiveGoal, listEntriesByDate, listExercisesByDate } from '@/db/repositories';
import { buildDailySummary, formatDateLabel, formatEnergy, formatMacroG, roundTo } from '@/domain';
import { MacroEditor } from '@/features/diary/MacroEditor';
import { QuantityUnitRow } from '@/features/diary/QuantityUnitRow';
import { useEntryDraft } from '@/features/diary/useEntryDraft';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useAppStore } from '@/store/appStore';
import {
  Badge,
  Button,
  Card,
  DateStepper,
  KeyboardAvoider,
  MacroBar,
  Screen,
  SegmentedControl,
  Sheet,
  TextField,
  useTheme,
} from '@/ui';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { ExerciseEntry, FoodEntry, MacroTargets, MealType } from '@/types';

const FALLBACK_TARGETS: MacroTargets = { calories: 2000, protein: 150, carbs: 200, fat: 67 };

const MEAL_OPTIONS: { label: string; value: MealType }[] = MEAL_TYPES.map((meal) => ({
  label: MEAL_LABELS[meal],
  value: meal,
}));

interface DayContext {
  entries: FoodEntry[];
  exercises: ExerciseEntry[];
  targets: MacroTargets;
}

const EMPTY_DAY: DayContext = { entries: [], exercises: [], targets: FALLBACK_TARGETS };

/**
 * Universal food entry editor.
 *
 * Routes handled:
 *   `/food-edit?entryId=`                       edit a logged entry
 *   `/food-edit?foodId=&date=&mealType=`        log a picked food
 *   `/food-edit?draft=<uriEncoded JSON>&…`      correct an AI detection (scan flow)
 *   `/food-edit?quickAdd=1&date=&mealType=`     type calories with no food record
 */
export default function FoodEditScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{
    entryId?: string;
    foodId?: string;
    draft?: string;
    quickAdd?: string;
    date?: string;
    mealType?: string;
  }>();

  const { colors, spacing, typography } = useTheme();
  const addExerciseToTarget = useAppStore((s) => s.settings.addExerciseToTarget);
  const storeGoal = useAppStore((s) => s.goal);

  const draft = useEntryDraft(params);
  const { state, errors, calories } = draft;

  const [photoOpen, setPhotoOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const loadDay = useCallback(async (): Promise<DayContext> => {
    const [entries, exercises, goal] = await Promise.all([
      Promise.resolve(listEntriesByDate(state.date)).catch(() => [] as FoodEntry[]),
      Promise.resolve(listExercisesByDate(state.date)).catch(() => [] as ExerciseEntry[]),
      Promise.resolve(getActiveGoal()).catch(() => null),
    ]);
    return {
      entries: entries ?? [],
      exercises: exercises ?? [],
      targets: goal?.targets ?? storeGoal?.targets ?? FALLBACK_TARGETS,
    };
  }, [state.date, storeGoal]);

  const { data: day } = useAsyncData<DayContext>(loadDay, [state.date], EMPTY_DAY);
  const dayContext = day ?? EMPTY_DAY;

  /** Day totals *without* this entry, so the preview is not double counted. */
  const remainingWithoutEntry = useMemo(() => {
    const others = dayContext.entries.filter((entry) => entry.id !== state.entryId);
    const summary = buildDailySummary({
      date: state.date,
      entries: others,
      exercises: dayContext.exercises,
      targets: dayContext.targets,
      addExerciseToTarget,
    });
    return summary.remainingCalories;
  }, [addExerciseToTarget, dayContext, state.date, state.entryId]);

  const projectedRemaining = roundTo(remainingWithoutEntry - state.macros.calories, 0);

  const confidencePct =
    state.visionConfidence != null ? Math.round(state.visionConfidence * 100) : null;
  const isAiDraft = state.mode === 'draft' || state.source === 'vision' || state.source === 'label';

  const closeEditor = useCallback(() => {
    // Deep links open this modal with nothing behind it; `back()` would strand
    // the user on the editor after a successful write.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/diary');
  }, []);

  const handleSave = useCallback(() => {
    void (async () => {
      const saved = await draft.save();
      if (saved) closeEditor();
    })();
  }, [closeEditor, draft]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete entry', `Remove "${state.name}" from your diary?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const removed = await draft.remove();
            if (removed) closeEditor();
          })();
        },
      },
    ]);
  }, [closeEditor, draft, state.name]);

  const handleSaveAsFood = useCallback(() => {
    void (async () => {
      const saved = await draft.saveAsCustomFood();
      if (saved) {
        Alert.alert('Saved to your foods', `"${state.name}" is now searchable.`);
      }
    })();
  }, [draft, state.name]);

  if (state.loading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator testID="food-edit-loading" size="large" color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <KeyboardAvoider>
      <Screen scrollable>
        {state.warning ? (
          <Pressable
            testID="food-edit-warning"
            accessibilityRole="button"
            accessibilityLabel={state.warning}
            onPress={draft.dismissWarning}
            style={[
              styles.banner,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.warning },
            ]}
          >
            <Text style={[typography.caption, { color: colors.warning }]}>{state.warning}</Text>
          </Pressable>
        ) : null}

        {isAiDraft ? (
          <View style={styles.aiRow}>
            <Badge
              testID="ai-confidence-badge"
              label={confidencePct != null ? `AI · ${confidencePct}% confident` : 'AI estimate'}
              tone="primary"
            />
            <Text style={[typography.caption, styles.aiHint, { color: colors.textMuted }]}>
              Tap any value to correct it.
            </Text>
          </View>
        ) : null}

        <TextField
          testID="entry-name"
          label="Name"
          value={state.name}
          onChangeText={draft.setName}
          placeholder="What did you eat?"
          error={errors.name}
          autoFocus={state.mode === 'quick_add'}
        />

        <View style={{ height: spacing.md }} />

        <TextField
          testID="entry-brand"
          label="Brand (optional)"
          value={state.brand}
          onChangeText={draft.setBrand}
          placeholder="Brand"
        />

        {state.photoUri ? (
          <Pressable
            testID="entry-photo"
            accessibilityRole="imagebutton"
            accessibilityLabel="View photo"
            onPress={() => setPhotoOpen(true)}
            style={[styles.photoWrap, { marginTop: spacing.lg, borderColor: colors.border }]}
          >
            <Image source={{ uri: state.photoUri }} style={styles.photo} resizeMode="cover" />
          </Pressable>
        ) : null}

        <View style={{ height: spacing.lg }} />

        <QuantityUnitRow
          quantity={state.quantity}
          onChangeQuantity={draft.setQuantity}
          unit={state.unit}
          units={state.units}
          onChangeUnit={draft.setUnit}
          gramsTotal={state.gramsTotal}
          servingLabel={state.servingLabel}
          error={errors.quantity}
        />

        <View style={{ height: spacing.lg }} />

        <SegmentedControl<MealType>
          options={MEAL_OPTIONS}
          value={state.mealType}
          onChange={draft.setMealType}
          size="sm"
        />

        <Pressable
          testID="entry-date-row"
          accessibilityRole="button"
          accessibilityLabel={`Date: ${formatDateLabel(state.date)}`}
          onPress={() => setDateOpen(true)}
          style={[
            styles.dateRow,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border, marginTop: spacing.md },
          ]}
        >
          <Text style={[typography.label, { color: colors.textMuted }]}>Date</Text>
          <Text style={[typography.title, { color: colors.text }]}>
            {formatDateLabel(state.date)}
          </Text>
        </Pressable>

        <View style={{ height: spacing.lg }} />

        <MacroEditor
          macros={state.macros}
          onChange={draft.setMacro}
          calories={calories}
          onUseComputed={draft.useComputedCalories}
          error={errors.macros}
        />

        <View style={{ height: spacing.lg }} />

        <Card testID="entry-preview">
          <Text style={[typography.label, { color: colors.textMuted }]}>This entry</Text>
          <Text testID="preview-calories" style={[typography.h2, { color: colors.text }]}>
            {formatEnergy(state.macros.calories)}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            {state.servingLabel} · {roundTo(state.gramsTotal, 1)} g
          </Text>
          <View style={{ height: spacing.md }} />
          <MacroBar
            protein={state.macros.protein}
            carbs={state.macros.carbs}
            fat={state.macros.fat}
            height={10}
          />
          <View style={{ height: spacing.sm }} />
          <Text style={[typography.caption, { color: colors.textMuted }]}>
            P {formatMacroG(state.macros.protein)} · C {formatMacroG(state.macros.carbs)} · F{' '}
            {formatMacroG(state.macros.fat)}
          </Text>
          <Text
            testID="preview-remaining"
            style={[
              typography.caption,
              styles.remaining,
              { color: projectedRemaining < 0 ? colors.warning : colors.success },
            ]}
          >
            {projectedRemaining < 0
              ? `${formatEnergy(Math.abs(projectedRemaining))} over your target`
              : `${formatEnergy(projectedRemaining)} left on ${formatDateLabel(state.date)}`}
          </Text>
        </Card>

        {draft.error ? (
          <Text testID="food-edit-error" style={[typography.caption, { color: colors.danger }]}>
            {draft.error}
          </Text>
        ) : null}

        <View style={{ height: spacing.xl }} />

        <Button
          testID="entry-save"
          title={state.mode === 'edit' ? 'Save changes' : 'Add to diary'}
          onPress={handleSave}
          disabled={!draft.canSave}
          loading={draft.saving}
          fullWidth
          size="lg"
        />

        {state.mode === 'draft' ? (
          <View style={{ marginTop: spacing.md }}>
            <Button
              testID="entry-save-as-food"
              title="Save as custom food"
              variant="secondary"
              onPress={handleSaveAsFood}
              disabled={!state.name.trim() || draft.saving}
              fullWidth
            />
          </View>
        ) : null}

        {state.mode === 'edit' ? (
          <View style={{ marginTop: spacing.md }}>
            <Button
              testID="entry-delete"
              title="Delete entry"
              variant="danger"
              icon="trash-outline"
              onPress={handleDelete}
              disabled={draft.saving}
              fullWidth
            />
          </View>
        ) : null}

        <Sheet visible={dateOpen} onClose={() => setDateOpen(false)} title="Choose a date">
          <View testID="entry-date-sheet">
            <DateStepper date={state.date} onChange={draft.setDate} />
            <View style={{ height: spacing.lg }} />
            <Button title="Done" onPress={() => setDateOpen(false)} fullWidth />
          </View>
        </Sheet>

        <Sheet visible={photoOpen} onClose={() => setPhotoOpen(false)} title="Photo">
          <View testID="entry-photo-sheet">
            {state.photoUri ? (
              <Image
                source={{ uri: state.photoUri }}
                style={styles.photoFull}
                resizeMode="contain"
              />
            ) : null}
          </View>
        </Sheet>
      </Screen>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  aiHint: {
    marginLeft: 8,
  },
  aiRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
  },
  banner: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    padding: 12,
  },
  dateRow: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  loading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 48,
  },
  photo: {
    height: 160,
    width: '100%',
  },
  photoFull: {
    borderRadius: 12,
    height: 320,
    width: '100%',
  },
  photoWrap: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  remaining: {
    marginTop: 8,
  },
});
