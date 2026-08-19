import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { hexToRgba, typography, useTheme } from '../theme';

export interface ProgressRingProps {
  /** 0..1 for the main arc. Values above 1 draw an overflow arc in `danger`. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  /** Big centred value. Ignored when `children` is provided. */
  label?: string;
  /** Small centred caption under `label`. Ignored when `children` is provided. */
  sublabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Absolutely centred custom content; overrides `label`/`sublabel`. */
  children?: React.ReactNode;
}

function safeNumber(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Circular progress arc starting at 12 o'clock and sweeping clockwise. */
export function ProgressRing({
  progress,
  size = 132,
  strokeWidth = 12,
  color,
  trackColor,
  label,
  sublabel,
  style,
  testID,
  children,
}: ProgressRingProps): React.JSX.Element {
  const { colors } = useTheme();

  const dim = Math.max(24, safeNumber(size, 132));
  const stroke = Math.max(1, Math.min(dim / 2 - 1, safeNumber(strokeWidth, 12)));
  const radiusPx = Math.max(1, (dim - stroke) / 2);
  const circumference = 2 * Math.PI * radiusPx;

  const value = Math.max(0, safeNumber(progress, 0));
  const mainFraction = Math.min(1, value);
  const overflowFraction = Math.min(1, Math.max(0, value - 1));

  const arcColor = color ?? colors.primary;
  const track = trackColor ?? hexToRgba(colors.text, 0.1);
  const center = dim / 2;

  // Custom children own their own announcement (they usually carry richer copy),
  // so the ring only exposes itself as a progressbar in label/sublabel mode.
  const percent = Math.round(value * 100);
  const a11y = children
    ? null
    : {
        accessible: true,
        accessibilityRole: 'progressbar' as const,
        accessibilityLabel: [label, sublabel].filter(Boolean).join(' ') || 'Progress',
        accessibilityValue: {
          min: 0,
          max: 100,
          now: Math.min(100, percent),
          text: `${percent}%`,
        },
      };

  return (
    <View testID={testID} {...a11y} style={[{ width: dim, height: dim }, style]}>
      <Svg width={dim} height={dim}>
        <G rotation={-90} origin={`${center}, ${center}`}>
          <Circle
            cx={center}
            cy={center}
            r={radiusPx}
            stroke={track}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={radiusPx}
            stroke={arcColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - mainFraction)}
            fill="none"
          />
          {overflowFraction > 0 ? (
            <Circle
              cx={center}
              cy={center}
              r={radiusPx}
              stroke={colors.danger}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference * (1 - overflowFraction)}
              fill="none"
            />
          ) : null}
        </G>
      </Svg>

      <View pointerEvents="box-none" style={styles.center}>
        {children ?? (
          <>
            {label ? (
              <Text numberOfLines={1} style={[typography.h2, { color: colors.text }]}>
                {label}
              </Text>
            ) : null}
            {sublabel ? (
              <Text numberOfLines={1} style={[typography.caption, { color: colors.textMuted }]}>
                {sublabel}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ProgressRing;
