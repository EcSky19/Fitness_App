import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export interface KeyboardAvoiderProps {
  /** Extra offset above the keyboard, e.g. for a floating action bar. */
  offset?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Wraps forms so the on-screen keyboard never covers focused inputs. */
export function KeyboardAvoider({
  offset = 0,
  style,
  children,
}: KeyboardAvoiderProps): React.JSX.Element {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={offset}
      style={[styles.fill, style]}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});

export default KeyboardAvoider;
