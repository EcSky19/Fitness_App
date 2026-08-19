import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { radius, spacing, typography, useTheme } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

const SIZES: Record<ButtonSize, { height: number; padH: number; font: number; icon: number }> = {
  sm: { height: 34, padH: spacing.md, font: 13, icon: 15 },
  md: { height: 46, padH: spacing.lg, font: 15, icon: 18 },
  lg: { height: 54, padH: spacing.xl, font: 17, icon: 20 },
};

/** Primary call-to-action control. `loading` shows a spinner and blocks presses. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}: ButtonProps): React.JSX.Element {
  const { colors } = useTheme();
  const dims = SIZES[size];
  const isBlocked = disabled || loading;

  let background = colors.primary;
  let foreground = colors.onPrimary;
  let borderColor = 'transparent';

  if (variant === 'secondary') {
    background = colors.surfaceAlt;
    foreground = colors.text;
    borderColor = colors.border;
  } else if (variant === 'ghost') {
    background = 'transparent';
    foreground = colors.primary;
    borderColor = 'transparent';
  } else if (variant === 'danger') {
    background = colors.danger;
    foreground = '#FFFFFF';
  }

  const handlePress = (): void => {
    if (isBlocked) return;
    onPress();
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isBlocked, busy: loading }}
      disabled={isBlocked}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderColor,
          height: dims.height,
          paddingHorizontal: dims.padH,
        },
        fullWidth ? styles.fullWidth : null,
        isBlocked ? styles.blocked : null,
        pressed && !isBlocked ? styles.pressed : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon ? (
            <Ionicons name={icon} size={dims.icon} color={foreground} style={styles.icon} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              typography.title,
              styles.label,
              { color: foreground, fontSize: dims.font },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  blocked: {
    opacity: 0.45,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  icon: {
    marginRight: spacing.sm,
  },
  label: {
    fontWeight: '700',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
});

export default Button;
