import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { Card, useTheme } from '@/ui';
import { ACTIVITY_LABELS, ACTIVITY_LEVELS, ACTIVITY_MULTIPLIERS } from '@/types/constants';
import type { ActivityLevel } from '@/types';

/** Plain-language expansion of each `ACTIVITY_LABELS` entry. */
export const ACTIVITY_BLURBS: Record<ActivityLevel, string> = {
  sedentary: 'Desk job, little or no exercise.',
  light: 'Light exercise or sport 1-3 days a week.',
  moderate: 'Moderate exercise or sport 3-5 days a week.',
  active: 'Hard exercise 6-7 days a week.',
  very_active: 'Physical job, or training twice a day.',
};

/** Short label without the parenthetical, e.g. "Sedentary". */
export function activityShortLabel(level: ActivityLevel): string {
  return ACTIVITY_LABELS[level].replace(/\s*\(.*\)\s*$/, '');
}

export interface ActivityLevelPickerProps {
  value: ActivityLevel | null;
  onChange: (level: ActivityLevel) => void;
  testID?: string;
}

/** Five selectable activity cards, each showing its TDEE multiplier. */
export function ActivityLevelPicker({
  value,
  onChange,
  testID,
}: ActivityLevelPickerProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  const handlePress = useCallback(
    (level: ActivityLevel) => {
      void Haptics.selectionAsync();
      onChange(level);
    },
    [onChange]
  );

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      {ACTIVITY_LEVELS.map((level) => {
        const selected = value === level;
        return (
          <Card
            key={level}
            onPress={() => handlePress(level)}
            accessibilityLabel={`${activityShortLabel(level)}. ${ACTIVITY_BLURBS[level]}`}
            testID={`activity-option-${level}`}
            style={{
              borderColor: selected ? colors.primary : colors.border,
              borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
            }}
          >
            <View style={styles.row}>
              <View style={styles.body}>
                <Text style={[typography.title, { color: colors.text }]}>
                  {activityShortLabel(level)}
                </Text>
                <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
                  {ACTIVITY_BLURBS[level]}
                </Text>
              </View>
              <Text
                style={[
                  typography.mono,
                  { color: selected ? colors.primary : colors.textFaint, marginLeft: spacing.sm },
                ]}
              >
                ×{ACTIVITY_MULTIPLIERS[level].toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}
              </Text>
              {selected ? (
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.primary}
                  style={{ marginLeft: spacing.sm }}
                />
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
