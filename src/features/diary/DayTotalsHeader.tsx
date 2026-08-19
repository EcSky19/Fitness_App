import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { clamp, formatEnergy, formatMacroG, roundTo } from '@/domain';
import { Card, MacroBar, ProgressRing, useTheme } from '@/ui';
import type { DailySummary } from '@/types';

export interface DayTotalsHeaderProps {
  summary: DailySummary;
  testID?: string;
}

interface MacroLegendProps {
  label: string;
  value: number;
  target: number;
  color: string;
}

function MacroLegend({ label, value, target, color }: MacroLegendProps): React.JSX.Element {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {label} {formatMacroG(value)}
        {target > 0 ? ` / ${roundTo(target, 0)} g` : ''}
      </Text>
    </View>
  );
}

/** Compact "how is the day going" block above the meal list. */
export function DayTotalsHeader({ summary, testID }: DayTotalsHeaderProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const { consumed, targets, remainingCalories, exerciseBurned } = summary;

  const progress = targets.calories > 0 ? clamp(consumed.calories / targets.calories, 0, 1) : 0;
  const over = remainingCalories < 0;

  return (
    <Card testID={testID ?? 'day-totals'} style={styles.card}>
      <View style={styles.row}>
        <ProgressRing
          progress={progress}
          size={104}
          strokeWidth={10}
          color={over ? colors.warning : colors.calories}
          label={`${roundTo(Math.abs(remainingCalories), 0)}`}
          sublabel={over ? 'over' : 'left'}
        />

        <View style={[styles.stats, { marginLeft: spacing.lg }]}>
          <View style={styles.statLine}>
            <Text style={[typography.caption, { color: colors.textMuted }]}>Eaten</Text>
            <Text testID="day-consumed" style={[typography.title, { color: colors.text }]}>
              {formatEnergy(consumed.calories)}
            </Text>
          </View>
          <View style={styles.statLine}>
            <Text style={[typography.caption, { color: colors.textMuted }]}>Target</Text>
            <Text testID="day-target" style={[typography.title, { color: colors.text }]}>
              {formatEnergy(targets.calories)}
            </Text>
          </View>
          <View style={styles.statLine}>
            <Text style={[typography.caption, { color: colors.textMuted }]}>Burned</Text>
            <Text testID="day-burned" style={[typography.title, { color: colors.text }]}>
              {formatEnergy(exerciseBurned)}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.bar, { marginTop: spacing.lg }]}>
        <MacroBar protein={consumed.protein} carbs={consumed.carbs} fat={consumed.fat} height={10} />
      </View>

      <View style={[styles.legend, { marginTop: spacing.sm }]}>
        <MacroLegend
          label="Protein"
          value={consumed.protein}
          target={targets.protein}
          color={colors.protein}
        />
        <MacroLegend label="Carbs" value={consumed.carbs} target={targets.carbs} color={colors.carbs} />
        <MacroLegend label="Fat" value={consumed.fat} target={targets.fat} color={colors.fat} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: '100%',
  },
  card: {
    marginTop: 12,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    marginRight: 6,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: 8,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  statLine: {
    marginBottom: 6,
  },
  stats: {
    flex: 1,
  },
});

export default DayTotalsHeader;
