import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type NativeSyntheticEvent,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type TextInputSubmitEditingEventData,
  type ViewStyle,
} from 'react-native';

import { radius, spacing, typography, useTheme } from '../theme';

export interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Error message; also turns the border red. */
  error?: string;
  /** Hint shown under the field when there is no error. */
  helper?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  keyboardType?: KeyboardTypeOptions;
  /** Trailing slot inside the field (unit, clear button, icon...). */
  right?: React.ReactNode;
  onSubmitEditing?: (e: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => void;
  returnKeyType?: ReturnKeyTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  secureTextEntry?: boolean;
  editable?: boolean;
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Labelled text input with focus ring, error state and helper text. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  helper,
  multiline = false,
  autoFocus = false,
  keyboardType,
  right,
  onSubmitEditing,
  returnKeyType,
  autoCapitalize,
  autoCorrect,
  secureTextEntry,
  editable = true,
  maxLength,
  style,
  testID,
}: TextFieldProps): React.JSX.Element {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <Text style={[typography.label, styles.label, { color: colors.textMuted }]}>{label}</Text>
      ) : null}

      <View
        style={[
          styles.field,
          { backgroundColor: colors.surfaceAlt, borderColor },
          multiline ? styles.fieldMultiline : null,
          !editable ? styles.disabled : null,
        ]}
      >
        <TextInput
          testID={testID}
          accessibilityLabel={label ?? placeholder ?? 'Text field'}
          accessibilityState={{ disabled: !editable }}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          multiline={multiline}
          autoFocus={autoFocus}
          keyboardType={keyboardType}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          secureTextEntry={secureTextEntry}
          editable={editable}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            typography.body,
            styles.input,
            { color: colors.text },
            multiline ? styles.inputMultiline : null,
          ]}
        />
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>

      {error ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, styles.hint, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : helper ? (
        <Text style={[typography.caption, styles.hint, { color: colors.textFaint }]}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.55,
  },
  field: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  fieldMultiline: {
    alignItems: 'flex-start',
    minHeight: 108,
    paddingVertical: spacing.sm,
  },
  hint: {
    marginTop: spacing.xs,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  inputMultiline: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  label: {
    marginBottom: spacing.xs,
  },
  right: {
    alignItems: 'center',
    flexDirection: 'row',
    marginLeft: spacing.sm,
  },
  wrap: {
    width: '100%',
  },
});

export default TextField;
