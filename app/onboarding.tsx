import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import {
  Button,
  Card,
  Divider,
  KeyboardAvoider,
  NumberField,
  Screen,
  SegmentedControl,
  TextField,
  useTheme,
} from '@/ui';
import {
  addWeightLog,
  getActiveGoal,
  getProfile,
  saveGoal,
  saveProfile,
  saveSettings,
} from '@/db/repositories';
import { formatEnergy, formatWeight } from '@/domain';
import { useAppStore } from '@/store/appStore';
import type { Sex } from '@/types';

import { ActivityLevelPicker } from '@/features/profile/ActivityLevelPicker';
import { GoalPicker } from '@/features/profile/GoalPicker';
import { MacroSplitPicker } from '@/features/profile/MacroSplitPicker';
import { PlanBreakdownCard } from '@/features/profile/PlanBreakdownCard';
import { BirthDateFields, HeightFields, WeightField } from '@/features/profile/ProfileFieldSheet';
import { RateStepper } from '@/features/profile/RateStepper';
import { TargetSummaryCard } from '@/features/profile/TargetSummaryCard';
import { ONBOARDING_STEPS, useOnboardingForm } from '@/features/profile/useOnboardingForm';

const PITCH = [
  {
    icon: 'calculator-outline' as const,
    title: 'Targets you can audit',
    body: 'BMR, TDEE and your deficit are always visible.',
  },
  {
    icon: 'camera-outline' as const,
    title: 'Log food fast',
    body: 'Search, scan a label, or photograph the plate.',
  },
  {
    icon: 'trending-down' as const,
    title: 'Adjust as you go',
    body: 'Recalculate from your latest weigh-in at any time.',
  },
];

