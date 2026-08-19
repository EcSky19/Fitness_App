import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, typography, useTheme } from '../theme';

export interface MacroBarProps {
  /** Grams. */
  protein: number;
  /** Grams. */
  carbs: number;
  /** Grams. */
  fat: number;
  height?: number;
  /** Shows P / C / F gram legends underneath. Default true. */
  showLabels?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

function safeGrams(n: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function formatGrams(n: number): string {
  const value = safeGrams(n);
  return `${Math.round(value)}g`;
}

/** Stacked bar showing the calorie split between protein, carbs and fat. */
export function MacroBar({
  protein,
  carbs,
  fat,
  height = 10,
  showLabels = true,
  style,
  testID,
}: MacroBarProps): React.JSX.Element {
  const { colors } = useTheme();

  const p = safeGrams(protein);
  const c = safeGrams(carbs);
  const f = safeGrams(fat);

  const pKcal = p * KCAL_PER_G.protein;
  const cKcal = c * KCAL_PER_G.carbs;
  const fKcal = f * KCAL_PER_G.fat;
  const total = pKcal + cKcal + fKcal;

  const barHeight = Math.max(2, typeof height === 'number' && Number.isFinite(height) ? height : 10);

  const segments =
    total > 0
      ? [
          { key: 'protein', flex: pKcal / total, color: colors.protein },
          { key: 'carbs', flex: cKcal / total, color: colors.carbs },
          { key: 'fat', flex: fKcal / total, color: colors.fat },
        ].filter((s) => s.flex > 0)
      : [];

  const legend = [
    { key: 'protein', short: 'P', grams: p, color: colors.protein },
    { key: 'carbs', short: 'C', grams: c, color: colors.carbs },
    { key: 'fat', short: 'F', grams: f, color: colors.fat },
  ];

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`Protein ${formatGrams(p)}, carbs ${formatGrams(c)}, fat ${formatGrams(f)}`}
      style={style}
    >
      <View
        style={[
          styles.track,
          { backgroundColor: colors.surfaceAlt, height: barHeight, borderRadius: barHeight / 2 },
        ]}
      >
        {segments.map((segment) => (
          <View key={segment.key} style={{ flex: segment.flex, backgroundColor: segment.color }} />
        ))}
      </View>

      {showLabels ? (
        <View style={styles.legend}>
          {legend.map((item) => (
            <View key={item.key} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: item.color }]} />
              <Text style={[typography.caption, { color: colors.textMuted }]}>
                {`${item.short} ${formatGrams(item.grams)}`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: radius.pill,
    height: 7,
    marginRight: spacing.xs,
    width: 7,
  },
  legend: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: spacing.lg,
  },
  track: {
    flexDirection: 'row',
    overflow: 'hidden',
    width: '100%',
  },
});

export default MacroBar;
