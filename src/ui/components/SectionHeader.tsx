import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { spacing, typography, useTheme } from '../theme';

export interface SectionHeaderProps {
  title: string;
  /** Trailing slot, typically a link/Button or a value summary. */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Uppercase group label with an optional trailing action. */
export function SectionHeader({ title, right, style }: SectionHeaderProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[typography.label, styles.title, { color: colors.textMuted }]}
      >
        {title.toUpperCase()}
      </Text>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  right: {
    alignItems: 'flex-end',
    flexShrink: 0,
    marginLeft: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  title: {
    flexShrink: 1,
    letterSpacing: 1,
  },
});

export default SectionHeader;
