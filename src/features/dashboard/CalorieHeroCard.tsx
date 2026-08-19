import { StyleSheet, View } from 'react-native';

import { Card, ProgressRing, useTheme } from '@/ui';
import type { DailySummary } from '@/types';

import { DashText } from './dashboardText';
import { formatNumber, safePercent, safeRatio } from './useDashboardData';

interface CalorieHeroCardProps {
  summary: DailySummary;
  /** `settings.addExerciseToTarget` — when false exercise does not extend the budget. */
  addExerciseToTarget: boolean;
  hasTargets: boolean;
}

/**
 * Big calorie ring: remaining budget in the centre, eaten/burned on the flanks
 * and the goal equation underneath. Every ratio goes through `safeRatio`, so a
 * zero calorie target can never yield NaN or Infinity.
 */
export function CalorieHeroCard({
  summary,
  addExerciseToTarget,
  hasTargets,
}: CalorieHeroCardProps) {
  const { colors, spacing } = useTheme();

  const goalKcal = hasTargets ? summary.targets.calories : 0;
  const eatenKcal = summary.consumed.calories;
  const burnedKcal = summary.exerciseBurned;
  const remaining = summary.remainingCalories;
  const isOver = hasTargets && remaining < 0;

  const ratio = safeRatio(eatenKcal, goalKcal);
  const percent = safePercent(eatenKcal, goalKcal);
  const ringColor = isOver ? colors.danger : colors.calories;

  const heroValue = hasTargets ? Math.abs(remaining) : eatenKcal;
  const heroLabel = hasTargets ? (isOver ? 'kcal over' : 'kcal left') : 'kcal eaten';
  const heroColor = isOver ? colors.danger : colors.text;

  const equation = hasTargets
    ? addExerciseToTarget
      ? `${formatNumber(goalKcal)} goal - ${formatNumber(eatenKcal)} food + ${formatNumber(
          burnedKcal
        )} exercise = ${formatNumber(remaining)}`
      : `${formatNumber(goalKcal)} goal - ${formatNumber(eatenKcal)} food = ${formatNumber(
          remaining
        )}`
    : 'No calorie target set yet';

  return (
    <Card>
      <View style={styles.row}>
        <FlankColumn
          label="Eaten"
          value={formatNumber(eatenKcal)}
          color={colors.text}
          mutedColor={colors.textMuted}
          align="flex-start"
        />

        <ProgressRing
          progress={ratio}
          size={180}
          strokeWidth={14}
          color={ringColor}
          trackColor={colors.surfaceAlt}
        >
          <View
            style={styles.center}
            accessible
            accessibilityLabel={
              hasTargets
                ? `${formatNumber(Math.abs(remaining))} calories ${isOver ? 'over' : 'left'}, ${formatNumber(
                    eatenKcal
                  )} of ${formatNumber(goalKcal)} eaten`
                : `${formatNumber(eatenKcal)} calories eaten, no target set`
            }
          >
            <DashText variant="hero" color={heroColor}>
              {formatNumber(heroValue)}
            </DashText>
            <DashText variant="caption" color={isOver ? colors.danger : colors.textMuted}>
              {heroLabel}
            </DashText>
            {hasTargets ? (
              <DashText
                variant="micro"
                color={colors.textFaint}
                style={{ marginTop: spacing.xs }}
              >
                {`${percent}% of goal`}
              </DashText>
            ) : null}
          </View>
        </ProgressRing>

        <FlankColumn
          label="Burned"
          value={formatNumber(burnedKcal)}
          color={colors.text}
          mutedColor={colors.textMuted}
          align="flex-end"
        />
      </View>

      <DashText
        variant="caption"
        color={colors.textMuted}
        style={{ marginTop: spacing.md, textAlign: 'center' }}
      >
        {equation}
      </DashText>

      {hasTargets && !addExerciseToTarget ? (
        <DashText
          variant="micro"
          color={colors.textFaint}
          style={{ marginTop: spacing.xs, textAlign: 'center' }}
        >
          Exercise is not added to your budget
        </DashText>
      ) : null}
    </Card>
  );
}

interface FlankColumnProps {
  label: string;
  value: string;
  color: string;
  mutedColor: string;
  align: 'flex-start' | 'flex-end';
}

function FlankColumn({ label, value, color, mutedColor, align }: FlankColumnProps) {
  return (
    <View style={[styles.flank, { alignItems: align }]}>
      <DashText variant="micro" color={mutedColor}>
        {label.toUpperCase()}
      </DashText>
      <DashText variant="value" color={color} accessibilityLabel={`${label} ${value} kcal`}>
        {value}
      </DashText>
      <DashText variant="micro" color={mutedColor}>
        kcal
      </DashText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flank: { flex: 1, gap: 2 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
