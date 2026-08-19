/**
 * Test-only doubles for the scan feature.
 *
 * The design system, the vision service and the repositories are owned by other
 * modules and land asynchronously, so the scan tests drive them through these
 * light-weight stand-ins that implement the documented contracts.
 */
/* eslint-env jest */
import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import type { Macros, VisionFoodItem, VisionResult } from '@/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

export function makeMacros(over: Partial<Macros> = {}): Macros {
  return { calories: 200, protein: 10, carbs: 20, fat: 8, ...over };
}

export function makeVisionItem(over: Partial<VisionFoodItem> = {}): VisionFoodItem {
  return {
    name: 'Grilled chicken breast',
    brand: null,
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 breast (150 g)',
    estimatedGrams: 150,
    macros: makeMacros({ calories: 248, protein: 46.5, carbs: 0, fat: 5.4 }),
    confidence: 0.88,
    notes: null,
    ...over,
  };
}

export function makeVisionResult(over: Partial<VisionResult> = {}): VisionResult {
  return {
    mode: 'food_photo',
    items: [
      makeVisionItem(),
      makeVisionItem({
        name: 'Steamed white rice',
        servingLabel: '1 cup (180 g)',
        unit: 'cup',
        estimatedGrams: 180,
        macros: makeMacros({ calories: 234, protein: 4.3, carbs: 51.7, fat: 0.4 }),
        confidence: 0.3,
      }),
    ],
    provider: 'mock',
    modelId: 'mock-vision-1',
    latencyMs: 420,
    rawText: null,
    warnings: [],
    ...over,
  };
}

/** URL-encoded payload exactly as `app/scan.tsx` builds it. */
export function encodePayload(result: VisionResult): string {
  return encodeURIComponent(JSON.stringify(result));
}

/* -------------------------------------------------------------------------- */
/* Module mocks                                                               */
/* -------------------------------------------------------------------------- */

/** Stand-in for `@/services/vision`. */
export function makeVisionServiceMock(): Record<string, unknown> {
  return {
    analyzeImage: jest.fn(async () => ({ ok: true, data: makeVisionResult() })),
    imageUriToBase64: jest.fn(async () => ({ base64: 'BASE64', mimeType: 'image/jpeg' })),
    visionItemToEntryDraft: jest.fn(
      (
        item: VisionFoodItem,
        ctx: { date: string; mealType: string; photoUri: string | null }
      ) => ({
        date: ctx.date,
        mealType: ctx.mealType,
        foodId: null,
        name: item.name,
        brand: item.brand,
        quantity: item.quantity,
        unit: item.unit,
        servingLabel: item.servingLabel,
        gramsTotal: item.estimatedGrams,
        macros: item.macros,
        photoUri: ctx.photoUri,
        source: 'vision',
        visionConfidence: item.confidence,
        wasEdited: false,
        loggedAt: '2026-08-19T12:00:00.000Z',
      })
    ),
    getVisionProvider: jest.fn(() => ({ id: 'mock', modelId: 'mock-vision-1' })),
    getVisionProviderLabel: jest.fn((id: string) =>
      id === 'mock' ? 'Demo (on-device)' : id
    ),
    listVisionProviders: jest.fn(() => [
      { id: 'mock', label: 'Mock', requiresApiKey: false, configured: true },
    ]),
  };
}

/** Stand-in for `@/db/repositories`. */
export function makeRepositoriesMock(): Record<string, unknown> {
  return {
    addFoodEntries: jest.fn(async (entries: unknown[]) =>
      entries.map((entry, index) => ({
        ...(entry as object),
        id: `entry-${index}`,
        createdAt: '2026-08-19T12:00:00.000Z',
        updatedAt: '2026-08-19T12:00:00.000Z',
      }))
    ),
    addFoodEntry: jest.fn(async (entry: unknown) => entry),
    upsertFood: jest.fn(async (food: unknown) => food),
  };
}

/* -------------------------------------------------------------------------- */
/* UI kit double                                                              */
/* -------------------------------------------------------------------------- */

