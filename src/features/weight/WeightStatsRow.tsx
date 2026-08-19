/**
 * Stat tiles: short/medium-term change, weekly rate, goal projection and BMI.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDateShort } from '@/domain';
import { StatTile, useTheme } from '@/ui';
import type { WeightUnit } from '@/types';

import { deltaTone, toneColor, type WeightStats } from './useWeightHistory';
import { EM_DASH, formatDelta, formatRate } from './weightFormat';

export interface WeightStatsRowProps {
  stats: WeightStats;
  unit: WeightUnit;
  /** Human label of the window the weekly rate is measured over. */
  rangeLabel: string;
}

const BMI_LABELS: Record<string, string> = {
  underweight: 'Underweight',
  normal: 'Healthy range',
  overweight: 'Overweight',
  obese: 'Obese',
};

export function WeightStatsRow({ stats, unit, rangeLabel }: WeightStatsRowProps): React.JSX.Element {
  const { colors } = useTheme();

  const {
    change7dKg,
    change30dKg,
    ratePerWeekKg,
    projectedGoalDate,
    goalKg,
    currentKg,
    bmi,
    bmiCategory,
  } = stats;

  const tone7 = toneColor(deltaTone(change7dKg, goalKg, currentKg), colors);
  const tone30 = toneColor(deltaTone(change30dKg, goalKg, currentKg), colors);
  const toneRate = toneColor(deltaTone(ratePerWeekKg, goalKg, currentKg), colors);

  const projectionSublabel =
    goalKg == null
      ? 'Set a goal weight first'
      : projectedGoalDate == null
        ? "Current trend won't reach it"
        : 'At the current rate';

  return (
    <View style={styles.row} testID="weight-stats-row">
      <StatTile
        label="7-day change"
        value={formatDelta(change7dKg, unit)}
        sublabel={change7dKg == null ? 'Not enough data' : 'Last 7 days'}
        icon="calendar-outline"
        color={tone7}
      />
      <StatTile
        label="30-day change"
        value={formatDelta(change30dKg, unit)}
        sublabel={change30dKg == null ? 'Not enough data' : 'Last 30 days'}
        icon="calendar-number-outline"
        color={tone30}
      />
      <StatTile
        label="Weekly rate"
        value={formatRate(ratePerWeekKg, unit)}
        sublabel={ratePerWeekKg == null ? 'Not enough data' : `Over the ${rangeLabel}`}
        icon="speedometer-outline"
        color={toneRate}
      />
      <StatTile
        label="Goal date"
        value={projectedGoalDate == null ? EM_DASH : formatDateShort(projectedGoalDate)}
        sublabel={projectionSublabel}
        icon="flag-outline"
        color={projectedGoalDate == null ? colors.textMuted : colors.primary}
      />
      {bmi != null ? (
        <StatTile
          label="BMI"
          value={bmi.toFixed(1)}
          sublabel={bmiCategory ? (BMI_LABELS[bmiCategory] ?? bmiCategory) : undefined}
          icon="body-outline"
          color={colors.text}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
});

export default WeightStatsRow;
