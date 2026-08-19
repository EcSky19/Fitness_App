import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { Card, useTheme } from '@/ui';
import { GOAL_LABELS, GOAL_TYPES } from '@/types/constants';
import type { GoalType } from '@/types';

const GOAL_BLURBS: Record<GoalType, string> = {
  cut: 'Eat below maintenance so stored fat covers the gap.',
  maintain: 'Match what you burn and hold your current weight.',
  bulk: 'Eat above maintenance to add size and strength.',
};

const GOAL_ICONS: Record<GoalType, keyof typeof Ionicons.glyphMap> = {
  cut: 'trending-down',
  maintain: 'remove-outline',
  bulk: 'trending-up',
};

export interface GoalPickerProps {
  value: GoalType | null;
  onChange: (goalType: GoalType) => void;
  testID?: string;
}

/** Cut / Maintain / Bulk selection cards. Shared by onboarding and the goal editor. */
export function GoalPicker({ value, onChange, testID }: GoalPickerProps): React.JSX.Element {
  const { colors, spacing, radius, typography } = useTheme();

  const handlePress = useCallback(
    (goalType: GoalType) => {
      void Haptics.selectionAsync();
      onChange(goalType);
    },
    [onChange]
  );

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      {GOAL_TYPES.map((goalType) => {
        const selected = value === goalType;
        const accent = goalType === 'cut' ? colors.protein : goalType === 'bulk' ? colors.fat : colors.primary;
        return (
          <Card
            key={goalType}
            onPress={() => handlePress(goalType)}
            accessibilityLabel={`${GOAL_LABELS[goalType]}. ${GOAL_BLURBS[goalType]}`}
            testID={`goal-option-${goalType}`}
            style={[
              styles.card,
              {
                borderColor: selected ? accent : colors.border,
                borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={styles.row}>
              <View
                style={[
                  styles.icon,
                  { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, marginRight: spacing.md },
                ]}
              >
                <Ionicons name={GOAL_ICONS[goalType]} size={20} color={accent} />
              </View>
              <View style={styles.body}>
                <Text style={[typography.title, { color: colors.text }]}>{GOAL_LABELS[goalType]}</Text>
                <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
                  {GOAL_BLURBS[goalType]}
                </Text>
              </View>
              {selected ? <Ionicons name="checkmark-circle" size={22} color={accent} /> : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth },
  icon: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
