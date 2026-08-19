import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { hexToRgba, radius, spacing, typography, useTheme } from '../theme';

export interface StatTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Accent used for the icon chip and the value text. Defaults to `colors.text`. */
  color?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Compact metric tile: label on top, big value, optional sublabel. */
export function StatTile({
  label,
  value,
  sublabel,
  icon,
  color,
  onPress,
  style,
  testID,
}: StatTileProps): React.JSX.Element {
  const { colors } = useTheme();
  const accent = color ?? colors.text;

  const body = (
    <>
      <View style={styles.header}>
        {icon ? (
          <View style={[styles.iconWrap, { backgroundColor: hexToRgba(accent, 0.16) }]}>
            <Ionicons name={icon} size={14} color={accent} />
          </View>
        ) : null}
        <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
          {label}
        </Text>
      </View>
      <Text numberOfLines={1} style={[typography.h3, styles.value, { color: accent }]}>
        {value}
      </Text>
      {sublabel ? (
        <Text numberOfLines={1} style={[typography.caption, { color: colors.textFaint }]}>
          {sublabel}
        </Text>
      ) : null}
    </>
  );

  const base: StyleProp<ViewStyle> = [
    styles.tile,
    { backgroundColor: colors.surface, borderColor: colors.border },
    style,
  ];

  const a11yLabel = `${label}, ${value}${sublabel ? `, ${sublabel}` : ''}`;

  if (!onPress) {
    return (
      <View testID={testID} accessibilityLabel={a11yLabel} style={base}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      style={({ pressed }) => [base, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 22,
    justifyContent: 'center',
    marginRight: spacing.xs,
    width: 22,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  tile: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexGrow: 1,
    minWidth: 96,
    padding: spacing.md,
  },
  value: {
    marginBottom: 2,
  },
});

export default StatTile;
