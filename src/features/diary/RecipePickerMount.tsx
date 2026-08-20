import React from 'react';

import { RecipePicker } from '@/features/recipes/RecipePicker';
import { Sheet } from '@/ui';
import type { MealType, Recipe, RecipeKind } from '@/types';

export interface RecipePickerMountProps {
  visible: boolean;
  title: string;
  kind?: RecipeKind;
  date?: string;
  mealType?: MealType;
  onSelectRecipe: (recipe: Recipe) => void;
  onLogged?: () => void;
  onClose: () => void;
}

/**
 * Keeps the diary/search coupling to the recipes feature in one tiny adapter.
 * Assumed picker props are reported with this task for reconciliation.
 */
export function RecipePickerMount(props: RecipePickerMountProps): React.JSX.Element {
  const { visible, title, kind, date, mealType, onSelectRecipe, onLogged, onClose } = props;

  return (
    <Sheet visible={visible} onClose={onClose} title={title} scrollable={false}>
      <RecipePicker
        date={date}
        mealType={mealType}
        initialKind={kind ?? 'all'}
        onSelectRecipe={onSelectRecipe}
        onLogged={() => {
          onLogged?.();
          onClose();
        }}
      />
    </Sheet>
  );
}

export default RecipePickerMount;
