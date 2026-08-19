import { Ionicons } from '@expo/vector-icons';
import { addDays, format, isValid } from 'date-fns';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { ISODate } from '@/types';
import { radius, spacing, typography, useTheme } from '../theme';

export interface DateStepperProps {
  date: ISODate;
  onChange: (d: ISODate) => void;
  /** Blocks stepping past today. Default true. */
  disableFuture?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO(): ISODate {
  return format(new Date(), 'yyyy-MM-dd');
}

/** Parses 'YYYY-MM-DD' at local midnight; falls back to today when malformed. */
function parseISODate(value: string): Date {
  if (typeof value === 'string' && ISO_RE.test(value)) {
    const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
    const parsed = new Date(y, m - 1, d);
    if (isValid(parsed)) return parsed;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function shift(value: string, days: number): ISODate {
  return format(addDays(parseISODate(value), days), 'yyyy-MM-dd');
}

/** 'Today' / 'Yesterday' / 'Mon, Jan 5' */
export function formatDateLabel(value: string): string {
  const today = todayISO();
  if (value === today) return 'Today';
  if (value === shift(today, -1)) return 'Yesterday';
  return format(parseISODate(value), 'EEE, MMM d');
}

/** Day picker: ‹ label › with the future disabled. */
export function DateStepper({
  date,
  onChange,
  disableFuture = true,
  style,
  testID,
}: DateStepperProps): React.JSX.Element {
  const { colors } = useTheme();

  const normalized = typeof date === 'string' && ISO_RE.test(date) ? date : todayISO();
  const label = formatDateLabel(normalized);
  const nextDisabled = disableFuture && normalized >= todayISO();

  const step = (days: number): void => {
    onChange(shift(normalized, days));
  };

  return (
    <View
      testID={testID}
      style={[
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        hitSlop={8}
        onPress={() => step(-1)}
        style={({ pressed }) => [styles.arrow, pressed ? styles.pressed : null]}
      >
        <Ionicons name="chevron-back" size={20} color={colors.text} />
      </Pressable>

      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[typography.title, styles.label, { color: colors.text }]}
      >
        {label}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next day"
        accessibilityState={{ disabled: nextDisabled }}
        disabled={nextDisabled}
        hitSlop={8}
        onPress={() => step(1)}
        style={({ pressed }) => [
          styles.arrow,
          nextDisabled ? styles.disabled : null,
          pressed && !nextDisabled ? styles.pressed : null,
        ]}
      >
        <Ionicons
          name="chevron-forward"
          size={20}
          color={nextDisabled ? colors.textFaint : colors.text}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    flex: 1,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.55,
    transform: [{ scale: 0.94 }],
  },
  row: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    width: '100%',
  },
});

export default DateStepper;
