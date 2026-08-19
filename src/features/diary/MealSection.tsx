import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatEnergy } from '@/domain';
import { Button, Card, Divider, useTheme } from '@/ui';
import { MEAL_LABELS } from '@/types/constants';
import type { FoodEntry, MealType } from '@/types';

import { FoodEntryRow } from './FoodEntryRow';

export interface MealSectionProps {
  mealType: MealType;
  entries: FoodEntry[];
  /** Total kcal for this meal (comes from the day summary). */
  calories: number;
  onAdd: (mealType: MealType) => void;
  onPressEntry: (entry: FoodEntry) => void;
  onLongPressEntry: (entry: FoodEntry) => void;
  /** Number of entries logged for the same meal yesterday. */
  yesterdayCount?: number;
  onCopyYesterday?: (mealType: MealType) => void;
}

/** One meal block: header with totals and a "+", then its entries. */
export function MealSection({
  mealType,
  entries,
  calories,
  onAdd,
  onPressEntry,
  onLongPressEntry,
  yesterdayCount = 0,
  onCopyYesterday,
}: MealSectionProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const label = MEAL_LABELS[mealType];

  const handleAdd = useCallback(() => onAdd(mealType), [mealType, onAdd]);
  const handleCopy = useCallback(() => onCopyYesterday?.(mealType), [mealType, onCopyYesterday]);

  return (
    <Card padded={false} testID={`meal-section-${mealType}`} style={styles.card}>
      <View style={[styles.header, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}>
        <View style={styles.headerText}>
          <Text style={[typography.title, { color: colors.text }]}>{label}</Text>
          <Text testID={`meal-total-${mealType}`} style={[typography.caption, { color: colors.textMuted }]}>
            {formatEnergy(calories)}
          </Text>
        </View>
        <Pressable
          testID={`meal-add-${mealType}`}
          accessibilityRole="button"
          accessibilityLabel={`Add food to ${label}`}
          onPress={handleAdd}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[typography.title, { color: colors.primary }]}>＋</Text>
        </Pressable>
      </View>

      <Divider />

      {entries.length === 0 ? (
        <View style={[styles.empty, { padding: spacing.lg }]}>
          <Text style={[typography.body, { color: colors.textFaint }]}>
            Nothing logged for {label.toLowerCase()} yet.
          </Text>
          {yesterdayCount > 0 && onCopyYesterday ? (
            <Button
              testID={`meal-copy-yesterday-${mealType}`}
              title={`Copy yesterday's ${label.toLowerCase()}`}
              icon="copy-outline"
              variant="ghost"
              size="sm"
              onPress={handleCopy}
              style={styles.copyButton}
            />
          ) : null}
        </View>
      ) : (
        entries.map((entry, index) => (
          <View key={entry.id}>
            {index > 0 ? <Divider /> : null}
            <FoodEntryRow entry={entry} onPress={onPressEntry} onLongPress={onLongPressEntry} />
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  card: {
    marginTop: 12,
  },
  copyButton: {
    marginTop: 4,
  },
  empty: {
    alignItems: 'flex-start',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});

export default MealSection;
