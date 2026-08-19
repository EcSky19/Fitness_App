import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { hexToRgba, radius, spacing, typography, useTheme } from '../theme';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Trailing text column, e.g. "320 kcal". */
  meta?: string;
  /** Trailing custom slot rendered after `meta`. */
  right?: React.ReactNode;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  /** Accent for the leading icon chip. Defaults to the primary colour. */
  leftColor?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Renders the title in the danger colour (delete/remove rows). */
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Standard tappable list line: icon, title/subtitle, meta, trailing slot. */
export function ListRow({
  title,
  subtitle,
  meta,
  right,
  leftIcon,
  leftColor,
  onPress,
  onLongPress,
  destructive = false,
  style,
  testID,
}: ListRowProps): React.JSX.Element {
  const { colors } = useTheme();
  const accent = leftColor ?? colors.primary;
  const titleColor = destructive ? colors.danger : colors.text;

  const body = (
    <>
      {leftIcon ? (
        <View style={[styles.iconWrap, { backgroundColor: hexToRgba(accent, 0.16) }]}>
          <Ionicons name={leftIcon} size={18} color={accent} />
        </View>
      ) : null}
      <View style={styles.textCol}>
        <Text numberOfLines={1} style={[typography.title, { color: titleColor }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta ? (
        <Text numberOfLines={1} style={[typography.label, styles.meta, { color: colors.textMuted }]}>
          {meta}
        </Text>
      ) : null}
      {right ? <View style={styles.right}>{right}</View> : null}
    </>
  );

  const base: StyleProp<ViewStyle> = [styles.row, style];
  const a11yLabel = [title, subtitle, meta].filter(Boolean).join(', ');

  if (!onPress && !onLongPress) {
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
      onLongPress={onLongPress}
      style={({ pressed }) => [
        base,
        pressed ? { backgroundColor: hexToRgba(colors.text, 0.06) } : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 36,
  },
  meta: {
    marginLeft: spacing.sm,
  },
  right: {
    alignItems: 'center',
    flexDirection: 'row',
    marginLeft: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  textCol: {
    flex: 1,
    justifyContent: 'center',
  },
});

export default ListRow;
