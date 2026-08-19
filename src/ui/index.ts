/**
 * MacroTrack shared UI kit.
 *
 * Everything screens need lives here:
 *   import { Screen, Card, Button, useTheme, spacing } from '@/ui';
 */

// ---- Design system ----
export {
  darkPalette,
  getPalette,
  hexToRgba,
  lightPalette,
  palettes,
  radius,
  spacing,
  typography,
  useColorSchemeResolved,
  useSafeInsets,
  useTheme,
} from './theme';
export type {
  ColorScheme,
  Palette,
  Radius,
  SafeInsets,
  Spacing,
  Theme,
  ThemeMode,
  Typography,
  TypographyVariant,
} from './theme';

// ---- Components ----
export { Badge } from './components/Badge';
export type { BadgeProps, BadgeTone } from './components/Badge';

export { Button } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button';

export { Card } from './components/Card';
export type { CardProps } from './components/Card';

export { Chip } from './components/Chip';
export type { ChipProps } from './components/Chip';

export { DateStepper, formatDateLabel } from './components/DateStepper';
export type { DateStepperProps } from './components/DateStepper';

export { Divider } from './components/Divider';
export type { DividerProps } from './components/Divider';

export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';

export { KeyboardAvoider } from './components/KeyboardAvoider';
export type { KeyboardAvoiderProps } from './components/KeyboardAvoider';

export { LineChart } from './components/LineChart';
export type { LineChartPoint, LineChartProps, LineChartSeries } from './components/LineChart';

export { ListRow } from './components/ListRow';
export type { ListRowProps } from './components/ListRow';

export { MacroBar } from './components/MacroBar';
export type { MacroBarProps } from './components/MacroBar';

export { NumberField } from './components/NumberField';
export type { NumberFieldProps } from './components/NumberField';

export { ProgressRing } from './components/ProgressRing';
export type { ProgressRingProps } from './components/ProgressRing';

export { Screen } from './components/Screen';
export type { ScreenProps } from './components/Screen';

export { SectionHeader } from './components/SectionHeader';
export type { SectionHeaderProps } from './components/SectionHeader';

export { SegmentedControl } from './components/SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './components/SegmentedControl';

export { Sheet } from './components/Sheet';
export type { SheetProps } from './components/Sheet';

export { StatTile } from './components/StatTile';
export type { StatTileProps } from './components/StatTile';

export { TextField } from './components/TextField';
export type { TextFieldProps } from './components/TextField';
