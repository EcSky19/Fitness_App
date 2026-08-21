import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';

import {
  addFoodEntry,
  bumpFoodUsage,
  listFavoriteFoods,
  listRecentFoods,
  logRecipe,
  toggleFavoriteFood,
} from '@/db/repositories';
import { CustomFoodSheet } from '@/features/diary/CustomFoodSheet';
import { FoodSearchResultRow } from '@/features/diary/FoodSearchResultRow';
import { RecipePickerMount } from '@/features/diary/RecipePickerMount';
import {
  inferMealType,
  normalizeDateParam,
  normalizeMealParam,
} from '@/features/diary/useEntryDraft';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ensureFoodsSeeded, scaleFoodToEntry, searchAllFoods } from '@/services/foodSearch';
import { useAppStore } from '@/store/appStore';
import {
  Button,
  Divider,
  EmptyState,
  ListRow,
  Screen,
  SegmentedControl,
  TextField,
  useTheme,
} from '@/ui';
import { MEAL_LABELS } from '@/types/constants';
import type { Food, ID, Recipe } from '@/types';

type SearchTab = 'all' | 'recent' | 'favorites';

const TAB_OPTIONS: { label: string; value: SearchTab }[] = [
  { label: 'All', value: 'all' },
  { label: 'Recent', value: 'recent' },
  { label: 'Favorites', value: 'favorites' },
];

const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 40;

