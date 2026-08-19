import { StyleSheet, Text, TextStyle } from 'react-native';

/**
 * Local text scale for the dashboard.
 *
 * `useTheme().typography` exists but its key names are not part of the shared
 * contract, so the dashboard keeps its own explicit scale and only consumes
 * `colors` / `spacing` / `radius` from the theme.
 */
export const text = StyleSheet.create({
  hero: { fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 14, fontWeight: '500' },
  value: { fontSize: 17, fontWeight: '700' },
  caption: { fontSize: 12, fontWeight: '500' },
  micro: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
});

interface DashTextProps {
  style?: TextStyle | TextStyle[];
  color: string;
  variant?: keyof typeof text;
  numberOfLines?: number;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

/** Convenience wrapper so cards stay terse: `<DashText variant="caption" color={...}>`. */
export function DashText({
  style,
  color,
  variant = 'body',
  numberOfLines,
  accessibilityLabel,
  children,
}: DashTextProps) {
  return (
    <Text
      style={[text[variant], { color }, style]}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Text>
  );
}
