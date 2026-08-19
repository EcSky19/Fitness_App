/**
 * MacroTrack design system.
 *
 * Dark is the primary look: near-black canvas, elevated surfaces, vivid green
 * primary. Macro colours are fixed app-wide so a bar/ring/legend always means
 * the same nutrient:
 *   protein = rose, carbs = amber, fat = indigo, calories = primary green.
 */
import { useContext, useMemo } from 'react';
import { Platform, useColorScheme, type TextStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export interface Palette {
  /** App canvas. */
  bg: string;
  /** Cards, sheets, elevated blocks. */
  surface: string;
  /** Secondary fills: inputs, track backgrounds, segmented controls. */
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  /** Lower-emphasis primary: pressed states, secondary accents. */
  primaryDim: string;
  /** Foreground used on top of `primary`. */
  onPrimary: string;
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
  success: string;
  warning: string;
  danger: string;
  /** Scrim behind modals/sheets. */
  overlay: string;
}

export const darkPalette: Palette = {
  bg: '#0B0D10',
  surface: '#151A21',
  surfaceAlt: '#1D242D',
  border: '#2A323D',
  text: '#F2F5F8',
  textMuted: '#9BA6B4',
  /** Dimmest readable grey: still >= 4.5:1 on `bg`, `surface` and `surfaceAlt`. */
  textFaint: '#808C9C',
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
};

export const lightPalette: Palette = {
  bg: '#F4F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EAEFF5',
  border: '#DCE3EC',
  text: '#0B0D10',
  textMuted: '#5A6673',
  /** Dimmest readable grey: still >= 4.5:1 on `bg` and `surface`. */
  textFaint: '#66717F',
  primary: '#16A34A',
  primaryDim: '#15803D',
  onPrimary: '#FFFFFF',
  protein: '#E11D48',
  carbs: '#D97706',
  fat: '#4F46E5',
  calories: '#16A34A',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  overlay: 'rgba(11, 13, 16, 0.45)',
};

export const palettes: Record<ColorScheme, Palette> = {
  light: lightPalette,
  dark: darkPalette,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export type Spacing = typeof spacing;
export type Radius = typeof radius;

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export type TypographyVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'title'
  | 'body'
  | 'label'
  | 'caption'
  | 'mono';

export const typography: Record<TypographyVariant, TextStyle> = {
  h1: { fontSize: 34, fontWeight: '800', lineHeight: 40, letterSpacing: -0.6 },
  h2: { fontSize: 26, fontWeight: '700', lineHeight: 32, letterSpacing: -0.4 },
  h3: { fontSize: 20, fontWeight: '700', lineHeight: 26, letterSpacing: -0.2 },
  title: { fontSize: 17, fontWeight: '600', lineHeight: 22, letterSpacing: -0.1 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21, letterSpacing: 0 },
  label: { fontSize: 13, fontWeight: '600', lineHeight: 17, letterSpacing: 0.2 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16, letterSpacing: 0.2 },
  mono: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    letterSpacing: 0.4,
    fontFamily: MONO_FONT,
  },
};

export type Typography = typeof typography;

export interface Theme {
  colors: Palette;
  spacing: Spacing;
  radius: Radius;
  typography: Typography;
  isDark: boolean;
}

/** Resolves a palette for an explicit scheme. */
export function getPalette(scheme: ColorScheme): Palette {
  return scheme === 'light' ? lightPalette : darkPalette;
}

const HEX_SHORT = /^#?([\da-f])([\da-f])([\da-f])([\da-f])?$/i;
const HEX_LONG = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i;

/**
 * Converts `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA` to `rgba(...)`.
 * Any existing alpha in the hex is multiplied by `alpha`.
 * Non-hex input is returned unchanged so callers can pass through `rgba()` strings.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const safeAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  const value = typeof hex === 'string' ? hex.trim() : '';

  const short = HEX_SHORT.exec(value);
  const long = short ? null : HEX_LONG.exec(value);
  if (!short && !long) return value || `rgba(0, 0, 0, ${safeAlpha})`;

  let r: number;
  let g: number;
  let b: number;
  let a = 1;

  if (short) {
    r = parseInt(short[1] + short[1], 16);
    g = parseInt(short[2] + short[2], 16);
    b = parseInt(short[3] + short[3], 16);
    if (short[4]) a = parseInt(short[4] + short[4], 16) / 255;
  } else {
    const m = long as RegExpExecArray;
    r = parseInt(m[1], 16);
    g = parseInt(m[2], 16);
    b = parseInt(m[3], 16);
    if (m[4]) a = parseInt(m[4], 16) / 255;
  }

  const finalAlpha = Math.round(a * safeAlpha * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
}

/* -------------------------------------------------------------------------- */
/* Store bridge                                                               */
/* -------------------------------------------------------------------------- */

type ThemeSelector = (state: unknown) => ThemeMode | undefined;
type StoreHook = (selector: ThemeSelector) => ThemeMode | undefined;

/**
 * The app store is owned by another module, so it is resolved defensively: if it
 * is missing, throws on import, or changes shape, the theme silently falls back
 * to the OS colour scheme instead of crashing the whole UI tree.
 */
const storeHook: StoreHook | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const mod = require('@/store/appStore') as { useAppStore?: unknown };
    return typeof mod?.useAppStore === 'function' ? (mod.useAppStore as StoreHook) : null;
  } catch {
    return null;
  }
})();

function readThemeMode(state: unknown): ThemeMode | undefined {
  const settings = (state as { settings?: { theme?: unknown } } | null)?.settings;
  const theme = settings?.theme;
  return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : undefined;
}

/** Stable hook identity: chosen once at module load so hook order never changes. */
const useThemeSetting: () => ThemeMode = storeHook
  ? () => {
      try {
        return storeHook(readThemeMode) ?? 'system';
      } catch {
        return 'system';
      }
    }
  : () => 'system';

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

/** Resolved 'light' | 'dark' for the current setting + OS preference. */
export function useColorSchemeResolved(): ColorScheme {
  const mode = useThemeSetting();
  const system = useColorScheme();
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'light' ? 'light' : 'dark';
}

/** The design system entry point used by every component and screen. */
export function useTheme(): Theme {
  const scheme = useColorSchemeResolved();
  return useMemo<Theme>(
    () => ({
      colors: getPalette(scheme),
      spacing,
      radius,
      typography,
      isDark: scheme === 'dark',
    }),
    [scheme]
  );
}

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO_INSETS: SafeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Safe-area insets that degrade to zero when no `SafeAreaProvider` is mounted
 * (tests, storybook-style harnesses) instead of throwing.
 */
export function useSafeInsets(): SafeInsets {
  const insets = useContext(SafeAreaInsetsContext);
  return useMemo<SafeInsets>(
    () =>
      insets
        ? {
            top: insets.top ?? 0,
            bottom: insets.bottom ?? 0,
            left: insets.left ?? 0,
            right: insets.right ?? 0,
          }
        : ZERO_INSETS,
    [insets]
  );
}
