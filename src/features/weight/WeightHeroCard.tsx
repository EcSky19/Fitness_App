/**
 * Hero card: current weight, movement since the last weigh-in / over the
 * selected range, and progress toward the goal.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatDateLabel } from '@/domain';
import { Button, Card, Divider, ProgressRing, useTheme } from '@/ui';
import type { WeightUnit } from '@/types';

import { deltaTone, toneColor, type WeightStats } from './useWeightHistory';
import { deltaArrow, EM_DASH, formatDelta, formatKg } from './weightFormat';

export interface WeightHeroCardProps {
  stats: WeightStats;
  unit: WeightUnit;
  /** Human label of the selected chart range, e.g. "last 30 days". */
  rangeLabel: string;
  onLogPress?: () => void;
  onSetGoalPress?: () => void;
}

export function WeightHeroCard({
  stats,
  unit,
  rangeLabel,
  onLogPress,
  onSetGoalPress,
}: WeightHeroCardProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  const {
    currentKg,
    goalKg,
    startKg,
    changeSinceLastKg,
    rangeChangeKg,
    previous,
    progressPct,
    remainingKg,
  } = stats;

  const changeTone = deltaTone(changeSinceLastKg, goalKg, currentKg);
  const rangeTone = deltaTone(rangeChangeKg, goalKg, currentKg);
  const changeColor = toneColor(changeTone, colors);
  const rangeColor = toneColor(rangeTone, colors);

  const sinceLabel = previous ? `since ${formatDateLabel(previous.date)}` : 'no earlier weigh-in';
  const changeText =
    changeSinceLastKg == null
      ? `${EM_DASH} ${sinceLabel}`
      : `${deltaArrow(changeSinceLastKg)} ${formatDelta(changeSinceLastKg, unit)} ${sinceLabel}`;

  const rangeText =
    rangeChangeKg == null
      ? `${EM_DASH} over the ${rangeLabel}`
      : `${formatDelta(rangeChangeKg, unit)} over the ${rangeLabel}`;

  const pct = progressPct == null ? null : Math.round(progressPct);
  const remainingText =
    remainingKg == null
      ? null
      : Math.abs(remainingKg) < 0.05
        ? 'Goal reached'
        : `${formatKg(Math.abs(remainingKg), unit)} to ${remainingKg < 0 ? 'lose' : 'gain'}`;

  return (
    <Card>
      <View style={styles.topRow}>
        <View style={styles.currentCol}>
          <Text style={[typography.caption, { color: colors.textMuted }]}>Current weight</Text>
          <Text
            testID="weight-hero-current"
            accessibilityLabel={`Current weight ${formatKg(currentKg, unit)}`}
            style={[typography.h1, { color: colors.text, marginVertical: spacing.xs }]}
          >
            {formatKg(currentKg, unit)}
          </Text>
          <Text
            testID="weight-hero-change"
            accessibilityLabel={`Change ${changeText}`}
            style={[typography.label, { color: changeColor }]}
          >
            {changeText}
          </Text>
          <Text
            testID="weight-hero-range-change"
            style={[typography.caption, { color: rangeColor, marginTop: 2 }]}
          >
            {rangeText}
          </Text>
        </View>

        {pct != null ? (
          <ProgressRing
            progress={pct / 100}
            size={92}
            label={`${pct}%`}
            sublabel="to goal"
            color={colors.primary}
          />
        ) : null}
      </View>

      <Divider />

      <View style={styles.goalRow}>
        <View style={styles.goalCol}>
          <Text style={[typography.caption, { color: colors.textMuted }]}>Start</Text>
          <Text style={[typography.title, { color: colors.text }]}>{formatKg(startKg, unit)}</Text>
        </View>
        <View style={styles.goalCol}>
          <Text style={[typography.caption, { color: colors.textMuted }]}>Goal</Text>
          <Text testID="weight-hero-goal" style={[typography.title, { color: colors.text }]}>
            {goalKg == null ? EM_DASH : formatKg(goalKg, unit)}
          </Text>
        </View>
        <View style={styles.goalCol}>
          <Text style={[typography.caption, { color: colors.textMuted }]}>Remaining</Text>
          <Text
            testID="weight-hero-remaining"
            style={[typography.title, { color: goalKg == null ? colors.textMuted : colors.text }]}
          >
            {remainingText ?? EM_DASH}
          </Text>
        </View>
      </View>

      {goalKg == null && onSetGoalPress ? (
        <Button
          title="Set a goal weight"
          variant="ghost"
          size="sm"
          icon="flag-outline"
          onPress={onSetGoalPress}
          fullWidth
        />
      ) : null}

      {onLogPress ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title="Log weight" icon="add" size="md" onPress={onLogPress} fullWidth />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  currentCol: {
    flex: 1,
  },
  goalCol: {
    flex: 1,
  },
  goalRow: {
    flexDirection: 'row',
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

export default WeightHeroCard;
