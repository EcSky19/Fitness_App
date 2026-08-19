import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatEnergy, roundTo } from '@/domain';
import { Badge, ListRow, useTheme } from '@/ui';
import type { FoodEntry, MealType } from '@/types';

export interface FoodEntryRowProps {
  entry: FoodEntry;
  onPress?: (entry: FoodEntry) => void;
  onLongPress?: (entry: FoodEntry) => void;
  testID?: string;
}

const MEAL_ICONS: Record<MealType, 'sunny-outline' | 'restaurant-outline' | 'moon-outline' | 'nutrition-outline'> = {
  breakfast: 'sunny-outline',
  lunch: 'restaurant-outline',
  dinner: 'moon-outline',
  snack: 'nutrition-outline',
};

/** `"1 cup (240 g) · P 12 g · C 30 g · F 4 g"` */
export function describeEntry(entry: FoodEntry): string {
  const { protein, carbs, fat } = entry.macros;
  const macros = `P ${roundTo(protein, 0)} g · C ${roundTo(carbs, 0)} g · F ${roundTo(fat, 0)} g`;
  const label = entry.servingLabel?.trim();
  const brand = entry.brand?.trim();
  return [label, brand, macros].filter(Boolean).join(' · ');
}

/** One logged food line inside a meal section. */
export function FoodEntryRow({
  entry,
  onPress,
  onLongPress,
  testID,
}: FoodEntryRowProps): React.JSX.Element {
  const { colors } = useTheme();

  const handlePress = useCallback(() => onPress?.(entry), [entry, onPress]);
  const handleLongPress = useCallback(() => onLongPress?.(entry), [entry, onLongPress]);

  const isAi = entry.source === 'vision' || entry.source === 'label';

  return (
    <ListRow
      testID={testID ?? `entry-row-${entry.id}`}
      title={entry.name}
      subtitle={describeEntry(entry)}
      meta={formatEnergy(entry.macros.calories)}
      leftIcon={MEAL_ICONS[entry.mealType]}
      leftColor={colors.calories}
      onPress={onPress ? handlePress : undefined}
      onLongPress={onLongPress ? handleLongPress : undefined}
      right={
        isAi || entry.photoUri || entry.wasEdited ? (
          <View style={styles.badges}>
            {entry.photoUri ? (
              <Badge testID={`entry-badge-photo-${entry.id}`} label="Photo" tone="neutral" />
            ) : null}
            {isAi ? (
              <Badge
                testID={`entry-badge-ai-${entry.id}`}
                label="AI"
                tone="primary"
                style={styles.badgeGap}
              />
            ) : null}
            {entry.wasEdited ? (
              <Badge
                testID={`entry-badge-edited-${entry.id}`}
                label="Edited"
                tone="neutral"
                style={styles.badgeGap}
              />
            ) : null}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  badgeGap: {
    marginLeft: 4,
  },
  badges: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});

export default FoodEntryRow;
