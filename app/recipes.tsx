import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback } from 'react';
import { Alert } from 'react-native';

import { RecipePicker } from '@/features/recipes';
import { normalizeDateParam, normalizeMealParam } from '@/features/recipes/utils';
import { useAppStore } from '@/store/appStore';
import { Screen } from '@/ui';
import type { Recipe } from '@/types';

export default function RecipesScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ date?: string; mealType?: string }>();
  const selectedDate = useAppStore((s) => s.selectedDate);
  const date = normalizeDateParam(params.date) ?? selectedDate;
  const mealType = normalizeMealParam(params.mealType) ?? 'breakfast';

  const editRecipe = useCallback((recipe: Recipe) => {
    router.push({ pathname: '/recipe-edit', params: { recipeId: recipe.id } });
  }, []);

  return (
    <Screen
      title="Saved meals & recipes"
      subtitle="Log your everyday meals in one tap, or split batch recipes into servings."
      padded
      scrollable={false}
      headerRight={null}
    >
      <RecipePicker
        date={date}
        mealType={mealType}
        onCreateRecipe={() => router.push('/recipe-edit')}
        onSelectRecipe={editRecipe}
        onEditRecipe={editRecipe}
        onLogged={({ recipe, entries }) => {
          Alert.alert('Added to diary', `${recipe.name} added ${entries.length} entries.`);
        }}
      />
    </Screen>
  );
}
