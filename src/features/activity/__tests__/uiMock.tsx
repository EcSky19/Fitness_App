/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal stand-ins for `@/ui` so the activity feature can be tested while the
 * design system is still being written by another module. Every stub renders
 * plain RN primitives and forwards the props the feature actually relies on.
 *
 * Not a test file (no `.test.` suffix) — imported by the tests in this folder.
 */
import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const colors = {
  bg: '#000',
  surface: '#111',
  surfaceAlt: '#222',
  border: '#333',
  text: '#fff',
  textMuted: '#aaa',
  textFaint: '#777',
  primary: '#22C55E',
  primaryDim: '#16A34A',
  onPrimary: '#000',
  protein: '#F43F5E',
  carbs: '#F59E0B',
  fat: '#6366F1',
  calories: '#22C55E',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  overlay: 'rgba(0,0,0,0.6)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };
export const typography = {
  h1: {},
  h2: {},
  h3: {},
  title: {},
  body: {},
  label: {},
  caption: {},
  mono: {},
};

export function useTheme() {
  return { colors, spacing, radius, typography, isDark: true };
}

export function Screen({ title, subtitle, onRefresh, children }: any) {
  return (
    <View>
      {title ? <Text>{title}</Text> : null}
      {subtitle ? <Text>{subtitle}</Text> : null}
      {onRefresh ? (
        <Pressable accessibilityRole="button" accessibilityLabel="mock-refresh" onPress={onRefresh}>
          <Text>refresh</Text>
        </Pressable>
      ) : null}
      <ScrollView>{children}</ScrollView>
    </View>
  );
}

export function Card({ children, onPress, accessibilityLabel, testID }: any) {
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View accessibilityLabel={accessibilityLabel} testID={testID}>
      {children}
    </View>
  );
}

export function Button({ title, onPress, disabled, loading, accessibilityLabel, testID }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      disabled={Boolean(disabled || loading)}
      onPress={onPress}
      testID={testID}
    >
      <Text>{title}</Text>
    </Pressable>
  );
}

export function TextField({ label, value, onChangeText, placeholder, error, helper }: any) {
  return (
    <View>
      {label ? <Text>{label}</Text> : null}
      <TextInput
        accessibilityLabel={label ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
      />
      {error ? <Text>{error}</Text> : null}
      {helper ? <Text>{helper}</Text> : null}
    </View>
  );
}

export function NumberField({ label, value, onChange, suffix, placeholder }: any) {
  return (
    <View>
      {label ? <Text>{label}</Text> : null}
      <TextInput
        accessibilityLabel={label ?? placeholder}
        placeholder={placeholder}
        keyboardType="numeric"
        value={value === null || value === undefined ? '' : String(value)}
        onChangeText={(text: string) => {
          const trimmed = text.trim();
          if (trimmed === '') {
            onChange(null);
            return;
          }
          const parsed = Number(trimmed);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
      {suffix ? <Text>{suffix}</Text> : null}
    </View>
  );
}

export function SegmentedControl({ options, value, onChange }: any) {
  return (
    <View>
      {(options ?? []).map((option: any) => (
        <Pressable
          key={String(option.value)}
          accessibilityRole="button"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: option.value === value }}
          onPress={() => onChange(option.value)}
        >
          <Text>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ProgressRing({ label, sublabel, progress, children }: any) {
  return (
    <View testID="progress-ring" accessibilityValue={{ now: Math.round((progress ?? 0) * 100) }}>
      {label ? <Text>{label}</Text> : null}
      {sublabel ? <Text>{sublabel}</Text> : null}
      {children}
    </View>
  );
}

export function StatTile({ label, value, sublabel, testID }: any) {
  return (
    <View testID={testID ?? `stat-${label}`}>
      <Text>{label}</Text>
      <Text>{String(value)}</Text>
      {sublabel ? <Text>{sublabel}</Text> : null}
    </View>
  );
}

export function LineChart({ data }: any) {
  return (
    <View testID="line-chart">
      <Text>{`points:${(data ?? []).length}`}</Text>
      <Text>{`series:${(data ?? []).map((p: any) => p.y).join(',')}`}</Text>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  meta,
  right,
  onPress,
  onLongPress,
  testID,
}: any) {
  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        onLongPress={onLongPress}
      >
        <Text>{title}</Text>
        {subtitle ? <Text>{subtitle}</Text> : null}
        {meta ? <Text>{meta}</Text> : null}
      </Pressable>
      {right}
    </View>
  );
}

export function EmptyState({ icon, title, message, actionLabel, onAction, testID }: any) {
  return (
    <View testID={testID ?? 'empty-state'}>
      <Text>{icon}</Text>
      <Text>{title}</Text>
      {message ? <Text>{message}</Text> : null}
      {actionLabel ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction}>
          <Text>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Sheet({ visible, title, children }: any) {
  if (!visible) return null;
  return (
    <View testID="sheet">
      {title ? <Text>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Chip({ label, selected, onPress }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
    >
      <Text>{label}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, right }: any) {
  return (
    <View>
      <Text>{title}</Text>
      {right}
    </View>
  );
}

export function Divider() {
  return <View testID="divider" />;
}

export function Badge({ label }: any) {
  return (
    <View testID={`badge-${label}`}>
      <Text>{label}</Text>
    </View>
  );
}

export function KeyboardAvoider({ children }: any) {
  return <View>{children}</View>;
}

function shiftISO(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((part) => Number(part));
  const base = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function DateStepper({ date, onChange }: any) {
  return (
    <View testID="date-stepper">
      <Text>{date}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="previous-day"
        onPress={() => onChange(shiftISO(date, -1))}
      >
        <Text>prev</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="next-day"
        onPress={() => onChange(shiftISO(date, 1))}
      >
        <Text>next</Text>
      </Pressable>
    </View>
  );
}
