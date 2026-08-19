import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { Card, Divider, useTheme } from '@/ui';
import { formatEnergy } from '@/domain';
import type { ActivityLevel, MacroTargets } from '@/types';

import { activityShortLabel } from './ActivityLevelPicker';
import type { PlanBreakdown } from './useGoalEditor';

export interface PlanBreakdownCardProps {
  plan: PlanBreakdown;
  activityLevel: ActivityLevel;
  /** Final targets after any manual override, so the last row is the truth. */
  targets?: MacroTargets | null;
  collapsible?: boolean;
  defaultOpen?: boolean;
  title?: string;
  energyUnit?: 'kcal' | 'kJ';
  testID?: string;
}

/**
 * Plain-English sentence such as
 * `TDEE 2,450 kcal − 550 kcal deficit = 1,900 kcal/day`.
 */
export function planSentence(
  plan: PlanBreakdown,
  finalCalories: number,
  energyUnit: 'kcal' | 'kJ' = 'kcal'
): string {
  const tdee = formatEnergy(plan.tdee, energyUnit);
  const target = formatEnergy(finalCalories, energyUnit);
  const diff = finalCalories - plan.tdee;
  if (Math.round(diff) === 0) return `TDEE ${tdee} = ${target}/day`;
  const sign = diff < 0 ? '−' : '+';
  const word = diff < 0 ? 'deficit' : 'surplus';
  return `TDEE ${tdee} ${sign} ${formatEnergy(Math.abs(diff), energyUnit)} ${word} = ${target}/day`;
}

interface BreakdownRowProps {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  testID?: string;
}

function BreakdownRow({ label, value, hint, emphasis, testID }: BreakdownRowProps): React.JSX.Element {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={[styles.row, { paddingVertical: spacing.sm }]} testID={testID}>
      <View style={styles.rowLabel}>
        <Text style={[emphasis ? typography.title : typography.body, { color: colors.text }]}>
          {label}
        </Text>
        {hint ? (
          <Text style={[typography.caption, { color: colors.textFaint }]}>{hint}</Text>
        ) : null}
      </View>
      <Text
        style={[typography.mono, { color: emphasis ? colors.primary : colors.textMuted }]}
        testID={testID ? `${testID}-value` : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

/** Shows exactly where the calorie target came from. */
export function PlanBreakdownCard({
  plan,
  activityLevel,
  targets = null,
  collapsible = true,
  defaultOpen = false,
  title = 'How your target is calculated',
  energyUnit = 'kcal',
  testID = 'plan-breakdown',
}: PlanBreakdownCardProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [open, setOpen] = useState(!collapsible || defaultOpen);

  const toggle = useCallback(() => {
    void Haptics.selectionAsync();
    setOpen((prev) => !prev);
  }, []);

  const finalCalories = targets?.calories ?? plan.calories;
  const overridden = targets ? Math.round(targets.calories) !== Math.round(plan.calories) : false;

  return (
    <Card testID={testID}>
      <Pressable
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityLabel={collapsible ? `${title}. ${open ? 'Collapse' : 'Expand'}` : undefined}
        accessibilityState={collapsible ? { expanded: open } : undefined}
        onPress={collapsible ? toggle : undefined}
        disabled={!collapsible}
        testID="plan-breakdown-toggle"
        style={styles.header}
      >
        <Text style={[typography.title, { color: colors.text, flex: 1 }]}>{title}</Text>
        {collapsible ? (
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        ) : null}
      </Pressable>

      <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]} testID="plan-sentence">
        {planSentence(plan, finalCalories, energyUnit)}
      </Text>

      {open ? (
        <View style={{ marginTop: spacing.sm }} testID="plan-breakdown-body">
          <Divider />
          <BreakdownRow
            label="BMR"
            hint="Energy burned at complete rest"
            value={formatEnergy(plan.bmr, energyUnit)}
            testID="plan-bmr"
          />
          <BreakdownRow
            label="Activity multiplier"
            hint={activityShortLabel(activityLevel)}
            value={`×${plan.activityMultiplier}`}
            testID="plan-multiplier"
          />
          <Divider />
          <BreakdownRow
            label="TDEE (maintenance)"
            hint="BMR × activity multiplier"
            value={formatEnergy(plan.tdee, energyUnit)}
            testID="plan-tdee"
          />
          <BreakdownRow
            label={plan.delta < 0 ? 'Daily deficit' : plan.delta > 0 ? 'Daily surplus' : 'Adjustment'}
            hint="From your weekly pace"
            value={`${plan.delta > 0 ? '+' : plan.delta < 0 ? '−' : ''}${formatEnergy(
              Math.abs(plan.delta),
              energyUnit
            )}`}
            testID="plan-delta"
          />
          <Divider />
          <BreakdownRow
            label="Daily target"
            hint={overridden ? 'Manually overridden' : undefined}
            value={formatEnergy(finalCalories, energyUnit)}
            emphasis
            testID="plan-target"
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', flexDirection: 'row' },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { flex: 1, paddingRight: 8 },
});
