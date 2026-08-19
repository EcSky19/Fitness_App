/**
 * One row per exercise entry. Manual entries are editable; anything that came
 * from the phone's health app is read-only and can only be removed.
 */
import React, { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { EXERCISE_CATEGORY_LABELS } from '@/types/constants';
import type { EntrySource, ExerciseEntry } from '@/types';
import { Badge, ListRow, useTheme } from '@/ui';

export interface ExerciseEntryRowProps {
  entry: ExerciseEntry;
  onEdit?: (entry: ExerciseEntry) => void;
  onDelete: (entry: ExerciseEntry) => void;
}

export function sourceLabel(source: EntrySource): string {
  if (source === 'healthkit') return 'Apple Health';
  if (source === 'health_connect') return 'Health Connect';
  return 'Manual';
}

export function ExerciseEntryRow({
  entry,
  onEdit,
  onDelete,
}: ExerciseEntryRowProps): React.JSX.Element {
  const { colors } = useTheme();
  const isManual = entry.source === 'manual';
  const label = sourceLabel(entry.source);

  const confirmDelete = useCallback(() => {
    const title = isManual ? 'Delete workout' : 'Delete imported workout';
    const message = isManual
      ? `Remove "${entry.name}" (${Math.round(entry.caloriesBurned)} kcal)? This can't be undone.`
      : `"${entry.name}" came from ${label}. Deleting it here won't remove it from ${label}, and the next sync may import it again.`;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(entry) },
    ]);
  }, [entry, isManual, label, onDelete]);

  const handlePress = useCallback(() => {
    if (isManual) {
      onEdit?.(entry);
      return;
    }
    Alert.alert(
      `From ${label}`,
      'Imported workouts are read-only here. Change them in your health app, then sync again.'
    );
  }, [entry, isManual, label, onEdit]);

  const notes = entry.notes?.trim();
  const subtitleParts = [
    `${Math.round(entry.durationMin)} min`,
    EXERCISE_CATEGORY_LABELS[entry.category],
  ];
  if (notes) subtitleParts.push(notes);

  return (
    <ListRow
      title={entry.name}
      subtitle={subtitleParts.join(' · ')}
      meta={`${Math.round(entry.caloriesBurned)} kcal`}
      leftIcon={isManual ? 'fitness' : 'heart'}
      leftColor={isManual ? colors.primary : colors.protein}
      onPress={handlePress}
      onLongPress={confirmDelete}
      testID={`exercise-entry-${entry.id}`}
      right={
        <View style={styles.right}>
          {isManual ? null : <Badge label={label} tone="neutral" />}
          <Pressable
            onPress={confirmDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${entry.name}`}
            testID={`delete-entry-${entry.id}`}
          >
            <Ionicons name="trash-outline" size={18} color={colors.textFaint} />
          </Pressable>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

export default ExerciseEntryRow;
