import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { hexToRgba, radius, spacing, typography, useTheme } from '../theme';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Small pill used for statuses, counts and confidence flags. */
export function Badge({ label, tone = 'neutral', style, testID }: BadgeProps): React.JSX.Element {
  const { colors } = useTheme();

  const toneColor =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : tone === 'primary'
            ? colors.primary
            : colors.textMuted;

  const background = tone === 'neutral' ? colors.surfaceAlt : hexToRgba(toneColor, 0.16);
  const borderColor = tone === 'neutral' ? colors.border : hexToRgba(toneColor, 0.35);
  const textColor = tone === 'neutral' ? colors.textMuted : toneColor;

  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: background, borderColor }, style]}
    >
      <Text numberOfLines={1} style={[typography.caption, styles.text, { color: textColor }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  text: {
    fontWeight: '700',
  },
});

export default Badge;
