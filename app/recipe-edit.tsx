import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback } from 'react';

import { RecipeEditForm } from '@/features/recipes';
import { firstParam } from '@/features/recipes/utils';

export default function RecipeEditScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ recipeId?: string; id?: string }>();
  const recipeId = firstParam(params.recipeId) ?? firstParam(params.id);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/recipes');
  }, []);

  return <RecipeEditForm recipeId={recipeId} onDone={close} />;
}
