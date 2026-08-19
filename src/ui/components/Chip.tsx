import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { hexToRgba, radius, spacing, typography, useTheme } from '../theme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Compact selectable pill used for filters and quick choices. */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  style,
  testID,
}: ChipProps): React.JSX.Element {
  const { colors } = useTheme();

  const background = selected ? hexToRgba(colors.primary, 0.18) : colors.surfaceAlt;
  const borderColor = selected ? colors.primary : colors.border;
  const foreground = selected ? colors.primary : colors.textMuted;

  const content = (
    <>
      {icon ? <Ionicons name={icon} size={14} color={foreground} style={styles.icon} /> : null}
      <Text numberOfLines={1} style={[typography.label, { color: foreground }]}>
        {label}
      </Text>
    </>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        accessibilityRole="text"
        accessibilityLabel={label}
        style={[styles.chip, { backgroundColor: background, borderColor }, style]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: background, borderColor },
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  icon: {
    marginRight: spacing.xs,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.97 }],
  },
});

export default Chip;
