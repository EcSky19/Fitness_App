/**
 * Searchable MET activity list, grouped by category, with a free-text
 * "custom activity" escape hatch.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { MET_ACTIVITIES, searchActivities } from '@/domain';
import { EXERCISE_CATEGORIES, EXERCISE_CATEGORY_LABELS } from '@/types/constants';
import type { ExerciseCategory } from '@/types';
import { Divider, ListRow, SectionHeader, TextField, useTheme } from '@/ui';

import type { MetActivityOption } from './useWorkoutForm';

export interface ActivityPickerProps {
  selectedId: string | null;
  onSelectActivity: (activity: MetActivityOption) => void;
  onSelectCustom: (name: string) => void;
  maxHeight?: number;
}

const CATEGORY_ICONS: Record<ExerciseCategory, 'walk' | 'barbell' | 'football' | 'body' | 'ellipse'> =
  {
    cardio: 'walk',
    strength: 'barbell',
    sports: 'football',
    flexibility: 'body',
    other: 'ellipse',
  };

function allActivities(): MetActivityOption[] {
  return Array.isArray(MET_ACTIVITIES) ? (MET_ACTIVITIES as MetActivityOption[]) : [];
}

function runSearch(query: string): MetActivityOption[] {
  const trimmed = query.trim();
  if (!trimmed) return allActivities();
  try {
    const results = searchActivities(trimmed) as MetActivityOption[] | undefined;
    if (Array.isArray(results)) return results;
  } catch {
    // fall through to a local filter so the picker never dies on a bad query
  }
  const needle = trimmed.toLowerCase();
  return allActivities().filter((a) => a.name.toLowerCase().includes(needle));
}

export function ActivityPicker({
  selectedId,
  onSelectActivity,
  onSelectCustom,
  maxHeight = 360,
}: ActivityPickerProps): React.JSX.Element {
  const { colors, spacing } = useTheme();
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const results = runSearch(query);
    return EXERCISE_CATEGORIES.map((category) => ({
      category,
      items: results.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  const trimmedQuery = query.trim();
  const hasResults = grouped.length > 0;

  return (
    <View>
      <TextField
        label="Find an activity"
        value={query}
        onChangeText={setQuery}
        placeholder="Running, cycling, yoga…"
      />

      <ListRow
        title={trimmedQuery ? `Use "${trimmedQuery}"` : 'Custom activity'}
        subtitle="Name it yourself and set your own calorie burn"
        leftIcon="create-outline"
        leftColor={colors.warning}
        onPress={() => onSelectCustom(trimmedQuery)}
        testID="activity-picker-custom"
      />
      <Divider />

      <ScrollView
        style={[styles.list, { maxHeight }]}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        testID="activity-picker-list"
      >
        {!hasResults ? (
          <View style={{ paddingVertical: spacing.lg }}>
            <SectionHeader title="No matching activities" />
          </View>
        ) : null}
        {grouped.map((group) => (
          <View key={group.category}>
            <SectionHeader title={EXERCISE_CATEGORY_LABELS[group.category]} />
            {group.items.map((item) => (
              <ListRow
                key={item.id}
                title={item.name}
                subtitle={`${item.met} MET`}
                meta={selectedId === item.id ? 'Selected' : undefined}
                leftIcon={CATEGORY_ICONS[group.category]}
                leftColor={colors.primary}
                onPress={() => onSelectActivity(item)}
                testID={`activity-option-${item.id}`}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { width: '100%' },
});

export default ActivityPicker;
