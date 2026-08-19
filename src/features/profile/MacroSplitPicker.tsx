import React, { useCallback, useMemo } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { SegmentedControl, useTheme } from '@/ui';
import { MACRO_SPLITS } from '@/domain';
import type { MacroSplitPreset } from '@/types';

const PRESET_ORDER: MacroSplitPreset[] = ['balanced', 'high_protein', 'low_carb', 'keto'];

const PRESET_LABELS: Record<MacroSplitPreset, string> = {
  balanced: 'Balanced',
  high_protein: 'High protein',
  low_carb: 'Low carb',
  keto: 'Keto',
  custom: 'Custom',
};

/** `MACRO_SPLITS` may express ratios as fractions (0.3) or percentages (30). */
export function splitPercents(preset: MacroSplitPreset): { protein: number; carbs: number; fat: number } {
  const split = MACRO_SPLITS[preset] ?? MACRO_SPLITS.balanced;
  const total = split.protein + split.carbs + split.fat;
  const scale = total > 0 && total <= 1.5 ? 100 : 1;
  return {
    protein: Math.round(split.protein * scale),
    carbs: Math.round(split.carbs * scale),
    fat: Math.round(split.fat * scale),
  };
}

export interface MacroSplitPickerProps {
  value: MacroSplitPreset;
  onChange: (preset: MacroSplitPreset) => void;
  /** Shown when the user has manually overridden the macro grams. */
  isCustom?: boolean;
  testID?: string;
}

/** Macro preset chooser backed by `MACRO_SPLITS`. */
export function MacroSplitPicker({
  value,
  onChange,
  isCustom = false,
  testID,
}: MacroSplitPickerProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  const options = useMemo(
    () => PRESET_ORDER.map((preset) => ({ label: PRESET_LABELS[preset], value: preset })),
    []
  );

  const handleChange = useCallback(
    (preset: MacroSplitPreset) => {
      void Haptics.selectionAsync();
      onChange(preset);
    },
    [onChange]
  );

  const pct = splitPercents(value);

  return (
    <View testID={testID}>
      <SegmentedControl<MacroSplitPreset>
        options={options}
        value={value}
        onChange={handleChange}
        size="sm"
        testID="macro-split-control"
      />
      <Text
        style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}
        testID="macro-split-caption"
      >
        {isCustom
          ? `Custom macros — based on ${PRESET_LABELS[value]} (${pct.protein}/${pct.carbs}/${pct.fat})`
          : `${pct.protein}% protein · ${pct.carbs}% carbs · ${pct.fat}% fat`}
      </Text>
    </View>
  );
}
