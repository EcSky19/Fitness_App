import { Ionicons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { formatEnergy, roundTo, scaleMacros } from '@/domain';
import { ListRow, useTheme } from '@/ui';
import type { Food } from '@/types';

export interface FoodSearchResultRowProps {
  food: Food;
  onPress: (food: Food) => void;
  onToggleFavorite?: (food: Food) => void;
}

/** kcal for one serving of `food` (falls back to per-100 g). */
export function caloriesPerServing(food: Food): number {
  const grams = food.servingSizeG > 0 ? food.servingSizeG : 100;
  const scaled = scaleMacros(food.per100g, grams) as { calories?: number } | undefined;
  return roundTo(scaled?.calories ?? food.per100g.calories, 0);
}

export function servingSummary(food: Food): string {
  const label = food.servingLabel?.trim() || `${roundTo(food.servingSizeG || 100, 0)} g`;
  return `${formatEnergy(caloriesPerServing(food))} per ${label}`;
}

/** A single search / recent / favorite result. */
export function FoodSearchResultRow({
  food,
  onPress,
  onToggleFavorite,
}: FoodSearchResultRowProps): React.JSX.Element {
  const { colors } = useTheme();

  const handlePress = useCallback(() => onPress(food), [food, onPress]);
  const handleFavorite = useCallback(() => onToggleFavorite?.(food), [food, onToggleFavorite]);

  return (
    <ListRow
      testID={`food-result-${food.id}`}
      title={food.name}
      subtitle={food.brand?.trim() || servingSummary(food)}
      meta={food.brand?.trim() ? servingSummary(food) : undefined}
      leftIcon="fast-food-outline"
      onPress={handlePress}
      right={
        onToggleFavorite ? (
          <Pressable
            testID={`food-favorite-${food.id}`}
            accessibilityRole="button"
            accessibilityLabel={
              food.isFavorite ? `Remove ${food.name} from favorites` : `Add ${food.name} to favorites`
            }
            accessibilityState={{ selected: food.isFavorite }}
            hitSlop={10}
            onPress={handleFavorite}
            style={styles.star}
          >
            <Ionicons
              name={food.isFavorite ? 'star' : 'star-outline'}
              size={20}
              color={food.isFavorite ? colors.warning : colors.textFaint}
            />
          </Pressable>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  star: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
});

export default FoodSearchResultRow;
