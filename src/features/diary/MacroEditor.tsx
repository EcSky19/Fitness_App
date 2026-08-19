import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatEnergy } from '@/domain';
import { Button, NumberField, useTheme } from '@/ui';
import type { Macros } from '@/types';

import type { CalorieCheck, MacroKey } from './useEntryDraft';

export interface MacroEditorProps {
  macros: Macros;
  onChange: (key: MacroKey, value: number | null) => void;
  calories: CalorieCheck;
  onUseComputed: () => void;
  error?: string;
}

/**
 * Every nutrition value is editable here — this is how the user corrects a
 * vision estimate. Calories are never rewritten automatically: a disagreement
 * with the 4/4/9 maths is only ever *offered* as a one-tap fix.
 */
export function MacroEditor({
  macros,
  onChange,
  calories,
  onUseComputed,
  error,
}: MacroEditorProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [showMore, setShowMore] = useState(false);

  return (
    <View testID="macro-editor">
      <NumberField
        testID="macro-calories"
        label="Calories"
        value={macros.calories}
        onChange={(value) => onChange('calories', value)}
        suffix="kcal"
        min={0}
        placeholder="0"
      />

      <Text
        testID="macro-computed-hint"
        style={[typography.caption, styles.hint, { color: colors.textMuted }]}
      >
        From macros: {formatEnergy(calories.computed)}
      </Text>

      {calories.isMismatch ? (
        <View
          testID="calorie-mismatch"
          style={[
            styles.warning,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.warning, padding: spacing.md },
          ]}
        >
          <Text style={[typography.caption, styles.warningText, { color: colors.warning }]}>
            Calories are {calories.delta > 0 ? 'higher' : 'lower'} than protein, carbs and fat
            suggest ({formatEnergy(calories.computed)}).
          </Text>
          <Button
            testID="use-computed-calories"
            title={`Use ${calories.computed} kcal`}
            variant="secondary"
            size="sm"
            onPress={onUseComputed}
          />
        </View>
      ) : null}

      <View style={[styles.row, { marginTop: spacing.md }]}>
        <View style={styles.cell}>
          <NumberField
            testID="macro-protein"
            label="Protein"
            value={macros.protein}
            onChange={(value) => onChange('protein', value)}
            suffix="g"
            decimals={1}
            min={0}
            placeholder="0"
          />
        </View>
        <View style={[styles.cell, styles.cellGap]}>
          <NumberField
            testID="macro-carbs"
            label="Carbs"
            value={macros.carbs}
            onChange={(value) => onChange('carbs', value)}
            suffix="g"
            decimals={1}
            min={0}
            placeholder="0"
          />
        </View>
        <View style={[styles.cell, styles.cellGap]}>
          <NumberField
            testID="macro-fat"
            label="Fat"
            value={macros.fat}
            onChange={(value) => onChange('fat', value)}
            suffix="g"
            decimals={1}
            min={0}
            placeholder="0"
          />
        </View>
      </View>

      {error ? (
        <Text testID="macro-error" style={[typography.caption, styles.hint, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}

      <Button
        testID="macro-toggle-more"
        title={showMore ? 'Hide fiber, sugar & sodium' : 'More (fiber, sugar, sodium)'}
        variant="ghost"
        size="sm"
        icon={showMore ? 'chevron-up-outline' : 'chevron-down-outline'}
        onPress={() => setShowMore((value) => !value)}
      />

      {showMore ? (
        <View style={styles.row} testID="macro-more">
          <View style={styles.cell}>
            <NumberField
              testID="macro-fiber"
              label="Fiber"
              value={macros.fiber ?? 0}
              onChange={(value) => onChange('fiber', value)}
              suffix="g"
              decimals={1}
              min={0}
              placeholder="0"
            />
          </View>
          <View style={[styles.cell, styles.cellGap]}>
            <NumberField
              testID="macro-sugar"
              label="Sugar"
              value={macros.sugar ?? 0}
              onChange={(value) => onChange('sugar', value)}
              suffix="g"
              decimals={1}
              min={0}
              placeholder="0"
            />
          </View>
          <View style={[styles.cell, styles.cellGap]}>
            <NumberField
              testID="macro-sodium"
              label="Sodium"
              value={macros.sodium ?? 0}
              onChange={(value) => onChange('sodium', value)}
              suffix="mg"
              min={0}
              placeholder="0"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
  },
  cellGap: {
    marginLeft: 8,
  },
  hint: {
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
  },
  warning: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  warningText: {
    marginBottom: 8,
  },
});

export default MacroEditor;
