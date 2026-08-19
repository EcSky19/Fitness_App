import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ListRow,
  Screen,
  SectionHeader,
  Sheet,
  StatTile,
  useTheme,
} from '@/ui';
import {
  addWeightLog,
  getActiveGoal,
  getLatestWeight,
  getProfile,
  listGoals,
  listWeightLogs,
  saveGoal,
  saveProfile,
} from '@/db/repositories';
import {
  bmi as calcBmi,
  bmiCategory,
  calcAge,
  describeGoal,
  formatEnergy,
  formatHeight,
  formatWeight,
  roundTo,
  todayISO,
} from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useAppStore } from '@/store/appStore';
import { GOAL_LABELS } from '@/types/constants';
import type { Goal, UserProfile, WeightLog } from '@/types';

import { AccountSection } from '@/features/auth/AuthUI';
import { BodyStatsCard } from '@/features/profile/BodyStatsCard';
import { GoalPicker } from '@/features/profile/GoalPicker';
import { MacroSplitPicker } from '@/features/profile/MacroSplitPicker';
import { PlanBreakdownCard } from '@/features/profile/PlanBreakdownCard';
import {
  ProfileFieldSheet,
  TARGET_AFFECTING_FIELDS,
  type ProfileField,
} from '@/features/profile/ProfileFieldSheet';
import { RateStepper } from '@/features/profile/RateStepper';
import { TargetSummaryCard } from '@/features/profile/TargetSummaryCard';
import { MONTH_NAMES } from '@/features/profile/useOnboardingForm';
import { computePlan, useGoalEditor } from '@/features/profile/useGoalEditor';

interface ProfileData {
  weights: WeightLog[];
  goals: Goal[];
  latestWeightKg: number | null;
}

