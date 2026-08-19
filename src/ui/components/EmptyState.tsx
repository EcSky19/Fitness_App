import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { hexToRgba, spacing, typography, useTheme } from '../theme';
import { Button } from './Button';

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Friendly placeholder for empty lists and unfilled sections. */
export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  style,
  testID,
}: EmptyStateProps): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View testID={testID} style={[styles.wrap, style]}>
      <View style={[styles.iconWrap, { backgroundColor: hexToRgba(colors.primary, 0.12) }]}>
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text
        accessibilityRole="header"
        style={[typography.h3, styles.title, { color: colors.text }]}
      >
        {title}
      </Text>
      {message ? (
        <Text style={[typography.body, styles.message, { color: colors.textMuted }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant="secondary" size="sm" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: 'center',
    borderRadius: 999,
    height: 60,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 60,
  },
  message: {
    marginBottom: spacing.lg,
    maxWidth: 300,
    textAlign: 'center',
  },
  title: {
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
});

export default EmptyState;
