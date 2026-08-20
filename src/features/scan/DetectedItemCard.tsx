import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, Divider, NumberField, TextField, useTheme } from '@/ui';
import type { ServingUnit } from '@/types';

import { ConfidenceBadge } from './ConfidenceBadge';
import {
  calorieCheck,
  PORTION_MULTIPLIERS,
  SERVING_UNITS,
  type MacroKey,
  type ReviewItem,
} from './useScanReview';

export interface DetectedItemCardProps {
  item: ReviewItem;
  index: number;
  onChangeName: (value: string) => void;
  onChangeQuantity: (value: number | null) => void;
  onChangeGrams: (value: number | null) => void;
  onChangeUnit: (unit: ServingUnit) => void;
  onChangeMacro: (key: MacroKey, value: number | null) => void;
  onMultiply: (factor: number) => void;
  onFixCalories: () => void;
  onToggleInclude: () => void;
  onDelete: () => void;
  onOpenInEditor: () => void;
}

/** One detected food, fully correctable in place. */
export function DetectedItemCard({
  item,
  index,
  onChangeName,
  onChangeQuantity,
  onChangeGrams,
  onChangeUnit,
  onChangeMacro,
  onMultiply,
  onFixCalories,
  onToggleInclude,
  onDelete,
  onOpenInEditor,
}: DetectedItemCardProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [showMore, setShowMore] = useState(false);
  const check = calorieCheck(item.macros);

  return (
    <Card style={{ marginBottom: spacing.md }} testID={`item-card-${item.id}`}>
      <View style={styles.headRow}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`${item.included ? 'Exclude' : 'Include'} ${item.name || `item ${index + 1}`}`}
          accessibilityState={{ checked: item.included }}
          hitSlop={8}
          onPress={onToggleInclude}
          style={{ paddingRight: spacing.sm, paddingTop: spacing.sm }}
          testID={`include-toggle-${item.id}`}
        >
          <Ionicons
            name={item.included ? 'checkbox' : 'square-outline'}
            size={24}
            color={item.included ? colors.primary : colors.textFaint}
          />
        </Pressable>

        <View style={styles.nameCol}>
          <TextField
            label={`Item ${index + 1}`}
            value={item.name}
            onChangeText={onChangeName}
            placeholder="Food name"
            error={item.included && item.name.trim().length === 0 ? 'Name is required' : undefined}
          />
        </View>

        <View style={{ marginLeft: spacing.sm, paddingTop: spacing.lg }}>
          {item.original ? (
            <ConfidenceBadge confidence={item.confidence} />
          ) : (
            <Text style={[typography.caption, { color: colors.textMuted }]}>Added by you</Text>
          )}
        </View>
      </View>

      <View
        pointerEvents={item.included ? 'auto' : 'none'}
        // Excluded items are inert, so they must leave the screen-reader tree
        // too — otherwise the fields are still reachable but swallow every tap.
        accessibilityElementsHidden={!item.included}
        importantForAccessibility={item.included ? 'auto' : 'no-hide-descendants'}
        style={item.included ? undefined : styles.excluded}
      >
        {item.notes ? (
          <Text style={[typography.caption, { color: colors.textMuted, marginBottom: spacing.sm }]}>
            {item.notes}
          </Text>
        ) : null}

        <Divider />

        <Text
          style={[typography.label, { color: colors.textMuted, marginTop: spacing.md }]}
        >
          Portion
        </Text>

        <View style={[styles.portionRow, { marginTop: spacing.sm }]}>
          <View style={styles.portionField}>
            <NumberField
              label="Quantity"
              value={item.quantity}
              onChange={onChangeQuantity}
              decimals={2}
              min={0}
            />
          </View>
          <View style={styles.portionField}>
            <NumberField
              label="Grams"
              value={item.grams}
              onChange={onChangeGrams}
              suffix="g"
              decimals={1}
              min={0}
            />
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={{ marginTop: spacing.sm }}
        >
          {SERVING_UNITS.map((unit) => (
            <Chip
              key={unit}
              label={unit}
              selected={item.unit === unit}
              onPress={() => onChangeUnit(unit)}
              testID={`unit-${unit}-${item.id}`}
            />
          ))}
        </ScrollView>

        <View style={[styles.chipRow, { marginTop: spacing.sm }]}>
          {PORTION_MULTIPLIERS.map((multiplier) => (
            <Chip
              key={multiplier.label}
              label={multiplier.label}
              onPress={() => onMultiply(multiplier.factor)}
              testID={`multiplier-${multiplier.factor}-${item.id}`}
            />
          ))}
        </View>

        <Text style={[typography.label, { color: colors.textMuted, marginTop: spacing.lg }]}>
          Macros
        </Text>

        <View style={[styles.macroGrid, { marginTop: spacing.sm }]}>
          <View style={styles.macroField}>
            <NumberField
              label="Calories"
              value={item.macros.calories}
              onChange={(v) => onChangeMacro('calories', v)}
              suffix="kcal"
              min={0}
            />
          </View>
          <View style={styles.macroField}>
            <NumberField
              label="Protein"
              value={item.macros.protein}
              onChange={(v) => onChangeMacro('protein', v)}
              suffix="g"
              decimals={1}
              min={0}
            />
          </View>
          <View style={styles.macroField}>
            <NumberField
              label="Carbs"
              value={item.macros.carbs}
              onChange={(v) => onChangeMacro('carbs', v)}
              suffix="g"
              decimals={1}
              min={0}
            />
          </View>
          <View style={styles.macroField}>
            <NumberField
              label="Fat"
              value={item.macros.fat}
              onChange={(v) => onChangeMacro('fat', v)}
              suffix="g"
              decimals={1}
              min={0}
            />
          </View>
        </View>

        {check.mismatch ? (
          <View style={[styles.mismatch, { marginTop: spacing.sm }]} testID={`mismatch-${item.id}`}>
            <Text style={[typography.caption, { color: colors.warning, flex: 1 }]}>
              {`Macros work out to ${check.expected} kcal (${check.delta > 0 ? '+' : ''}${check.delta} vs entered)`}
            </Text>
            <Button
              title={`Use ${check.expected}`}
              size="sm"
              variant="secondary"
              onPress={onFixCalories}
              testID={`fix-calories-${item.id}`}
            />
          </View>
        ) : null}

        <Button
          title={showMore ? 'Less' : 'More'}
          icon={showMore ? 'chevron-up' : 'chevron-down'}
          size="sm"
          variant="ghost"
          onPress={() => setShowMore((v) => !v)}
          style={{ marginTop: spacing.sm }}
          testID={`more-toggle-${item.id}`}
        />

        {showMore ? (
          <View style={styles.macroGrid} testID={`more-fields-${item.id}`}>
            <View style={styles.macroField}>
              <NumberField
                label="Fiber"
                value={item.macros.fiber ?? null}
                onChange={(v) => onChangeMacro('fiber', v)}
                suffix="g"
                decimals={1}
                min={0}
              />
            </View>
            <View style={styles.macroField}>
              <NumberField
                label="Sugar"
                value={item.macros.sugar ?? null}
                onChange={(v) => onChangeMacro('sugar', v)}
                suffix="g"
                decimals={1}
                min={0}
              />
            </View>
            <View style={styles.macroField}>
              <NumberField
                label="Sodium"
                value={item.macros.sodium ?? null}
                onChange={(v) => onChangeMacro('sodium', v)}
                suffix="mg"
                min={0}
              />
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.actions, { marginTop: spacing.md }]}>
        <Button
          title="Delete item"
          icon="trash-outline"
          size="sm"
          variant="ghost"
          onPress={onDelete}
          testID={`delete-${item.id}`}
        />
        <Button
          title="Open in full editor"
          icon="open-outline"
          size="sm"
          variant="ghost"
          onPress={onOpenInEditor}
          testID={`open-editor-${item.id}`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  excluded: { opacity: 0.4 },
  headRow: { flexDirection: 'row' },
  macroField: { flexGrow: 1, flexShrink: 1, minWidth: 130 },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mismatch: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  nameCol: { flex: 1 },
  portionField: { flexGrow: 1, flexShrink: 1, minWidth: 130 },
  portionRow: { flexDirection: 'row', gap: 8 },
});

export default DetectedItemCard;
