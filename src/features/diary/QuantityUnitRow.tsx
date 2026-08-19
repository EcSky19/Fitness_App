import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { roundTo } from '@/domain';
import { unitLabel } from '@/services/foodSearch';
import { Chip, NumberField, useTheme } from '@/ui';
import type { ServingUnit } from '@/types';

export interface QuantityUnitRowProps {
  quantity: number | null;
  onChangeQuantity: (value: number | null) => void;
  unit: ServingUnit;
  units: ServingUnit[];
  onChangeUnit: (unit: ServingUnit) => void;
  gramsTotal: number;
  servingLabel?: string;
  error?: string;
}

/** "How much?" — amount field plus the units that make sense for this item. */
export function QuantityUnitRow({
  quantity,
  onChangeQuantity,
  unit,
  units,
  onChangeUnit,
  gramsTotal,
  servingLabel,
  error,
}: QuantityUnitRowProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  return (
    <View testID="quantity-unit-row">
      <NumberField
        testID="quantity-field"
        label="Amount"
        value={quantity}
        onChange={onChangeQuantity}
        decimals={2}
        min={0}
        placeholder="1"
        suffix={unitLabel(unit, quantity ?? 1)}
      />
      {error ? (
        <Text testID="quantity-error" style={[typography.caption, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.units, { paddingVertical: spacing.sm }]}
      >
        {units.map((option) => (
          <Chip
            key={option}
            testID={`unit-chip-${option}`}
            label={unitLabel(option, quantity ?? 1)}
            selected={option === unit}
            onPress={() => onChangeUnit(option)}
            style={styles.chip}
          />
        ))}
      </ScrollView>

      <Text testID="quantity-summary" style={[typography.caption, { color: colors.textMuted }]}>
        {servingLabel ? `${servingLabel} · ` : ''}
        {roundTo(gramsTotal, 1)} g total
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    marginRight: 8,
  },
  units: {
    flexDirection: 'row',
  },
});

export default QuantityUnitRow;