const EMPTY_DATA: ProfileData = { weights: [], goals: [], latestWeightKg: null };

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!m || !d) return iso;
  const month = MONTH_NAMES[m - 1]?.slice(0, 3) ?? '';
  return `${month} ${d}, ${y}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `getLatestWeight()` may resolve to a number or a `WeightLog`; accept both. */function readWeightKg(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value && typeof value === 'object' && 'weightKg' in value) {
    const kg = (value as { weightKg?: unknown }).weightKg;
    return typeof kg === 'number' && Number.isFinite(kg) ? kg : null;
  }
  return null;
}

export default function ProfileScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();

  const profile = useAppStore((s) => s.profile);
  const goal = useAppStore((s) => s.goal);
  const settings = useAppStore((s) => s.settings);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const setProfile = useAppStore((s) => s.setProfile);
  const setGoal = useAppStore((s) => s.setGoal);

  const { data, loading, reload } = useAsyncData<ProfileData>(
    async () => {
      const [weights, goals, latest] = await Promise.all([
        listWeightLogs(5),
        listGoals(),
        getLatestWeight(),
      ]);
      const latestKg = readWeightKg(latest);
      return { weights: weights ?? [], goals: goals ?? [], latestWeightKg: latestKg };
    },
    [dataVersion],
    EMPTY_DATA
  );

  const [editField, setEditField] = useState<ProfileField | null>(null);
  const [goalSheetOpen, setGoalSheetOpen] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const savingGoalRef = useRef(false);

  const editor = useGoalEditor({ profile, goal, latestWeightKg: data.latestWeightKg });

  /* ---------------------------------------------------------------------- */
  /* Persistence helpers                                                     */
  /* ---------------------------------------------------------------------- */

  const refreshStore = useCallback(async () => {
    const [nextProfile, nextGoal] = await Promise.all([getProfile(), getActiveGoal()]);
    setProfile(nextProfile);
    setGoal(nextGoal);
  }, [setGoal, setProfile]);

  const persistGoal = useCallback(async () => {
    if (savingGoalRef.current) return;
    const payload = editor.buildGoalPayload();
    if (!payload) return;
    savingGoalRef.current = true;
    setSavingGoal(true);
    try {
      await saveGoal(payload);
      await refreshStore();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setGoalSheetOpen(false);
      reload();
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      savingGoalRef.current = false;
      setSavingGoal(false);
    }
  }, [editor, refreshStore, reload]);

  /** Recomputes the active goal's targets from the freshly saved profile. */
  const recalculateActiveGoal = useCallback(
    async (nextProfile: UserProfile | null) => {
      if (!nextProfile || !goal) return;
      const age = calcAge(nextProfile.birthDate);
      if (!Number.isFinite(age) || age <= 0 || nextProfile.currentWeightKg <= 0) return;
      const plan = computePlan({
        sex: nextProfile.sex,
        weightKg: nextProfile.currentWeightKg,
        heightCm: nextProfile.heightCm,
        ageYears: age,
        activityLevel: nextProfile.activityLevel,
        goalType: goal.type,
        rateKgPerWeek: goal.rateKgPerWeek,
        macroSplit: goal.macroSplit === 'custom' ? 'balanced' : goal.macroSplit,
      });
      await saveGoal({
        type: goal.type,
        rateKgPerWeek: goal.rateKgPerWeek,
        macroSplit: goal.macroSplit === 'custom' ? 'balanced' : goal.macroSplit,
        targets: plan.targets,
        isManualOverride: false,
        startedAt: goal.startedAt,
        isActive: true,
      });
      await refreshStore();
      reload();
    },
    [goal, refreshStore, reload]
  );

  const handleFieldSave = useCallback(
    async (patch: Partial<UserProfile>, field: ProfileField) => {
      setEditField(null);
      try {
        await saveProfile(patch);
        if (field === 'weight' && typeof patch.currentWeightKg === 'number') {
          await addWeightLog({
            date: todayISO(),
            weightKg: patch.currentWeightKg,
            bodyFatPct: null,
            note: null,
            source: 'manual',
          });
        }
        const nextProfile = await getProfile();
        setProfile(nextProfile);
        reload();

        if (goal && TARGET_AFFECTING_FIELDS.includes(field)) {
          const custom = goal.isManualOverride;
          Alert.alert(
            'Your targets changed',
            custom
              ? 'Your stats changed, but your targets are set manually. Recalculating will replace your custom numbers.'
              : 'Your stats changed. Recalculate your daily targets from the new numbers?',
            [
              { text: 'Keep current', style: 'cancel' },
              {
                text: 'Recalculate',
                onPress: () => {
                  void recalculateActiveGoal(nextProfile);
                },
              },
            ]
          );
        }
      } catch (error) {
        Alert.alert('Could not save', error instanceof Error ? error.message : 'Please try again.');
      }
    },
    [goal, recalculateActiveGoal, reload, setProfile]
  );

  /* ---------------------------------------------------------------------- */
  /* Derived                                                                 */
  /* ---------------------------------------------------------------------- */

  const header = useMemo(() => {
    if (!profile) return null;
    const age = calcAge(profile.birthDate);
    const bmiValue = profile.heightCm > 0 ? roundTo(calcBmi(profile.currentWeightKg, profile.heightCm), 1) : 0;
    return {
      age: Number.isFinite(age) && age > 0 ? age : null,
      bmiValue,
      bmiLabel: bmiValue > 0 ? capitalize(bmiCategory(bmiValue)) : null,
    };
  }, [profile]);

  const goalFloorWarning = useMemo(() => {
    if (!editor.belowFloor || !editor.targets) return null;
    return `${formatEnergy(editor.targets.calories)} is under the ${formatEnergy(
      editor.floor
    )} safety floor. Allowed, but slow down if you can.`;
  }, [editor.belowFloor, editor.floor, editor.targets]);

  /* ---------------------------------------------------------------------- */
  /* No profile yet                                                          */
  /* ---------------------------------------------------------------------- */

  if (!profile) {
    return (
      <Screen title="Profile" padded testID="profile-screen">
        <EmptyState
          icon="person-add-outline"
          title="Set up your profile"
          message="Answer six quick questions and MacroTrack will calculate your calorie and macro targets."
          actionLabel="Start setup"
          onAction={() => router.push('/onboarding')}
          testID="profile-onboarding-cta"
        />
      </Screen>
    );
  }

  const bmiTone = /normal|healthy/i.test(header?.bmiLabel ?? '') ? 'success' : 'warning';

  return (
    <Screen
      title="Profile"
      subtitle={profile.name || undefined}
      scrollable
      padded
      refreshing={loading}
      onRefresh={reload}
      testID="profile-screen"
    >
      {/* ---- Identity ---- */}
      <Card testID="profile-header-card">
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text style={[typography.h2, { color: colors.text }]}>{profile.name || 'You'}</Text>
            <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
              {[
                header?.age ? `${header.age} yrs` : null,
                profile.sex === 'male' ? 'Male' : 'Female',
                formatHeight(profile.heightCm, settings.heightUnit),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          {header?.bmiLabel ? <Badge label={header.bmiLabel} tone={bmiTone} /> : null}
        </View>

        <View style={[styles.tiles, { marginTop: spacing.lg }]}>
          <StatTile
            label="Weight"
            value={formatWeight(profile.currentWeightKg, settings.weightUnit)}
            icon="barbell-outline"
            color={colors.primary}
            testID="profile-weight-tile"
          />
          <View style={{ width: spacing.sm }} />
          <StatTile
            label="BMI"
            value={header?.bmiValue ? header.bmiValue.toFixed(1) : '—'}
            sublabel={header?.bmiLabel ?? undefined}
            icon="body-outline"
            color={colors.fat}
            testID="profile-bmi-tile"
          />
          <View style={{ width: spacing.sm }} />
          <StatTile
            label="Goal weight"
            value={
              profile.goalWeightKg && profile.goalWeightKg > 0
                ? formatWeight(profile.goalWeightKg, settings.weightUnit)
                : '—'
            }
            icon="flag-outline"
            color={colors.carbs}
            testID="profile-goal-weight-tile"
          />
        </View>
      </Card>

      {/* ---- Current plan ---- */}
      <SectionHeader title="Current plan" />
      {goal && editor.targets ? (
        <TargetSummaryCard
          targets={goal.targets}
          title={GOAL_LABELS[goal.type]}
          subtitle={describeGoal(goal.type, goal.rateKgPerWeek, settings.weightUnit)}
          energyUnit={settings.energyUnit}
          isManualOverride={goal.isManualOverride}
          footer={
            <Button
              title="Edit goal"
              variant="secondary"
              fullWidth
              onPress={() => {
                void Haptics.selectionAsync();
                editor.reset();
                setGoalSheetOpen(true);
              }}
              testID="edit-goal-button"
            />
          }
        />
      ) : (
        <Card testID="profile-no-goal">
          <Text style={[typography.body, { color: colors.textMuted }]}>
            No active goal yet. Set one to get daily calorie and macro targets.
          </Text>
          <View style={{ marginTop: spacing.md }}>
            <Button
              title="Set a goal"
              onPress={() => {
                editor.reset();
                setGoalSheetOpen(true);
              }}
              testID="set-goal-button"
            />
          </View>
        </Card>
      )}

      {/* ---- Plan breakdown ---- */}
      {editor.plan ? (
        <View style={{ marginTop: spacing.md }}>
          <PlanBreakdownCard
            plan={editor.plan}
            activityLevel={profile.activityLevel}
            targets={goal?.targets ?? editor.targets}
            collapsible
            energyUnit={settings.energyUnit}
          />
        </View>
      ) : null}

      {/* ---- Body stats ---- */}
      <BodyStatsCard
        profile={profile}
        weightUnit={settings.weightUnit}
        heightUnit={settings.heightUnit}
        onEdit={(field) => {
          void Haptics.selectionAsync();
          setEditField(field);
        }}
      />

      {/* ---- Weight history ---- */}
      <SectionHeader
        title="Recent weigh-ins"
        right={
          <Text
            style={[typography.label, { color: colors.primary }]}
            onPress={() => router.push('/(tabs)/weight')}
            accessibilityRole="link"
            accessibilityLabel="See all weigh-ins"
          >
            See all
          </Text>
        }
      />
      <Card padded={false} testID="weight-history-card">
        {data.weights.length === 0 ? (
          <View style={{ padding: spacing.lg }}>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              No weigh-ins logged yet.
            </Text>
          </View>
        ) : (
          data.weights.map((log, index) => (
            <View key={log.id ?? `${log.date}-${index}`}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                title={formatWeight(log.weightKg, settings.weightUnit)}
                subtitle={shortDate(log.date)}
                leftIcon="scale-outline"
                leftColor={colors.primary}
                onPress={() => router.push('/(tabs)/weight')}
                testID={`weight-log-${index}`}
              />
            </View>
          ))
        )}
      </Card>

      {/* ---- Goal history ---- */}
      <SectionHeader title="Goal history" />
      <Card padded={false} testID="goal-history-card">
        {data.goals.length === 0 ? (
          <View style={{ padding: spacing.lg }}>
            <Text style={[typography.body, { color: colors.textMuted }]}>No past goals yet.</Text>
          </View>
        ) : (
          data.goals.map((g, index) => (
            <View key={g.id ?? `${g.startedAt}-${index}`}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                title={GOAL_LABELS[g.type]}
                subtitle={`${describeGoal(g.type, g.rateKgPerWeek, settings.weightUnit)} · from ${shortDate(
                  g.startedAt
                )}`}
                meta={formatEnergy(g.targets.calories, settings.energyUnit)}
                leftIcon={g.type === 'cut' ? 'trending-down' : g.type === 'bulk' ? 'trending-up' : 'remove-outline'}
                leftColor={g.isActive ? colors.primary : colors.textFaint}
                right={g.isActive ? <Badge label="Active" tone="primary" /> : undefined}
                testID={`goal-history-${index}`}
              />
            </View>
          ))
        )}
      </Card>

      {/* ---- Links ---- */}
      <SectionHeader title="More" />
      <Card padded={false}>
        <ListRow
          title="Settings"
          subtitle="Units, appearance, AI, health and data"
          leftIcon="settings-outline"
          leftColor={colors.textMuted}
          onPress={() => router.push('/settings')}
          testID="profile-settings-link"
        />
        <Divider />
        <ListRow
          title="Reset onboarding"
          subtitle="Walk through setup again"
          leftIcon="refresh-outline"
          leftColor={colors.warning}
          onPress={() => router.push('/onboarding')}
          testID="profile-reset-onboarding"
        />
      </Card>

      <AccountSection />

      <View style={{ height: spacing.xxl }} />

      {/* ---- Field editor ---- */}
      <ProfileFieldSheet
        field={editField}
        profile={profile}
        weightUnit={settings.weightUnit}
        heightUnit={settings.heightUnit}
        onClose={() => setEditField(null)}
        onSave={(patch, field) => void handleFieldSave(patch, field)}
      />

      {/* ---- Goal editor ---- */}
      <Sheet visible={goalSheetOpen} onClose={() => setGoalSheetOpen(false)} title="Edit goal">
        <View style={{ gap: spacing.lg }} testID="goal-editor-sheet">
          <GoalPicker value={editor.goalType} onChange={editor.setGoalType} />

          <View>
            <Text style={[typography.label, { color: colors.textMuted, marginBottom: spacing.sm }]}>
              Weekly pace
            </Text>
            <RateStepper
              goalType={editor.goalType}
              value={editor.rateKgPerWeek}
              bounds={editor.bounds}
              weightUnit={settings.weightUnit}
              onNudge={editor.nudgeRate}
            />
          </View>

          <View>
            <Text style={[typography.label, { color: colors.textMuted, marginBottom: spacing.sm }]}>
              Macro split
            </Text>
            <MacroSplitPicker
              value={editor.macroSplit}
              onChange={editor.setMacroSplit}
              isCustom={editor.isManualOverride}
            />
          </View>

          {editor.targets ? (
            <TargetSummaryCard
              targets={editor.targets}
              compareTo={editor.baseTargets}
              title="New daily target"
              subtitle={editor.baseTargets ? 'Before → after' : undefined}
              energyUnit={settings.energyUnit}
              isManualOverride={editor.isManualOverride}
              warning={goalFloorWarning}
            />
          ) : null}

          <Button
            title="Recalculate from my current stats"
            variant="ghost"
            fullWidth
            onPress={() => {
              void Haptics.selectionAsync();
              editor.recalculate();
            }}
            testID="goal-recalculate"
          />

          <View style={styles.sheetActions}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setGoalSheetOpen(false)}
              testID="goal-cancel"
            />
            <View style={{ width: spacing.sm }} />
            <Button
              title="Save goal"
              onPress={() => void persistGoal()}
              disabled={!editor.targets}
              loading={savingGoal}
              testID="goal-save"
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  tiles: { flexDirection: 'row' },
});