export default function OnboardingScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors, spacing, radius, typography } = useTheme();

  const settings = useAppStore((s) => s.settings);
  const setProfile = useAppStore((s) => s.setProfile);
  const setGoal = useAppStore((s) => s.setGoal);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const form = useOnboardingForm({
    initialWeightUnit: settings.weightUnit,
    initialHeightUnit: settings.heightUnit,
  });

  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const stepMeta = ONBOARDING_STEPS[form.step];

  const handleNext = useCallback(() => {
    void Haptics.selectionAsync();
    form.next();
  }, [form]);

  const handleFinish = useCallback(async () => {
    const payload = form.buildPayload();
    if (!payload) {
      Alert.alert('Almost there', 'Some details are still missing — go back and check each step.');
      return;
    }
    setSaving(true);
    try {
      const savedProfile = await saveProfile(payload.profile);
      const savedGoal = await saveGoal(payload.goal);
      await addWeightLog(payload.weightLog);
      const unitPatch = {
        weightUnit: form.fields.weightUnit,
        heightUnit: form.fields.heightUnit,
      };
      updateSettings(unitPatch);
      void Promise.resolve(saveSettings(unitPatch)).catch(() => undefined);
      const [profile, goal] = await Promise.all([getProfile(), getActiveGoal()]);
      setProfile(profile ?? savedProfile ?? null);
      setGoal(goal ?? savedGoal ?? null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (error) {
      Alert.alert(
        'Could not save your plan',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSaving(false);
    }
  }, [form, router, setGoal, setProfile, updateSettings]);

  const floorWarning = useMemo(() => {
    if (!form.belowFloor || !form.targets) return null;
    return `${formatEnergy(form.targets.calories)} is below the ${formatEnergy(
      form.floor
    )} floor generally considered safe without medical supervision. You can keep it, but a gentler pace is usually more sustainable.`;
  }, [form.belowFloor, form.floor, form.targets]);

  return (
    <KeyboardAvoider>
      <Screen title={stepMeta.title} subtitle={stepMeta.subtitle} scrollable padded>
        <View
          style={[styles.dots, { marginBottom: spacing.lg }]}
          accessibilityLabel={`Step ${form.step + 1} of ${form.stepCount}`}
        >
          {ONBOARDING_STEPS.map((s, i) => (
            <View
              key={s.key}
              testID={`onboarding-dot-${i}`}
              style={[
                styles.dot,
                {
                  backgroundColor: i <= form.step ? colors.primary : colors.surfaceAlt,
                  width: i === form.step ? 22 : 8,
                },
              ]}
            />
          ))}
        </View>

        {form.stepKey === 'welcome' ? (
          <View style={{ gap: spacing.md }} testID="onboarding-step-welcome">
            <Card>
              <Text style={[typography.h3, { color: colors.text }]}>
                Calorie goals that come from your numbers.
              </Text>
              <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm }]}>
                MacroTrack works out your metabolic rate, adds your activity, then applies the pace
                you choose. Nothing is a black box — every screen shows the maths.
              </Text>
            </Card>
            {PITCH.map((item) => (
              <Card key={item.title}>
                <View style={styles.pitchRow}>
                  <View
                    style={[
                      styles.pitchIcon,
                      {
                        backgroundColor: colors.surfaceAlt,
                        borderRadius: radius.md,
                        marginRight: spacing.md,
                      },
                    ]}
                  >
                    <Ionicons name={item.icon} size={18} color={colors.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={[typography.title, { color: colors.text }]}>{item.title}</Text>
                    <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
                      {item.body}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {form.stepKey === 'about' ? (
          <View style={{ gap: spacing.lg }} testID="onboarding-step-about">
            <TextField
              label="What should we call you?"
              value={form.fields.name}
              onChangeText={(name) => form.set('name', name)}
              placeholder="Alex"
              error={form.errors.name}
              testID="onboarding-name"
            />
            <View>
              <Text
                style={[typography.label, { color: colors.textMuted, marginBottom: spacing.sm }]}
              >
                Sex
              </Text>
              <SegmentedControl<Sex>
                options={[
                  { label: 'Male', value: 'male' },
                  { label: 'Female', value: 'female' },
                ]}
                value={form.fields.sex}
                onChange={form.setSex}
                testID="onboarding-sex"
              />
              <Text style={[typography.caption, { color: colors.textFaint, marginTop: spacing.xs }]}>
                The BMR formula needs this; it is stored on your device only.
              </Text>
            </View>
            <View>
              <Text
                style={[typography.label, { color: colors.textMuted, marginBottom: spacing.sm }]}
              >
                Date of birth
              </Text>
              <BirthDateFields
                month={form.fields.birthMonth}
                day={form.fields.birthDay}
                year={form.fields.birthYear}
                ageYears={form.ageYears}
                error={form.errors.birthDate}
                onChange={(p) => {
                  if (p.month !== undefined) form.set('birthMonth', p.month);
                  if (p.day !== undefined) form.set('birthDay', p.day);
                  if (p.year !== undefined) form.set('birthYear', p.year);
                }}
              />
            </View>
          </View>
        ) : null}

        {form.stepKey === 'body' ? (
          <View style={{ gap: spacing.xl }} testID="onboarding-step-body">
            <HeightFields
              unit={form.fields.heightUnit}
              onUnitChange={form.setHeightUnit}
              cm={form.fields.heightCmInput}
              ft={form.fields.heightFt}
              inches={form.fields.heightIn}
              error={form.errors.height}
              onChange={(p) => {
                if (p.cm !== undefined) form.set('heightCmInput', p.cm);
                if (p.ft !== undefined) form.set('heightFt', p.ft);
                if (p.inches !== undefined) form.set('heightIn', p.inches);
              }}
            />
            <WeightField
              label="Current weight"
              unit={form.fields.weightUnit}
              onUnitChange={form.setWeightUnit}
              value={form.fields.weightInput}
              onChange={(v) => form.set('weightInput', v)}
              error={form.errors.weight}
              helper="Logged as your first weigh-in."
              testID="onboarding-weight"
            />
          </View>
        ) : null}

        {form.stepKey === 'activity' ? (
          <View testID="onboarding-step-activity">
            <ActivityLevelPicker
              value={form.fields.activityLevel}
              onChange={(level) => form.set('activityLevel', level)}
            />
            {form.errors.activityLevel ? (
              <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
                {form.errors.activityLevel}
              </Text>
            ) : null}
          </View>
        ) : null}

        {form.stepKey === 'goal' ? (
          <View style={{ gap: spacing.lg }} testID="onboarding-step-goal">
            <GoalPicker value={form.fields.goalType} onChange={form.setGoalType} />

            {form.fields.goalType ? (
              <Card>
                <Text
                  style={[typography.label, { color: colors.textMuted, marginBottom: spacing.sm }]}
                >
                  Weekly pace
                </Text>
                <RateStepper
                  goalType={form.fields.goalType}
                  value={form.fields.rateKgPerWeek}
                  bounds={form.rateBoundsForGoal}
                  weightUnit={form.fields.weightUnit}
                  onNudge={form.nudgeRate}
                />
              </Card>
            ) : null}

            {form.fields.goalType && form.fields.goalType !== 'maintain' ? (
              <Card>
                <NumberField
                  label="Goal weight (optional)"
                  value={form.fields.goalWeightInput}
                  onChange={(v) => form.set('goalWeightInput', v)}
                  suffix={form.fields.weightUnit}
                  decimals={1}
                  error={form.errors.goalWeight}
                  testID="onboarding-goal-weight"
                />
                {form.weeksToGoal !== null && form.goalWeightKg !== null ? (
                  <Text
                    style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}
                    testID="onboarding-time-to-goal"
                  >
                    {form.weeksToGoal === 0
                      ? 'You are already at your goal weight.'
                      : `About ${form.weeksToGoal} week${
                          form.weeksToGoal === 1 ? '' : 's'
                        } to reach ${formatWeight(form.goalWeightKg, form.fields.weightUnit)} at this pace.`}
                  </Text>
                ) : null}
              </Card>
            ) : null}
          </View>
        ) : null}

        {form.stepKey === 'plan' && form.plan && form.targets && form.fields.activityLevel ? (
          <View style={{ gap: spacing.lg }} testID="onboarding-step-plan">
            <PlanBreakdownCard
              plan={form.plan}
              activityLevel={form.fields.activityLevel}
              targets={form.targets}
              collapsible={false}
              energyUnit={settings.energyUnit}
            />

            <Card>
              <Text
                style={[typography.label, { color: colors.textMuted, marginBottom: spacing.sm }]}
              >
                Macro split
              </Text>
              <MacroSplitPicker
                value={form.fields.macroSplit}
                onChange={(preset) => form.set('macroSplit', preset)}
                isCustom={form.fields.isManualOverride}
              />
            </Card>

            <TargetSummaryCard
              targets={form.targets}
              energyUnit={settings.energyUnit}
              isManualOverride={form.fields.isManualOverride}
              warning={floorWarning}
            />

            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fine-tune targets"
                accessibilityState={{ expanded: fineTuneOpen }}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setFineTuneOpen((prev) => !prev);
                }}
                style={styles.disclosure}
                testID="fine-tune-toggle"
              >
                <View style={styles.flex}>
                  <Text style={[typography.title, { color: colors.text }]}>Fine-tune</Text>
                  <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
                    Override the calories or any macro by hand.
                  </Text>
                </View>
                <Ionicons
                  name={fineTuneOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>

              {fineTuneOpen ? (
                <View style={{ marginTop: spacing.md }} testID="fine-tune-body">
                  <Divider />
                  <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                    <NumberField
                      label="Calories"
                      value={form.targets.calories}
                      onChange={(v) => form.setOverrideField('calories', v)}
                      suffix="kcal"
                      testID="fine-tune-calories"
                    />
                    <View style={[styles.row, { gap: spacing.sm }]}>
                      <View style={styles.flex}>
                        <NumberField
                          label="Protein"
                          value={form.targets.protein}
                          onChange={(v) => form.setOverrideField('protein', v)}
                          suffix="g"
                          testID="fine-tune-protein"
                        />
                      </View>
                      <View style={styles.flex}>
                        <NumberField
                          label="Carbs"
                          value={form.targets.carbs}
                          onChange={(v) => form.setOverrideField('carbs', v)}
                          suffix="g"
                          testID="fine-tune-carbs"
                        />
                      </View>
                      <View style={styles.flex}>
                        <NumberField
                          label="Fat"
                          value={form.targets.fat}
                          onChange={(v) => form.setOverrideField('fat', v)}
                          suffix="g"
                          testID="fine-tune-fat"
                        />
                      </View>
                    </View>
                    {form.fields.isManualOverride ? (
                      <Button
                        title="Reset to calculated"
                        variant="ghost"
                        size="sm"
                        onPress={() => form.setManualEnabled(false)}
                        testID="fine-tune-reset"
                      />
                    ) : null}
                  </View>
                </View>
              ) : null}
            </Card>
          </View>
        ) : null}

        {form.stepKey === 'plan' && form.errors.plan ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{form.errors.plan}</Text>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </Screen>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.bg,
            borderTopColor: colors.border,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          },
        ]}
      >
        <Button
          title="Back"
          variant="ghost"
          onPress={form.back}
          disabled={form.isFirstStep || saving}
          testID="onboarding-back"
        />
        <View style={styles.flex} />
        {form.isLastStep ? (
          <Button
            title="Start tracking"
            onPress={() => void handleFinish()}
            disabled={!form.canGoNext}
            loading={saving}
            testID="onboarding-finish"
          />
        ) : (
          <Button
            title={form.step === 0 ? 'Get started' : 'Next'}
            onPress={handleNext}
            disabled={!form.canGoNext}
            testID="onboarding-next"
          />
        )}
      </View>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  disclosure: { alignItems: 'center', flexDirection: 'row' },
  dot: { borderRadius: 4, height: 8, marginRight: 6 },
  dots: { alignItems: 'center', flexDirection: 'row' },
  flex: { flex: 1 },
  footer: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  pitchIcon: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  pitchRow: { alignItems: 'center', flexDirection: 'row' },
  row: { flexDirection: 'row' },
});
