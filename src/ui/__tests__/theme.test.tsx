import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import {
  darkPalette,
  getPalette,
  hexToRgba,
  lightPalette,
  radius,
  spacing,
  typography,
  useTheme,
} from '@/ui';

function Probe(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Text testID="probe">{`${theme.colors.primary}|${theme.isDark}|${theme.spacing.lg}`}</Text>
  );
}

describe('theme', () => {
  const KEYS = [
    'bg',
    'surface',
    'surfaceAlt',
    'border',
    'text',
    'textMuted',
    'textFaint',
    'primary',
    'primaryDim',
    'onPrimary',
    'protein',
    'carbs',
    'fat',
    'calories',
    'success',
    'warning',
    'danger',
    'overlay',
  ] as const;

  it('defines every colour token in both palettes', () => {
    for (const key of KEYS) {
      expect(typeof darkPalette[key]).toBe('string');
      expect(darkPalette[key].length).toBeGreaterThan(0);
      expect(typeof lightPalette[key]).toBe('string');
      expect(lightPalette[key].length).toBeGreaterThan(0);
    }
  });

  it('keeps macro colours distinct', () => {
    const macros = [darkPalette.protein, darkPalette.carbs, darkPalette.fat];
    expect(new Set(macros).size).toBe(3);
  });

  it('exposes the spacing / radius / typography scales', () => {
    expect(spacing).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
    expect(radius).toEqual({ sm: 8, md: 12, lg: 16, xl: 24, pill: 999 });
    for (const key of ['h1', 'h2', 'h3', 'title', 'body', 'label', 'caption', 'mono'] as const) {
      expect(typeof typography[key].fontSize).toBe('number');
      expect(typography[key].fontWeight).toBeDefined();
      expect(typeof typography[key].lineHeight).toBe('number');
      expect(typography[key].letterSpacing).toBeDefined();
    }
  });

  it('resolves palettes by scheme', () => {
    expect(getPalette('dark')).toBe(darkPalette);
    expect(getPalette('light')).toBe(lightPalette);
  });

  describe('hexToRgba', () => {
    it('converts 6-digit hex', () => {
      expect(hexToRgba('#22C55E', 0.5)).toBe('rgba(34, 197, 94, 0.5)');
    });

    it('converts 3-digit hex', () => {
      expect(hexToRgba('#0f0', 1)).toBe('rgba(0, 255, 0, 1)');
    });

    it('multiplies an existing alpha channel', () => {
      expect(hexToRgba('#00000080', 1)).toBe('rgba(0, 0, 0, 0.502)');
    });

    it('clamps alpha and passes through non-hex input', () => {
      expect(hexToRgba('#FFFFFF', 5)).toBe('rgba(255, 255, 255, 1)');
      expect(hexToRgba('#FFFFFF', -2)).toBe('rgba(255, 255, 255, 0)');
      expect(hexToRgba('rgba(1, 2, 3, 0.4)', 0.5)).toBe('rgba(1, 2, 3, 0.4)');
    });

    it('survives NaN alpha', () => {
      expect(hexToRgba('#000000', Number.NaN)).toBe('rgba(0, 0, 0, 1)');
    });
  });

  it('useTheme returns a usable theme without any provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toBeTruthy();
  });
});
