import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { radius, spacing, typography, useSafeInsets, useTheme } from '../theme';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode;
}

/** Bottom sheet modal with a dim backdrop, drag handle and keyboard avoidance. */
export function Sheet({
  visible,
  onClose,
  title,
  style,
  testID,
  children,
}: SheetProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View testID={testID} style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
          style={styles.avoider}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                paddingBottom: spacing.lg + insets.bottom,
              },
              style,
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            {title ? (
              <View style={styles.titleRow}>
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  style={[typography.h3, styles.title, { color: colors.text }]}
                >
                  {title}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close sheet"
                  onPress={onClose}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.closeButton,
                    { backgroundColor: colors.surfaceAlt },
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.content}>{children}</View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  avoider: {
    justifyContent: 'flex-end',
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 28,
    justifyContent: 'center',
    marginLeft: spacing.md,
    width: 28,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    borderRadius: radius.pill,
    height: 4,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
    width: 40,
  },
  pressed: {
    opacity: 0.6,
  },
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '90%',
  },
  title: {
    flex: 1,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});

export default Sheet;
