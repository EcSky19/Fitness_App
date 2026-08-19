import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  addFoodEntries,
  addFoodEntry,
  deleteFoodEntry,
  getActiveGoal,
  listEntriesByDate,
  listExercisesByDate,
} from '@/db/repositories';
import { addDaysISO, buildDailySummary } from '@/domain';
import { DayTotalsHeader } from '@/features/diary/DayTotalsHeader';
import { EntryActionSheet } from '@/features/diary/EntryActionSheet';
import { MealSection } from '@/features/diary/MealSection';
import type { NewFoodEntry } from '@/features/diary/useEntryDraft';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useAppStore } from '@/store/appStore';
import { DateStepper, Divider, EmptyState, ListRow, Screen, Sheet, useTheme } from '@/ui';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { ExerciseEntry, FoodEntry, ISODate, MacroTargets, MealType } from '@/types';

/** Used only until the user has an active goal. */
const FALLBACK_TARGETS: MacroTargets = { calories: 2000, protein: 150, carbs: 200, fat: 67 };

interface DiaryData {
  entries: FoodEntry[];
  exercises: ExerciseEntry[];
  targets: MacroTargets;
  yesterday: FoodEntry[];
}

const EMPTY_DATA: DiaryData = {
  entries: [],
  exercises: [],
  targets: FALLBACK_TARGETS,
  yesterday: [],
};

/** Strips the persistence-owned fields so an entry can be re-inserted. */
function cloneEntry(entry: FoodEntry, overrides: Partial<NewFoodEntry> = {}): NewFoodEntry {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = entry;
  return { ...rest, loggedAt: new Date().toISOString(), ...overrides };
}