/** The seed import must happen once per app session, never once per mount. */
let seedPromise: Promise<unknown> | null = null;
function seedFoodsOnce(): Promise<unknown> {
  if (!seedPromise) {
    seedPromise = Promise.resolve()
      .then(() => ensureFoodsSeeded())
      .catch(() => 0);
  }
  return seedPromise;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function FoodSearchScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ date?: string; mealType?: string }>();
  const { colors, spacing } = useTheme();
  const selectedDate = useAppStore((s) => s.selectedDate);
  const invalidate = useAppStore((s) => s.invalidate);

  const date = normalizeDateParam(params.date) ?? selectedDate;
  const mealType = normalizeMealParam(params.mealType) ?? inferMealType();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const writeInFlightRef = useRef(false);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();

  useEffect(() => {
    let cancelled = false;
    void seedFoodsOnce().then(() => {
      if (!cancelled) setSeeded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (): Promise<Food[]> => {
    if (tab === 'recent') return (await listRecentFoods(RESULT_LIMIT)) ?? [];
    if (tab === 'favorites') return (await listFavoriteFoods()) ?? [];
    return (await searchAllFoods(trimmedQuery, RESULT_LIMIT)) ?? [];
  }, [tab, trimmedQuery]);

  const { data, loading, error: loadError } = useAsyncData<Food[]>(
    load,
    [tab, trimmedQuery, seeded],
    []
  );
  const results = useMemo(() => data ?? [], [data]);
  const searching = loading || query.trim() !== trimmedQuery;

  const dismiss = useCallback(() => {
    // Deep links and restored modals can open this picker with nothing behind
    // it; `back()` is then a no-op that would strand the user here after their
    // food has already been logged.
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/diary');
  }, []);

  const runWrite = useCallback(
    (write: () => Promise<unknown>) => {
      if (writeInFlightRef.current) return;
      writeInFlightRef.current = true;
      void (async () => {
        try {
          await write();
          invalidate();
          dismiss();
        } catch (error) {
          Alert.alert('Could not log food', error instanceof Error ? error.message : 'Please try again.');
        } finally {
          writeInFlightRef.current = false;
        }
      })();
    },
    [invalidate, dismiss]
  );

  const logFoodNow = useCallback(
    (food: Food) => {
      const scaled = scaleFoodToEntry(food, 1, 'serving');
      const foodId = food.id.startsWith('seed:') ? null : food.id;
      runWrite(async () => {
        await addFoodEntry({
          date,
          mealType,
          foodId,
          name: food.name,
          brand: food.brand ?? null,
          quantity: 1,
          unit: 'serving',
          servingLabel: scaled.servingLabel,
          gramsTotal: scaled.gramsTotal,
          macros: scaled.macros,
          photoUri: null,
          source: food.source === 'seed' ? 'custom' : food.source,
          visionConfidence: null,
          wasEdited: false,
          loggedAt: new Date().toISOString(),
        });
        if (foodId) {
          try {
            await bumpFoodUsage(foodId);
          } catch {
            // Usage stats are best effort; never fail a one-tap log because of them.
          }
        }
      });
    },
    [date, mealType, runWrite]
  );

  const handleSelect = useCallback(
    (food: Food) => {
      if (tab !== 'all') {
        logFoodNow(food);
        return;
      }
      router.push({ pathname: '/food-edit', params: { foodId: food.id, date, mealType } });
    },
    [date, logFoodNow, mealType, tab]
  );

  const handleToggleFavorite = useCallback(
    (food: Food) => {
      void (async () => {
        try {
          await toggleFavoriteFood(food.id);
        } finally {
          invalidate();
        }
      })();
    },
    [invalidate]
  );

  const handleScan = useCallback(() => {
    router.push({ pathname: '/scan', params: { date, mealType } });
  }, [date, mealType]);

  const handleQuickAdd = useCallback(() => {
    router.push({ pathname: '/food-edit', params: { quickAdd: '1', date, mealType } });
  }, [date, mealType]);

  const handleCreated = useCallback(
    (foodId: ID | null) => {
      setSheetOpen(false);
      invalidate();
      if (foodId) {
        router.push({ pathname: '/food-edit', params: { foodId, date, mealType } });
      }
    },
    [date, invalidate, mealType]
  );

  const handleLogRecipe = useCallback(
    (recipe: Recipe) => {
      setRecipePickerOpen(false);
      runWrite(() => logRecipe({ recipeId: recipe.id, date, mealType }));
    },
    [date, mealType, runWrite]
  );

  const emptyMessage =
    tab === 'recent'
      ? 'Foods you log will show up here for one-tap re-logging.'
      : tab === 'favorites'
        ? 'Star a food while searching to pin it here.'
        : trimmedQuery
          ? 'Nothing matched. Create it once and it is yours forever.'
          : 'Search thousands of foods, or scan a plate to estimate macros.';

  return (
    <Screen padded={false}>
      <View style={[styles.header, { padding: spacing.lg, backgroundColor: colors.bg }]}>
        <TextField
          testID="food-search-input"
          value={query}
          onChangeText={setQuery}
          placeholder={`Search foods for ${MEAL_LABELS[mealType].toLowerCase()}`}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          right={
            searching ? (
              <ActivityIndicator
                testID="search-spinner"
                accessibilityLabel={`Searching foods for ${MEAL_LABELS[mealType].toLowerCase()}`}
                size="small"
              />
            ) : undefined
          }
        />

        <View style={[styles.actions, { marginTop: spacing.md }]}>
          <Button
            testID="food-search-scan"
            title="Scan"
            icon="camera-outline"
            variant="secondary"
            size="sm"
            accessibilityLabel={`Scan food for ${MEAL_LABELS[mealType].toLowerCase()}`}
            onPress={handleScan}
          />
          <View style={styles.actionGap} />
          <Button
            testID="food-search-recipes"
            title="Saved meals"
            icon="albums-outline"
            variant="secondary"
            size="sm"
            accessibilityLabel={`Open saved meals for ${MEAL_LABELS[mealType].toLowerCase()}`}
            onPress={() => setRecipePickerOpen(true)}
          />
          <View style={styles.actionGap} />
          <Button
            testID="food-search-quick-add"
            title="Quick add"
            icon="flash-outline"
            variant="secondary"
            size="sm"
            accessibilityLabel={`Quick add food for ${MEAL_LABELS[mealType].toLowerCase()}`}
            onPress={handleQuickAdd}
          />
        </View>

        <View style={{ marginTop: spacing.md }}>
          <SegmentedControl<SearchTab> options={TAB_OPTIONS} value={tab} onChange={setTab} />
        </View>
      </View>

      <Divider />

      <View style={styles.list}>
        <FlatList
          testID="food-search-results"
          accessibilityLabel={`Food search results for ${MEAL_LABELS[mealType].toLowerCase()}`}
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={Divider}
          renderItem={({ item }) => (
            <FoodSearchResultRow
              food={item}
              onPress={handleSelect}
              onToggleFavorite={handleToggleFavorite}
            />
          )}
          ListEmptyComponent={
            searching ? null : loadError ? (
              <EmptyState
                testID="food-search-error"
                icon="alert-circle-outline"
                title="Could not search your foods"
                message="Something went wrong reading the food database. Pull down or try again in a moment."
              />
            ) : (
              <EmptyState
                testID="food-search-empty"
                icon="search-outline"
                title={trimmedQuery ? `No matches for "${trimmedQuery}"` : 'Start typing'}
                message={emptyMessage}
                actionLabel={trimmedQuery ? `Create "${trimmedQuery}"` : 'Quick add'}
                onAction={trimmedQuery ? () => setSheetOpen(true) : handleQuickAdd}
              />
            )
          }
          ListFooterComponent={
            <View>
              <Divider />
              <ListRow
                testID="food-search-create-custom"
                title="Create custom food"
                subtitle="Add your own recipe or packet"
                leftIcon="add-circle-outline"
                onPress={() => setSheetOpen(true)}
              />
            </View>
          }
        />
      </View>

      <CustomFoodSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        initialName={trimmedQuery}
        onCreated={handleCreated}
      />
      <RecipePickerMount
        visible={recipePickerOpen}
        title={`Log saved meal to ${MEAL_LABELS[mealType]}`}
        kind="meal"
        date={date}
        mealType={mealType}
        onSelectRecipe={handleLogRecipe}
        onLogged={() => {
          invalidate();
          dismiss();
        }}
        onClose={() => setRecipePickerOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionGap: {
    width: 8,
  },
  actions: {
    flexDirection: 'row',
  },
  header: {
    width: '100%',
  },
  list: {
    flex: 1,
  },
});
