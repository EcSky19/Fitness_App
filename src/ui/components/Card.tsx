import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, useTheme } from '../theme';

export interface CardProps {
  /** Adds the standard 16px inner padding. Default true. */
  padded?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  children?: React.ReactNode;
}

/** Elevated surface block. Becomes pressable when `onPress` is supplied. */
export function Card({
  padded = true,
  onPress,
  onLongPress,
  style,
  accessibilityLabel,
  testID,
  children,
}: CardProps): React.JSX.Element {
  const { colors } = useTheme();

  const base: StyleProp<ViewStyle> = [
    styles.card,
    { backgroundColor: colors.surface, borderColor: colors.border },
    padded ? styles.padded : null,
    style,
  ];

  if (!onPress && !onLongPress) {
    return (
      <View
        testID={testID}
        accessible={accessibilityLabel ? true : undefined}
        accessibilityLabel={accessibilityLabel}
        style={base}
      >
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [base, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.99 }],
  },
});

export default Card;
