import { StyleSheet, View } from 'react-native';

import { Card, MacroBar, SectionHeader, useTheme } from '@/ui';
import type { Macros, MacroTargets } from '@/types';

import { DashText } from './dashboardText';
import { formatGrams, safePercent, safeRatio } from './useDashboardData';

interface MacroSummaryCardProps {
  consumed: Macros;
  targets: MacroTargets;
  hasTargets: boolean;
}

type MacroKey = 'protein' | 'carbs' | 'fat';

const MACRO_ROWS: { key: MacroKey; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
];

export function MacroSummaryCard({ consumed, targets, hasTargets }: MacroSummaryCardProps) {
  const { colors, spacing } = useTheme();
  const macroColors: Record<MacroKey, string> = {
    protein: colors.protein,
    carbs: colors.carbs,
    fat: colors.fat,
  };

  return (
    <Card>
      <SectionHeader title="Macros" />

      <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
        {MACRO_ROWS.map(({ key, label }) => {
          const value = consumed[key] ?? 0;
          const target = hasTargets ? (targets[key] ?? 0) : 0;
          const over = target > 0 ? Math.max(value - target, 0) : 0;
          const percent = safePercent(value, target);
          const fill = Math.min(safeRatio(value, target), 1);
          const color = macroColors[key];

          return (
            <View key={key} accessible accessibilityLabel={`${label} ${formatGrams(value)} of ${formatGrams(target)} grams`}>
              <View style={styles.labelRow}>
                <View style={styles.labelLeft}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <DashText variant="body" color={colors.text}>
                    {label}
                  </DashText>
                </View>
                <View style={styles.labelRight}>
                  <DashText variant="body" color={colors.textMuted}>
                    {target > 0
                      ? `${formatGrams(value)} / ${formatGrams(target)} g`
                      : `${formatGrams(value)} g`}
                  </DashText>
                  {target > 0 ? (
                    <DashText variant="caption" color={colors.textFaint} style={styles.percent}>
                      {`${percent}%`}
                    </DashText>
                  ) : null}
                </View>
              </View>

              <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
                <View
                  style={{ flex: fill, backgroundColor: over > 0 ? colors.warning : color }}
                />
                <View style={{ flex: Math.max(1 - fill, 0) }} />
              </View>

              {over > 0 ? (
                <DashText variant="micro" color={colors.warning} style={{ marginTop: spacing.xs }}>
                  {`+${formatGrams(over)}g over`}
                </DashText>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <DashText variant="micro" color={colors.textFaint} style={{ marginBottom: spacing.xs }}>
          CALORIE SPLIT
        </DashText>
        <MacroBar
          protein={consumed.protein ?? 0}
          carbs={consumed.carbs ?? 0}
          fat={consumed.fat ?? 0}
          height={10}
          showLabels
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelRight: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  percent: { minWidth: 36, textAlign: 'right' },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 6,
    flexDirection: 'row',
  },
});
