import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, spacing, typography, useTheme } from '../theme';

export interface NumberFieldProps {
  label?: string;
  value: number | null;
  onChange: (n: number | null) => void;
  /** Static unit rendered on the right, e.g. "g" or "kcal". */
  suffix?: string;
  placeholder?: string;
  /** Max decimal places accepted / rounded to on blur. Default 2. */
  decimals?: number;
  /** Clamped on blur only, never while typing. */
  min?: number;
  max?: number;
  autoFocus?: boolean;
  error?: string;
  helper?: string;
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function roundTo(n: number, decimals: number): number {
  const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(decimals)));
  return Math.round(n * factor) / factor;
}

/** Number -> editable string. Trailing zeros are trimmed by `String`. */
function format(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(roundTo(value, decimals));
}

/**
 * Keeps only digits, an optional leading '-' and at most `decimals` fraction
 * digits, so partial input like "1." or "-" survives until blur.
 */
function sanitize(input: string, decimals: number, allowNegative: boolean): string {
  let text = input.replace(/,/g, '.');
  let sign = '';
  if (allowNegative && text.startsWith('-')) sign = '-';
  text = text.replace(/-/g, '');
  text = text.replace(/[^\d.]/g, '');

  const firstDot = text.indexOf('.');
  if (firstDot >= 0) {
    const head = text.slice(0, firstDot);
    const tail = text.slice(firstDot + 1).replace(/\./g, '');
    text = decimals > 0 ? `${head}.${tail.slice(0, decimals)}` : head;
  }
  return sign + text;
}

/** Returns null for empty/partial input ('', '.', '-', '-.'). */
function parse(text: string): number | null {
  if (text === '' || text === '.' || text === '-' || text === '-.') return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

/** Numeric input that tolerates partial typing and clamps only on blur. */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  decimals = 2,
  min,
  max,
  autoFocus = false,
  error,
  helper,
  editable = true,
  style,
  testID,
}: NumberFieldProps): React.JSX.Element {
  const { colors } = useTheme();
  const [raw, setRaw] = useState<string>(() => format(value, decimals));
  const [focused, setFocused] = useState(false);
  const emitted = useRef<number | null>(value ?? null);

  // Adopt external changes, but ignore the echo of our own last emission so the
  // user's in-progress text ("1.", "0.05") is never clobbered mid-typing.
  useEffect(() => {
    const next = value ?? null;
    if (next === emitted.current) return;
    emitted.current = next;
    setRaw(format(next, decimals));
  }, [value, decimals]);

  const emit = useCallback(
    (n: number | null) => {
      emitted.current = n;
      onChange(n);
    },
    [onChange]
  );

  const handleChangeText = useCallback(
    (text: string) => {
      const allowNegative = min === undefined || min < 0;
      const clean = sanitize(text, decimals, allowNegative);
      setRaw(clean);
      emit(parse(clean));
    },
    [decimals, emit, min]
  );

  const handleBlur = useCallback(() => {
    setFocused(false);
    const parsed = parse(raw);
    if (parsed === null) {
      setRaw('');
      if (emitted.current !== null) emit(null);
      return;
    }
    let next = parsed;
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    next = roundTo(next, decimals);
    setRaw(format(next, decimals));
    emit(next);
  }, [decimals, emit, max, min, raw]);

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
          !editable ? styles.disabled : null,
        ]}
      >
        <TextInput
          testID={testID}
          accessibilityLabel={label ?? placeholder ?? 'Number field'}
          value={raw}
          onChangeText={handleChangeText}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          keyboardType={decimals > 0 ? 'decimal-pad' : 'number-pad'}
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          autoFocus={autoFocus}
          editable={editable}
          selectTextOnFocus
          style={[typography.title, styles.input, { color: colors.text }]}
        />
        {suffix ? (
          <Text style={[typography.label, { color: colors.textMuted }]}>{suffix}</Text>
        ) : null}
      </View>

      {error ? (
        <Text style={[typography.caption, styles.hint, { color: colors.danger }]}>{error}</Text>
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
  hint: {
    marginTop: spacing.xs,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  label: {
    marginBottom: spacing.xs,
  },
  wrap: {
    width: '100%',
  },
});

export default NumberField;
