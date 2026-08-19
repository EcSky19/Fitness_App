import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { ActivityCard, type HealthSnapshot } from '@/features/dashboard/ActivityCard';
import { CalorieHeroCard } from '@/features/dashboard/CalorieHeroCard';
import { DashText } from '@/features/dashboard/dashboardText';
import { MacroSummaryCard } from '@/features/dashboard/MacroSummaryCard';
import { MealsSummaryCard } from '@/features/dashboard/MealsSummaryCard';
import { OnboardingPromptCard } from '@/features/dashboard/OnboardingPromptCard';
import { QuickActionsRow } from '@/features/dashboard/QuickActionsRow';
import { inferMealType, useDashboardData } from '@/features/dashboard/useDashboardData';
import { WeeklyStrip } from '@/features/dashboard/WeeklyStrip';
import { WeightSnapshotCard } from '@/features/dashboard/WeightSnapshotCard';
import { isFutureISO } from '@/domain';
import { syncHealthDay } from '@/services/health';
import { useAppStore } from '@/store/appStore';
import { Button, DateStepper, Screen, useTheme } from '@/ui';
import type { ISODate, MealType } from '@/types';

/**
 * Today — the daily command centre.
 *
 * Deliberately thin: data comes from `useDashboardData` (which delegates all
 * nutrition math to `@/domain`) and every section is its own card component in
 * `src/features/dashboard`.
 */
export default function TodayScreen() {
  const router = useRouter();
  const { colors, spacing } = useTheme();

  const selectedDate = useAppStore((s) => s.selectedDate);
  const setSelectedDate = useAppStore((s) => s.setSelectedDate);
  const settings = useAppStore((s) => s.settings);
  const invalidate = useAppStore((s) => s.invalidate);

  const {
    profile,
    summary,
    targets,
    hasTargets,
    addExerciseToTarget,
    entries,
    exercises,
    weightLogs,
    week,
    error,
    reload,
  } = useDashboardData();

  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);

  const healthSyncEnabled = settings.healthSyncEnabled;
  const isFuture = useMemo(() => {
    try {
      return isFutureISO(selectedDate);
    } catch {
      return false;
    }
  }, [selectedDate]);

  const defaultMeal = useMemo<MealType>(() => inferMealType(), []);

  const handleDateChange = useCallback(
    (next: ISODate) => {
      try {
        if (isFutureISO(next)) return;
      } catch {
        // If the guard is unavailable, fall through and accept the date.
      }
      setSelectedDate(next);
    },
    [setSelectedDate]
  );

  const runHealthSync = useCallback(async () => {
    if (!healthSyncEnabled) return;
    setSyncing(true);
    try {
      const result = await syncHealthDay(selectedDate);
      if (result.ok && result.data) {
        setHealth(result.data);
        setSyncError(null);
        if (result.data.importedWorkouts > 0) invalidate();
      } else {
        setSyncError(result.error ?? 'Could not sync health data');
      }
    } catch {
      setSyncError('Could not sync health data');
    } finally {
      setSyncing(false);
    }
  }, [healthSyncEnabled, selectedDate, invalidate]);

  useEffect(() => {
    setHealth(null);
    setSyncError(null);
    if (!healthSyncEnabled || isFuture) return;
    void runHealthSync();
  }, [healthSyncEnabled, isFuture, runHealthSync]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        reload();
        if (healthSyncEnabled && !isFuture) await runHealthSync();
      } finally {
        setRefreshing(false);
      }
    })();
  }, [reload, healthSyncEnabled, isFuture, runHealthSync]);

  const tapFeedback = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const openDiary = useCallback(() => router.push('/(tabs)/diary'), [router]);
  const openActivity = useCallback(() => router.push('/(tabs)/activity'), [router]);
  const openWeight = useCallback(() => router.push('/(tabs)/weight'), [router]);
  const openSettings = useCallback(() => router.push('/settings'), [router]);
  const openOnboarding = useCallback(() => router.push('/onboarding'), [router]);

  const openFoodSearch = useCallback(
    (meal: MealType) => {
      router.push({ pathname: '/food-search', params: { date: selectedDate, mealType: meal } });
    },
    [router, selectedDate]
  );

  const openScan = useCallback(() => {
    router.push({ pathname: '/scan', params: { date: selectedDate, mealType: defaultMeal } });
  }, [router, selectedDate, defaultMeal]);

  return (
    <Screen
      title="Today"
      scrollable
      refreshing={refreshing}
      onRefresh={handleRefresh}
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          hitSlop={10}
          onPress={openSettings}
        >
          <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
        </Pressable>
      }
    >
      <View style={[styles.stack, { gap: spacing.lg }]}>
        <DateStepper date={selectedDate} onChange={handleDateChange} />

        {isFuture ? (
          <DashText variant="caption" color={colors.textMuted}>
            You are viewing a future date. Nothing can be logged yet.
          </DashText>
        ) : null}

        {error ? (
          <View style={styles.errorRow}>
            <DashText variant="caption" color={colors.danger}>
              {error}
            </DashText>
            <Button title="Retry" onPress={reload} variant="ghost" size="sm" />
          </View>
        ) : null}

        {!profile ? <OnboardingPromptCard onStart={openOnboarding} /> : null}

        <CalorieHeroCard
          summary={summary}
          addExerciseToTarget={addExerciseToTarget}
          hasTargets={hasTargets}
        />

        <MacroSummaryCard
          consumed={summary.consumed}
          targets={targets}
          hasTargets={hasTargets}
        />

        <QuickActionsRow
          onScan={openScan}
          onAddFood={() => openFoodSearch(defaultMeal)}
          onLogExercise={openActivity}
          onLogWeight={openWeight}
        />

        <MealsSummaryCard
          summary={summary}
          entries={entries}
          onOpenDiary={() => {
            tapFeedback();
            openDiary();
          }}
          onAddFood={openFoodSearch}
        />

        <ActivityCard
          exercises={exercises}
          exerciseBurned={summary.exerciseBurned}
          health={health}
          healthEnabled={healthSyncEnabled}
          syncing={syncing}
          syncError={syncError}
          onSync={() => void runHealthSync()}
          onOpenSettings={openSettings}
          onOpenActivity={openActivity}
        />

        <WeightSnapshotCard
          logs={weightLogs}
          unit={settings.weightUnit}
          selectedDate={selectedDate}
          onOpenWeight={openWeight}
        />

        <WeeklyStrip week={week} targetCalories={targets.calories} onPress={openDiary} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});