import { Ionicons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
  /**
   * Wraps the content in a ScrollView so it stays reachable once the sheet hits
   * its 90% max height. Default true — turn it off when the content already
   * manages its own scrolling.
   */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode;
}

/** Bottom sheet modal with a dim backdrop, drag handle and keyboard avoidance. */
export function Sheet({
  visible,
  onClose,
  title,
  scrollable = true,
  style,
  testID,
  children,
}: SheetProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeInsets();

  // Closing while an input is focused must take the keyboard down with it,
  // otherwise it lingers over the screen behind the sheet.
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const content = scrollable ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.content}>{children}</View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View testID={testID} style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={handleClose}
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
                  onPress={handleClose}
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

            {content}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  avoider: {
    // A definite height is what makes the sheet's percentage maxHeight resolve.
    flex: 1,
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
    // RN defaults flexShrink to 0, which would let non-scrollable content push
    // straight through the sheet's maxHeight and off the top of the screen.
    flexShrink: 1,
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
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
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
