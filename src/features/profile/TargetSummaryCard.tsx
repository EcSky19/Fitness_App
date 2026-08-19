import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Card, MacroBar, useTheme } from '@/ui';
import { formatEnergy, roundTo } from '@/domain';
import type { MacroTargets } from '@/types';

export interface TargetSummaryCardProps {
  targets: MacroTargets;
  /** Previous targets; renders a before -> after comparison when supplied. */
  compareTo?: MacroTargets | null;
  title?: string;
  subtitle?: string;
  energyUnit?: 'kcal' | 'kJ';
  isManualOverride?: boolean;
  /** Safety-floor or mismatch warning shown under the macros. */
  warning?: string | null;
  footer?: React.ReactNode;
  testID?: string;
}

interface MacroCellProps {
  label: string;
  grams: number;
  color: string;
  previous?: number | null;
  testID: string;
}

function formatDelta(next: number, prev: number, suffix: string): string | null {
  const diff = roundTo(next - prev, 0);
  if (diff === 0) return null;
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)}${suffix}`;
}

function MacroCell({ label, grams, color, previous, testID }: MacroCellProps): React.JSX.Element {
  const { colors, typography } = useTheme();
  const delta =
    previous === null || previous === undefined ? null : formatDelta(grams, previous, ' g');
  return (
    <View style={styles.cell} testID={testID}>
      <View style={styles.cellHead}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      </View>
      <Text style={[typography.title, { color: colors.text }]} testID={`${testID}-grams`}>
        {Math.round(grams)} g
      </Text>
      {delta ? (
        <Text style={[typography.caption, { color: colors.textFaint }]} testID={`${testID}-delta`}>
          {delta}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The daily target: calories large, macro grams underneath, macro bar for the
 * split. Used on the profile hub, the onboarding plan step and the goal editor.
 */
export function TargetSummaryCard({
  targets,
  compareTo = null,
  title = 'Daily target',
  subtitle,
  energyUnit = 'kcal',
  isManualOverride = false,
  warning = null,
  footer,
  testID = 'target-summary',
}: TargetSummaryCardProps): React.JSX.Element {
  const { colors, spacing, radius, typography } = useTheme();
  const caloriesDelta = compareTo ? formatDelta(targets.calories, compareTo.calories, '') : null;

  return (
    <Card testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[typography.label, { color: colors.textMuted }]}>{title}</Text>
          {subtitle ? (
            <Text style={[typography.caption, { color: colors.textFaint, marginTop: 2 }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {isManualOverride ? <Badge label="Custom" tone="warning" /> : null}
      </View>

      <View style={[styles.caloriesRow, { marginTop: spacing.sm }]}>
        <Text style={[typography.h1, { color: colors.calories }]} testID="target-calories">
          {formatEnergy(targets.calories, energyUnit)}
        </Text>
        {caloriesDelta ? (
          <Text
            style={[typography.label, { color: colors.textMuted, marginLeft: spacing.sm }]}
            testID="target-calories-delta"
          >
            {caloriesDelta}
          </Text>
        ) : null}
      </View>

      {compareTo ? (
        <Text
          style={[typography.caption, { color: colors.textFaint, marginTop: 2 }]}
          testID="target-calories-before"
        >
          {`was ${formatEnergy(compareTo.calories, energyUnit)}`}
        </Text>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <MacroBar
          protein={targets.protein}
          carbs={targets.carbs}
          fat={targets.fat}
          height={10}
          testID="target-macro-bar"
        />
      </View>

      <View style={[styles.macros, { marginTop: spacing.md }]}>
        <MacroCell
          label="Protein"
          grams={targets.protein}
          color={colors.protein}
          previous={compareTo?.protein ?? null}
          testID="target-protein"
        />
        <MacroCell
          label="Carbs"
          grams={targets.carbs}
          color={colors.carbs}
          previous={compareTo?.carbs ?? null}
          testID="target-carbs"
        />
        <MacroCell
          label="Fat"
          grams={targets.fat}
          color={colors.fat}
          previous={compareTo?.fat ?? null}
          testID="target-fat"
        />
      </View>

      {warning ? (
        <View
          style={[
            styles.warning,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.warning,
              borderRadius: radius.md,
              marginTop: spacing.md,
              padding: spacing.md,
            },
          ]}
          testID="target-warning"
        >
          <Text style={[typography.caption, { color: colors.warning }]}>{warning}</Text>
        </View>
      ) : null}

      {footer ? <View style={{ marginTop: spacing.md }}>{footer}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  caloriesRow: { alignItems: 'flex-end', flexDirection: 'row' },
  cell: { flex: 1 },
  cellHead: { alignItems: 'center', flexDirection: 'row', marginBottom: 2 },
  dot: { borderRadius: 4, height: 7, marginRight: 5, width: 7 },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  headerText: { flex: 1 },
  macros: { flexDirection: 'row' },
  warning: { borderWidth: StyleSheet.hairlineWidth },
});
