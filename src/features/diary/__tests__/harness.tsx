/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared test doubles for the diary feature.
 *
 * `@/ui`, `@/domain`, `@/services/foodSearch` and `@/hooks/useAsyncData` are all
 * owned by other agents and are still placeholders while these suites are
 * written, so each one is faithfully re-implemented here against its published
 * contract. That keeps the suites hermetic while still exercising the real
 * screens, components and reducer logic.
 *
 * This file is not a test suite (jest only picks up `*.test.tsx`).
 */
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { Food, FoodEntry, Macros, MealType, ServingUnit } from '@/types';

const h = React.createElement;

/* -------------------------------------------------------------------------- */
/* Pure maths shared by the domain + food search doubles                       */
/* -------------------------------------------------------------------------- */

export function roundTo(n: number, dp = 0): number {
  const value = Number.isFinite(n) ? n : 0;
  const factor = 10 ** dp;
  return Math.round(value * factor + (value >= 0 ? 1e-9 : -1e-9)) / factor;
}

export function isoOf(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysISO(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

export const TODAY = isoOf(new Date());
export const YESTERDAY = addDaysISO(TODAY, -1);
export const NOW = '2026-08-19T12:00:00.000Z';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

export function makeMacros(
  calories: number,
  protein: number,
  carbs: number,
  fat: number
): Macros {
  return { calories, protein, carbs, fat };
}

export function makeEntry(overrides: Partial<FoodEntry> = {}): FoodEntry {
  return {
    id: 'entry-1',
    date: TODAY,
    mealType: 'breakfast',
    foodId: null,
    name: 'Oatmeal',
    brand: null,
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 serving (100 g)',
    gramsTotal: 100,
    macros: makeMacros(300, 10, 50, 6),
    photoUri: null,
    source: 'custom',
    visionConfidence: null,
    wasEdited: false,
    loggedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id: 'food-1',
    name: 'Greek yogurt',
    brand: 'Fage',
    per100g: { calories: 100, protein: 10, carbs: 4, fat: 5 },
    servingSizeG: 150,
    servingLabel: '1 pot (150 g)',
    barcode: null,
    source: 'seed',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* `@/domain` double                                                          */
/* -------------------------------------------------------------------------- */

export function domainMock(): Record<string, unknown> {
  const emptyMacros = (): Macros => ({ calories: 0, protein: 0, carbs: 0, fat: 0 });

  const sumMacros = (list: { macros?: Macros }[]): Macros =>
    (list ?? []).reduce<Macros>((acc, item) => {
      const m = item?.macros ?? emptyMacros();
      return {
        calories: acc.calories + (m.calories ?? 0),
        protein: acc.protein + (m.protein ?? 0),
        carbs: acc.carbs + (m.carbs ?? 0),
        fat: acc.fat + (m.fat ?? 0),
      };
    }, emptyMacros());

  const scaleMacros = (per100g: Macros, grams: number): Macros => {
    const factor = (Number.isFinite(grams) ? grams : 0) / 100;
    const out: Macros = {
      calories: roundTo((per100g?.calories ?? 0) * factor, 0),
      protein: roundTo((per100g?.protein ?? 0) * factor, 1),
      carbs: roundTo((per100g?.carbs ?? 0) * factor, 1),
      fat: roundTo((per100g?.fat ?? 0) * factor, 1),
    };
    if (per100g?.fiber != null) out.fiber = roundTo(per100g.fiber * factor, 1);
    if (per100g?.sugar != null) out.sugar = roundTo(per100g.sugar * factor, 1);
    if (per100g?.sodium != null) out.sodium = roundTo(per100g.sodium * factor, 1);
    return out;
  };

  const macrosToCalories = (m: { protein: number; carbs: number; fat: number }): number =>
    (m?.protein ?? 0) * 4 + (m?.carbs ?? 0) * 4 + (m?.fat ?? 0) * 9;

  return {
    emptyMacros,
    sumMacros,
    scaleMacros,
    macrosToCalories,
    normalizeMacros: (m: Macros) => m,
    todayISO: () => TODAY,
    addDaysISO,
    formatDateLabel: (date: string) => (date === TODAY ? 'Today' : date),
    isFutureISO: (date: string) => date > TODAY,
    roundTo,
    clamp: (n: number, min: number, max: number) => Math.min(Math.max(n, min), max),
    formatMacroG: (g: number) => `${roundTo(g, 1)} g`,
    formatEnergy: (kcal: number) => `${Math.round(kcal)} kcal`,
    buildDailySummary: ({ date, entries, exercises, targets, addExerciseToTarget }: any) => {
      const consumed = sumMacros(entries ?? []);
      const meals: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
      const byMeal: Record<string, Macros> = {};
      for (const meal of meals) {
        byMeal[meal] = sumMacros((entries ?? []).filter((e: FoodEntry) => e.mealType === meal));
      }
      const exerciseBurned = (exercises ?? []).reduce(
        (total: number, e: any) => total + (e?.caloriesBurned ?? 0),
        0
      );
      const includeExercise = addExerciseToTarget !== false;
      return {
        date,
        consumed,
        byMeal,
        exerciseBurned,
        targets,
        netCalories: consumed.calories - exerciseBurned,
        remainingCalories:
          targets.calories - consumed.calories + (includeExercise ? exerciseBurned : 0),
        entryCount: (entries ?? []).length,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* `@/services/foodSearch` double                                             */
/* -------------------------------------------------------------------------- */

const UNIT_GRAMS: Record<string, number | null> = {
  g: 1,
  ml: 1,
  oz: 28.349523125,
  cup: 240,
  tbsp: 15,
  tsp: 5,
  serving: null,
  piece: null,
};

export function unitLabel(unit: ServingUnit, quantity = 1): string {
  if (unit === 'serving') return quantity === 1 ? 'serving' : 'servings';
  if (unit === 'piece') return quantity === 1 ? 'piece' : 'pieces';
  if (unit === 'cup') return quantity === 1 ? 'cup' : 'cups';
  return unit;
}

export function gramsFor(food: Food, quantity: number, unit: ServingUnit): number {
  const fixed = UNIT_GRAMS[unit];
  const perUnit = fixed ?? (food?.servingSizeG > 0 ? food.servingSizeG : 100);
  return roundTo(perUnit * Math.max(0, quantity), 1);
}

export function foodSearchMock(catalog: Food[] = [makeFood()]): Record<string, unknown> {
  const { scaleMacros } = domainMock() as {
    scaleMacros: (per100g: Macros, grams: number) => Macros;
  };

  return {
    QUICK_ADD_UNITS: ['serving', 'g', 'oz', 'cup', 'piece'] as ServingUnit[],
    unitLabel,
    gramsFor,
    suggestUnitsForFood: (food: Food): ServingUnit[] =>
      food?.servingSizeG > 0 ? ['serving', 'g', 'oz'] : ['g', 'oz'],
    scaleFoodToEntry: (food: Food, quantity: number, unit: ServingUnit) => {
      const gramsTotal = gramsFor(food, quantity, unit);
      return {
        gramsTotal,
        macros: scaleMacros(food.per100g, gramsTotal),
        servingLabel: `${quantity} ${unitLabel(unit, quantity)} (${roundTo(gramsTotal, 0)} g)`,
      };
    },
    searchAllFoods: jest.fn(async (query: string, limit = 40) => {
      const q = (query ?? '').trim().toLowerCase();
      const matches = q
        ? catalog.filter((food) => food.name.toLowerCase().includes(q))
        : catalog;
      return matches.slice(0, limit);
    }),
    resolveFoodById: jest.fn(async (id: string) => catalog.find((food) => food.id === id) ?? null),
    ensureFoodsSeeded: jest.fn(async () => catalog.length),
    buildQuickAddFood: (name: string, macros: Macros) => makeFood({ name, per100g: macros }),
  };
}

/* -------------------------------------------------------------------------- */
/* `@/hooks/useAsyncData` double                                              */
/* -------------------------------------------------------------------------- */

export function asyncDataMock(): Record<string, unknown> {
  const { useAppStore } = require('@/store/appStore') as {
    useAppStore: (selector: (s: { dataVersion: number }) => number) => number;
  };

  return {
    useAsyncData: (loader: () => Promise<unknown>, deps: unknown[], initial: unknown) => {
      const [data, setData] = React.useState(initial);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState<string | null>(null);
      const [nonce, setNonce] = React.useState(0);
      const dataVersion = useAppStore((s) => s.dataVersion);
      const loaderRef = React.useRef(loader);
      loaderRef.current = loader;

      React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        loaderRef
          .current()
          .then((result) => {
            if (cancelled) return;
            setData(result);
            setError(null);
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            setError(e instanceof Error ? e.message : String(e));
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return () => {
          cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [...deps, dataVersion, nonce]);

      return { data, loading, error, reload: () => setNonce((n) => n + 1) };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* `@/ui` double                                                              */
/* -------------------------------------------------------------------------- */

const THEME = {
  colors: {
    bg: '#0B0D10',
    surface: '#151A21',
    surfaceAlt: '#1D242D',
    border: '#2A323D',
    text: '#F2F5F8',
    textMuted: '#9BA6B4',
    textFaint: '#5F6B7A',
    primary: '#22C55E',
    primaryDim: '#16A34A',
    onPrimary: '#04150A',
    protein: '#F43F5E',
    carbs: '#F59E0B',
    fat: '#6366F1',
    calories: '#22C55E',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#EF4444',
    overlay: 'rgba(0, 0, 0, 0.62)',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  typography: {},
  isDark: true,
};

export function uiMock(): Record<string, unknown> {
  return {
    useTheme: () => THEME,

    Screen: ({ children, onRefresh, refreshing }: any) =>
      h(View, { testID: 'screen' }, [
        onRefresh
          ? h(
              Pressable,
              {
                key: 'refresh',
                testID: 'screen-refresh',
                accessibilityRole: 'button',
                accessibilityLabel: 'Refresh',
                accessibilityState: { busy: Boolean(refreshing) },
                onPress: onRefresh,
              },
              h(Text, null, 'refresh')
            )
          : null,
        h(View, { key: 'body' }, children),
      ]),

    Card: ({ children, onPress, testID }: any) =>
      onPress
        ? h(Pressable, { onPress, testID: testID ?? 'card' }, children)
        : h(View, { testID: testID ?? 'card' }, children),

    KeyboardAvoider: ({ children }: any) => h(View, null, children),

    Button: ({ title, onPress, disabled, loading, testID }: any) =>
      h(
        Pressable,
        {
          testID,
          disabled: Boolean(disabled || loading),
          accessibilityRole: 'button',
          accessibilityLabel: title,
          accessibilityState: { disabled: Boolean(disabled || loading) },
          onPress: () => {
            if (disabled || loading) return;
            onPress?.();
          },
        },
        h(Text, null, title)
      ),

    TextField: ({ label, value, onChangeText, placeholder, error, testID, right }: any) =>
      h(View, null, [
        label ? h(Text, { key: 'l' }, label) : null,
        h(TextInput, {
          key: 'i',
          testID,
          accessibilityLabel: label ?? placeholder,
          placeholder,
          value,
          onChangeText,
        }),
        error ? h(Text, { key: 'e' }, error) : null,
        right ? h(View, { key: 'r' }, right) : null,
      ]),

    NumberField: ({ label, value, onChange, placeholder, suffix, testID }: any) =>
      h(View, null, [
        label ? h(Text, { key: 'l' }, label) : null,
        h(TextInput, {
          key: 'i',
          testID,
          accessibilityLabel: label ?? placeholder,
          placeholder,
          keyboardType: 'numeric',
          value: value == null ? '' : String(value),
          onChangeText: (text: string) => {
            const trimmed = (text ?? '').trim();
            if (!trimmed) {
              onChange?.(null);
              return;
            }
            const parsed = Number(trimmed);
            onChange?.(Number.isFinite(parsed) ? parsed : null);
          },
        }),
        suffix ? h(Text, { key: 's' }, suffix) : null,
      ]),

    SegmentedControl: ({ options, value, onChange }: any) =>
      h(
        View,
        { testID: 'segmented-control' },
        (options ?? []).map((option: any) =>
          h(
            Pressable,
            {
              key: String(option.value),
              testID: `segment-${option.value}`,
              accessibilityRole: 'button',
              accessibilityLabel: option.label,
              accessibilityState: { selected: option.value === value },
              onPress: () => onChange?.(option.value),
            },
            h(Text, null, option.label)
          )
        )
      ),

    ProgressRing: ({ progress, label, sublabel, children }: any) =>
      h(View, { testID: 'progress-ring' }, [
        h(Text, { key: 'p', testID: 'progress-ring-value' }, String(progress)),
        label ? h(Text, { key: 'l' }, String(label)) : null,
        sublabel ? h(Text, { key: 's' }, String(sublabel)) : null,
        children ? h(View, { key: 'c' }, children) : null,
      ]),

    MacroBar: ({ protein, carbs, fat }: any) =>
      h(Text, { testID: 'macro-bar' }, `${protein}|${carbs}|${fat}`),

    StatTile: ({ label, value, sublabel, onPress, testID }: any) =>
      h(Pressable, { onPress, testID: testID ?? 'stat-tile' }, [
        h(Text, { key: 'l' }, label),
        h(Text, { key: 'v' }, String(value)),
        sublabel ? h(Text, { key: 's' }, sublabel) : null,
      ]),

    ListRow: ({ title, subtitle, meta, right, onPress, onLongPress, testID }: any) =>
      h(View, { testID: testID ? `${testID}-wrap` : 'list-row' }, [
        h(
          Pressable,
          {
            key: 'p',
            testID,
            onPress,
            onLongPress,
            accessibilityRole: 'button',
            accessibilityLabel: title,
          },
          [
            h(Text, { key: 't' }, title),
            subtitle ? h(Text, { key: 's' }, subtitle) : null,
            meta ? h(Text, { key: 'm' }, meta) : null,
          ]
        ),
        right ? h(View, { key: 'r' }, right) : null,
      ]),

    EmptyState: ({ title, message, actionLabel, onAction, testID }: any) =>
      h(View, { testID: testID ?? 'empty-state' }, [
        h(Text, { key: 't' }, title),
        message ? h(Text, { key: 'm' }, message) : null,
        actionLabel
          ? h(
              Pressable,
              { key: 'a', onPress: onAction, accessibilityRole: 'button', accessibilityLabel: actionLabel },
              h(Text, null, actionLabel)
            )
          : null,
      ]),

    Sheet: ({ visible, title, children }: any) =>
      visible
        ? h(View, { testID: 'sheet' }, [
            title ? h(Text, { key: 't' }, title) : null,
            h(View, { key: 'c' }, children),
          ])
        : null,

    Chip: ({ label, selected, onPress, testID }: any) =>
      h(
        Pressable,
        {
          testID,
          onPress,
          accessibilityRole: 'button',
          accessibilityLabel: label,
          accessibilityState: { selected: Boolean(selected) },
        },
        h(Text, null, label)
      ),

    SectionHeader: ({ title, right }: any) =>
      h(View, { testID: 'section-header' }, [
        h(Text, { key: 't' }, title),
        right ? h(View, { key: 'r' }, right) : null,
      ]),

    Divider: () => h(View, { testID: 'divider' }),

    Badge: ({ label, testID }: any) => h(Text, { testID }, label),

    DateStepper: ({ date, onChange }: any) =>
      h(View, { testID: 'date-stepper' }, [
        h(Text, { key: 'd' }, date),
        h(
          Pressable,
          {
            key: 'prev',
            accessibilityRole: 'button',
            accessibilityLabel: 'Previous day',
            onPress: () => onChange?.(addDaysISO(date, -1)),
          },
          h(Text, null, 'prev')
        ),
        h(
          Pressable,
          {
            key: 'next',
            accessibilityRole: 'button',
            accessibilityLabel: 'Next day',
            onPress: () => onChange?.(addDaysISO(date, 1)),
          },
          h(Text, null, 'next')
        ),
      ]),
  };
}

/* -------------------------------------------------------------------------- */
/* `@/db/repositories` double                                                 */
/* -------------------------------------------------------------------------- */

export function repositoriesMock(): Record<string, jest.Mock> {
  return {
    listEntriesByDate: jest.fn(async () => []),
    listExercisesByDate: jest.fn(async () => []),
    getFoodEntry: jest.fn(async () => null),
    addFoodEntry: jest.fn(async () => undefined),
    addFoodEntries: jest.fn(async () => undefined),
    updateFoodEntry: jest.fn(async () => undefined),
    deleteFoodEntry: jest.fn(async () => undefined),
    searchFoods: jest.fn(async () => []),
    getFood: jest.fn(async () => null),
    upsertFood: jest.fn(async () => null),
    listRecentFoods: jest.fn(async () => []),
    listFavoriteFoods: jest.fn(async () => []),
    toggleFavoriteFood: jest.fn(async () => undefined),
    bumpFoodUsage: jest.fn(async () => undefined),
    getActiveGoal: jest.fn(async () => null),
  };
}

/* -------------------------------------------------------------------------- */
/* `expo-router` double                                                       */
/* -------------------------------------------------------------------------- */

export function routerMock(params: Record<string, unknown> = {}): Record<string, unknown> {
  const push = jest.fn();
  const replace = jest.fn();
  const back = jest.fn();
  const current = { ...params };
  return {
    router: { push, replace, back, navigate: push },
    useRouter: () => ({ push, replace, back, navigate: push }),
    useLocalSearchParams: () => current,
    __push: push,
    __back: back,
    __replace: replace,
    __setParams: (next: Record<string, unknown>) => {
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, next);
    },
  };
}
