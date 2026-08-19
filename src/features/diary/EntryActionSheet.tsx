import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Divider, ListRow, Sheet } from '@/ui';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { FoodEntry, MealType } from '@/types';

export interface EntryActionSheetProps {
  visible: boolean;
  entry: FoodEntry | null;
  onClose: () => void;
  onEdit: (entry: FoodEntry) => void;
  onDuplicate: (entry: FoodEntry) => void;
  onCopyToMeal: (entry: FoodEntry, mealType: MealType) => void;
  onDelete: (entry: FoodEntry) => void;
}

/** Long-press menu for a logged entry. */
export function EntryActionSheet({
  visible,
  entry,
  onClose,
  onEdit,
  onDuplicate,
  onCopyToMeal,
  onDelete,
}: EntryActionSheetProps): React.JSX.Element {
  const [pickingMeal, setPickingMeal] = useState(false);

  useEffect(() => {
    if (!visible) setPickingMeal(false);
  }, [visible]);

  const handleEdit = useCallback(() => {
    if (entry) onEdit(entry);
  }, [entry, onEdit]);

  const handleDuplicate = useCallback(() => {
    if (entry) onDuplicate(entry);
  }, [entry, onDuplicate]);

  const handleDelete = useCallback(() => {
    if (entry) onDelete(entry);
  }, [entry, onDelete]);

  return (
    <Sheet visible={visible} onClose={onClose} title={entry?.name ?? 'Entry'}>
      <View testID="entry-action-sheet">
        {pickingMeal ? (
          <>
            {MEAL_TYPES.map((meal) => (
              <View key={meal}>
                <ListRow
                  testID={`entry-action-copy-${meal}`}
                  title={MEAL_LABELS[meal]}
                  leftIcon="arrow-forward-outline"
                  onPress={() => {
                    if (entry) onCopyToMeal(entry, meal);
                  }}
                />
                <Divider />
              </View>
            ))}
            <ListRow title="Back" leftIcon="chevron-back-outline" onPress={() => setPickingMeal(false)} />
          </>
        ) : (
          <>
            <ListRow
              testID="entry-action-edit"
              title="Edit"
              leftIcon="create-outline"
              onPress={handleEdit}
            />
            <Divider />
            <ListRow
              testID="entry-action-duplicate"
              title="Duplicate"
              leftIcon="copy-outline"
              onPress={handleDuplicate}
            />
            <Divider />
            <ListRow
              testID="entry-action-copy"
              title="Copy to another meal"
              leftIcon="swap-horizontal-outline"
              onPress={() => setPickingMeal(true)}
            />
            <Divider />
            <ListRow
              testID="entry-action-delete"
              title="Delete"
              leftIcon="trash-outline"
              destructive
              onPress={handleDelete}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}

export default EntryActionSheet;