interface StubTheme {
  colors: Record<string, string>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  typography: Record<string, object>;
  isDark: boolean;
}

const FALLBACK_THEME: StubTheme = {
  colors: new Proxy({} as Record<string, string>, { get: () => '#123456' }),
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  typography: new Proxy({} as Record<string, object>, { get: () => ({}) }),
  isDark: true,
};

/**
 * Minimal `@/ui` implementation with the documented props. Labels are mapped to
 * accessibility labels so tests can drive the fields the same way a user would.
 */
export function makeUiMock(): Record<string, unknown> {
  let theme: Record<string, unknown> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    theme = require('@/ui/theme') as Record<string, unknown>;
  } catch {
    theme = {};
  }
  const useTheme =
    typeof theme.useTheme === 'function' ? (theme.useTheme as () => StubTheme) : () => FALLBACK_THEME;

  const Screen = ({ title, subtitle, children }: any) => (
    <View testID="screen">
      {title ? <Text>{title}</Text> : null}
      {subtitle ? <Text>{subtitle}</Text> : null}
      <ScrollView>{children}</ScrollView>
    </View>
  );

  const Card = ({ children, testID, onPress }: any) =>
    onPress ? (
      <Pressable testID={testID} onPress={onPress}>
        {children}
      </Pressable>
    ) : (
      <View testID={testID}>{children}</View>
    );

  const Button = ({ title, onPress, disabled, loading, testID }: any) => {
    const blocked = Boolean(disabled || loading);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={blocked ? undefined : onPress}
        testID={testID}
      >
        <Text>{title}</Text>
      </Pressable>
    );
  };

  const TextField = ({ label, value, onChangeText, placeholder, error, helper }: any) => (
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

  const NumberField = ({ label, value, onChange, suffix, placeholder }: any) => (
    <View>
      {label ? <Text>{label}</Text> : null}
      <TextInput
        accessibilityLabel={label ?? placeholder}
        keyboardType="numeric"
        value={value === null || value === undefined ? '' : String(value)}
        onChangeText={(text: string) => {
          const trimmed = text.trim();
          if (trimmed.length === 0) return onChange(null);
          const parsed = Number(trimmed);
          return onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
      {suffix ? <Text>{suffix}</Text> : null}
    </View>
  );

  const SegmentedControl = ({ options, value, onChange }: any) => (
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

  const Sheet = ({ visible, title, children }: any) =>
    visible ? (
      <View testID="sheet">
        {title ? <Text>{title}</Text> : null}
        {children}
      </View>
    ) : null;

  const Chip = ({ label, onPress, testID, selected }: any) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      testID={testID}
    >
      <Text>{label}</Text>
    </Pressable>
  );

  const EmptyState = ({ title, message, actionLabel, onAction, testID }: any) => (
    <View testID={testID}>
      <Text>{title}</Text>
      {message ? <Text>{message}</Text> : null}
      {actionLabel ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction}>
          <Text>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const ListRow = ({ title, subtitle, meta, onPress, testID, right }: any) => (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} testID={testID}>
      <Text>{title}</Text>
      {subtitle ? <Text>{subtitle}</Text> : null}
      {meta ? <Text>{meta}</Text> : null}
      {right ?? null}
    </Pressable>
  );

  return {
    ...theme,
    useTheme,
    Screen,
    Card,
    Button,
    TextField,
    NumberField,
    SegmentedControl,
    Sheet,
    Chip,
    EmptyState,
    ListRow,
    MacroBar: () => <View testID="macro-bar" />,
    SectionHeader: ({ title }: any) => <Text>{title}</Text>,
    Divider: () => <View testID="divider" />,
    Badge: ({ label, testID }: any) => <Text testID={testID}>{label}</Text>,
    KeyboardAvoider: ({ children }: any) => <View testID="keyboard-avoider">{children}</View>,
    StatTile: ({ label, value }: any) => (
      <View>
        <Text>{label}</Text>
        <Text>{String(value)}</Text>
      </View>
    ),
  };
}