function groupByMeal(entries: FoodEntry[]): Record<MealType, FoodEntry[]> {
  const grouped: Record<MealType, FoodEntry[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  for (const entry of entries) {
    (grouped[entry.mealType] ?? grouped.snack).push(entry);
  }
  return grouped;
}

export default function DiaryScreen(): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const selectedDate = useAppStore((s) => s.selectedDate);
  const setSelectedDate = useAppStore((s) => s.setSelectedDate);
  const invalidate = useAppStore((s) => s.invalidate);
  const storeGoal = useAppStore((s) => s.goal);
  const addExerciseToTarget = useAppStore((s) => s.settings.addExerciseToTarget);

  const [actionEntry, setActionEntry] = useState<FoodEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const previousDate: ISODate = addDaysISO(selectedDate, -1);

  const load = useCallback(async (): Promise<DiaryData> => {
    const [entries, exercises, goal, yesterday] = await Promise.all([
      Promise.resolve(listEntriesByDate(selectedDate)).catch(() => [] as FoodEntry[]),
      Promise.resolve(listExercisesByDate(selectedDate)).catch(() => [] as ExerciseEntry[]),
      Promise.resolve(getActiveGoal()).catch(() => null),
      Promise.resolve(listEntriesByDate(previousDate)).catch(() => [] as FoodEntry[]),
    ]);
    return {
      entries: entries ?? [],
      exercises: exercises ?? [],
      targets: goal?.targets ?? storeGoal?.targets ?? FALLBACK_TARGETS,
      yesterday: yesterday ?? [],
    };
  }, [previousDate, selectedDate, storeGoal]);

  const { data, loading, reload } = useAsyncData<DiaryData>(load, [selectedDate], EMPTY_DATA);
  const diary = data ?? EMPTY_DATA;

  useEffect(() => {
    // `useAsyncData` only raises `loading` for a dep set it has never loaded, so
    // a refresh of the current day is only observable through new `data`.
    if (!loading) setRefreshing(false);
  }, [data, loading]);

  const summary = useMemo(
    () =>
      buildDailySummary({
        date: selectedDate,
        entries: diary.entries,
        exercises: diary.exercises,
        targets: diary.targets,
        addExerciseToTarget,
      }),
    [addExerciseToTarget, diary.entries, diary.exercises, diary.targets, selectedDate]
  );

  const byMeal = useMemo(() => groupByMeal(diary.entries), [diary.entries]);
  const yesterdayByMeal = useMemo(() => groupByMeal(diary.yesterday), [diary.yesterday]);

  const afterWrite = useCallback(() => {
    invalidate();
    reload();
  }, [invalidate, reload]);

  /** Runs a diary write, refreshes on success and never fails silently. */
  const runWrite = useCallback(
    (write: () => Promise<unknown>) => {
      void (async () => {
        try {
          await write();
          afterWrite();
        } catch (error) {
          Alert.alert(
            'Could not update your diary',
            error instanceof Error ? error.message : 'Please try again.'
          );
        }
      })();
    },
    [afterWrite]
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    reload();
  }, [reload]);

  const handleAdd = useCallback(
    (mealType: MealType) => {
      router.push({ pathname: '/food-search', params: { date: selectedDate, mealType } });
    },
    [selectedDate]
  );

  const handlePressEntry = useCallback((entry: FoodEntry) => {
    router.push({ pathname: '/food-edit', params: { entryId: entry.id } });
  }, []);

  const handleLongPressEntry = useCallback((entry: FoodEntry) => {
    setActionEntry(entry);
  }, []);

  const handleScan = useCallback(() => {
    setMenuOpen(false);
    router.push({ pathname: '/scan', params: { date: selectedDate } });
  }, [selectedDate]);

  const handleQuickAdd = useCallback(() => {
    setMenuOpen(false);
    router.push({
      pathname: '/food-edit',
      params: { quickAdd: '1', date: selectedDate, mealType: 'snack' },
    });
  }, [selectedDate]);

  const handleEditFromSheet = useCallback((entry: FoodEntry) => {
    setActionEntry(null);
    router.push({ pathname: '/food-edit', params: { entryId: entry.id } });
  }, []);

  const handleDuplicate = useCallback(
    (entry: FoodEntry) => {
      setActionEntry(null);
      runWrite(() => addFoodEntry(cloneEntry(entry)));
    },
    [runWrite]
  );

  const handleCopyToMeal = useCallback(
    (entry: FoodEntry, mealType: MealType) => {
      setActionEntry(null);
      runWrite(() => addFoodEntry(cloneEntry(entry, { mealType })));
    },
    [runWrite]
  );

  const handleDelete = useCallback(
    (entry: FoodEntry) => {
      setActionEntry(null);
      Alert.alert('Delete entry', `Remove "${entry.name}" from your diary?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            runWrite(() => deleteFoodEntry(entry.id));
          },
        },
      ]);
    },
    [runWrite]
  );

  const copyEntries = useCallback(
    (entries: FoodEntry[], mealType?: MealType) => {
      if (entries.length === 0) return;
      runWrite(() =>
        addFoodEntries(
          entries.map((entry) =>
            cloneEntry(entry, { date: selectedDate, ...(mealType ? { mealType } : null) })
          )
        )
      );
    },
    [runWrite, selectedDate]
  );

  const handleCopyYesterdayMeal = useCallback(
    (mealType: MealType) => {
      copyEntries(yesterdayByMeal[mealType], mealType);
    },
    [copyEntries, yesterdayByMeal]
  );

  const handleCopyDay = useCallback(() => {
    setMenuOpen(false);
    copyEntries(diary.yesterday);
  }, [copyEntries, diary.yesterday]);

  return (
    <Screen scrollable refreshing={refreshing} onRefresh={handleRefresh}>
      <View style={styles.dateRow}>
        <View style={styles.dateStepper}>
          <DateStepper date={selectedDate} onChange={setSelectedDate} />
        </View>
        <Pressable
          testID="diary-menu-button"
          accessibilityRole="button"
          accessibilityLabel="Diary options"
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [
            styles.menuButton,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            pressed ? styles.pressed : null,
          ]}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
        </Pressable>
      </View>

      <DayTotalsHeader summary={summary} />

      {diary.entries.length === 0 && !loading ? (
        <View style={{ marginTop: spacing.md }}>
          <EmptyState
            testID="diary-empty"
            icon="restaurant-outline"
            title="Nothing logged yet"
            message="Snap a photo of your plate and let MacroTrack estimate the macros, or add food to a meal below."
            actionLabel="Scan food"
            onAction={handleScan}
          />
        </View>
      ) : null}

      {MEAL_TYPES.map((mealType) => (
        <MealSection
          key={mealType}
          mealType={mealType}
          entries={byMeal[mealType]}
          calories={summary.byMeal?.[mealType]?.calories ?? 0}
          onAdd={handleAdd}
          onPressEntry={handlePressEntry}
          onLongPressEntry={handleLongPressEntry}
          yesterdayCount={yesterdayByMeal[mealType].length}
          onCopyYesterday={handleCopyYesterdayMeal}
        />
      ))}

      <Text style={[typography.caption, styles.hint, { color: colors.textFaint }]}>
        Tip: long-press an entry to duplicate, move or delete it.
      </Text>

      <EntryActionSheet
        visible={actionEntry !== null}
        entry={actionEntry}
        onClose={() => setActionEntry(null)}
        onEdit={handleEditFromSheet}
        onDuplicate={handleDuplicate}
        onCopyToMeal={handleCopyToMeal}
        onDelete={handleDelete}
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Diary options">
        <View testID="diary-menu-sheet">
          <ListRow
            testID="diary-menu-copy-day"
            title="Copy yesterday's day"
            subtitle={
              diary.yesterday.length > 0
                ? `${diary.yesterday.length} entries from ${previousDate}`
                : 'Nothing logged yesterday'
            }
            leftIcon="copy-outline"
            onPress={diary.yesterday.length > 0 ? handleCopyDay : undefined}
          />
          <Divider />
          <ListRow
            testID="diary-menu-scan"
            title="Scan food"
            subtitle="Estimate macros from a photo"
            leftIcon="camera-outline"
            onPress={handleScan}
          />
          <Divider />
          <ListRow
            testID="diary-menu-quick-add"
            title="Quick add"
            subtitle={`Log calories to ${MEAL_LABELS.snack.toLowerCase()}`}
            leftIcon="flash-outline"
            onPress={handleQuickAdd}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dateRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  dateStepper: {
    flex: 1,
  },
  hint: {
    marginTop: 16,
    textAlign: 'center',
  },
  menuButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: 'center',
    marginLeft: 8,
    width: 36,
  },
  pressed: {
    opacity: 0.6,
  },
});
