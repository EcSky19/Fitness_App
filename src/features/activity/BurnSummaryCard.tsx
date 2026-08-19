/**
 * Headline card for a day's energy burn.
 *
 * "Workouts" = every logged exercise entry (manual + imported).
 * "Daily activity" = health active energy that is NOT already covered by an
 * imported workout, so nothing is double counted.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ExerciseEntry, HealthDaySummary } from '@/types';
import { Card, ProgressRing, useTheme } from '@/ui';

export interface BurnSummaryCardProps {
  entries: ExerciseEntry[];
  health: HealthDaySummary | null;
  addExerciseToTarget: boolean;
  onOpenSettings?: () => void;
}

export function sumWorkoutCalories(entries: ExerciseEntry[]): number {
  return entries.reduce((total, entry) => total + (entry.caloriesBurned || 0), 0);
}

/** Active energy that no imported workout already accounts for. */
export function dailyActivityCalories(
  entries: ExerciseEntry[],
  health: HealthDaySummary | null
): number {
  if (!health) return 0;
  const imported = entries
    .filter((entry) => entry.source !== 'manual')
    .reduce((total, entry) => total + (entry.caloriesBurned || 0), 0);
  return Math.max(0, Math.round((health.activeEnergyKcal || 0) - imported));
}

export function BurnSummaryCard({
  entries,
  health,
  addExerciseToTarget,
  onOpenSettings,
}: BurnSummaryCardProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  const { workouts, daily, total } = useMemo(() => {
    const workoutKcal = Math.round(sumWorkoutCalories(entries));
    const dailyKcal = dailyActivityCalories(entries, health);
    return { workouts: workoutKcal, daily: dailyKcal, total: workoutKcal + dailyKcal };
  }, [entries, health]);

  const progress = total > 0 ? Math.min(1, workouts / total) : 0;

  const budgetLine = addExerciseToTarget
    ? `Adds ${workouts} kcal to today's budget`
    : 'Not added to your budget — change in Settings';

  return (
    <Card
      onPress={addExerciseToTarget ? undefined : onOpenSettings}
      accessibilityLabel={`Calories burned today: ${total} kcal. ${budgetLine}`}
      testID="burn-summary-card"
    >
      <View style={styles.row}>
        <ProgressRing
          progress={progress}
          size={104}
          strokeWidth={10}
          color={colors.calories}
          label={`${total}`}
          sublabel="kcal"
        />
        <View style={[styles.legend, { marginLeft: spacing.lg }]}>
          <Text style={[typography.label, { color: colors.textMuted }]}>Burned today</Text>
          <View style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: colors.calories }]} />
            <Text style={[typography.body, { color: colors.text }]}>{`Workouts  ${workouts} kcal`}</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: colors.textFaint }]} />
            <Text
              style={[typography.body, { color: colors.text }]}
            >{`Daily activity  ${daily} kcal`}</Text>
          </View>
          <Text
            style={[
              typography.caption,
              { color: addExerciseToTarget ? colors.success : colors.textMuted, marginTop: spacing.xs },
            ]}
            testID="burn-budget-line"
          >
            {budgetLine}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
  legend: { flex: 1, gap: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
});

export default BurnSummaryCard;
