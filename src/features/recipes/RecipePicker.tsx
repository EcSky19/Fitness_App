import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  duplicateRecipe,
  listRecipes,
  logRecipe,
  searchRecipes,
  toggleFavoriteRecipe,
} from '@/db/repositories';
import { formatDateLabel, perServing, recipeTotals, scaleRecipeItems } from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Button, Card, Chip, DateStepper, Divider, EmptyState, MacroBar, NumberField, SegmentedControl, Sheet, TextField, useTheme } from '@/ui';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { FoodEntry, ISODate, MealType, Recipe, RecipeKind } from '@/types';
import { defaultLogDate, macroSummary, recipeKindLabel, recipeLogFactor, recipeSummaryLine, safeServings } from './utils';

export interface RecipeLogRequest {
  recipe: Recipe;
  date: ISODate;
  mealType: MealType;
  servings: number;
  entries: FoodEntry[];
}

export interface RecipePickerProps {
  /** Initial date used by the log confirmation sheet. Defaults to today. */
  date?: ISODate;
  /** Initial meal type for logging; a recipe's defaultMealType wins when present. */
  mealType?: MealType;
  /** Called after a confirmed log completes with the real diary entries created. */
  onLogged?: (request: RecipeLogRequest) => void;
  /** Called when the user opens a recipe for details/editing. Keep route decisions outside this component. */
  onSelectRecipe?: (recipe: Recipe) => void;
  /** Optional create action. When omitted the empty-state/create CTA is hidden. */
  onCreateRecipe?: () => void;
  /** Optional edit action shown on each row. */
  onEditRecipe?: (recipe: Recipe) => void;
  /** Initial list kind filter. */
  initialKind?: RecipeKind | 'all';
  /** Initial favorites filter. */
  initialFavoritesOnly?: boolean;
  /** Max recipes requested from the repository. */
  limit?: number;
  /** Shows the search/filter controls. Defaults true. */
  showFilters?: boolean;
}

type KindFilter = RecipeKind | 'all';

const KIND_OPTIONS: { label: string; value: KindFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Meals', value: 'meal' },
  { label: 'Recipes', value: 'recipe' },
];

const MEAL_OPTIONS: { label: string; value: MealType }[] = MEAL_TYPES.map((meal) => ({
  label: MEAL_LABELS[meal],
  value: meal,
}));

function compareRecipes(a: Recipe, b: Recipe): number {
  if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
  if (b.timesLogged !== a.timesLogged) return b.timesLogged - a.timesLogged;
  const aLogged = a.lastLoggedAt ?? '';
  const bLogged = b.lastLoggedAt ?? '';
  if (aLogged !== bLogged) return bLogged.localeCompare(aLogged);
  return a.name.localeCompare(b.name);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function RecipeRow({
  recipe,
  onLog,
  onSelect,
  onEdit,
  onDuplicate,
  onToggleFavorite,
}: {
  recipe: Recipe;
  onLog: (recipe: Recipe) => void;
  onSelect?: (recipe: Recipe) => void;
  onEdit?: (recipe: Recipe) => void;
  onDuplicate?: (recipe: Recipe) => void;
  onToggleFavorite: (recipe: Recipe) => void;
}): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const per = perServing(recipe.totals, recipe.totalGrams, safeServings(recipe.servings));
  const title = recipe.kind === 'meal' ? 'Saved meal' : 'Per serving';
  const cardTestID = onSelect && !onEdit ? 'recipe-picker-select' : `recipe-card-${recipe.id}`;

  return (
    <Card testID={cardTestID} onPress={onSelect ? () => onSelect(recipe) : undefined}>
      <View style={styles.rowTop}>
        <View style={styles.rowTitle}>
          <Text style={[typography.h3, { color: colors.text }]} numberOfLines={1}>{recipe.name}</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]} numberOfLines={2}>{recipeSummaryLine(recipe)}</Text>
        </View>
        <Pressable
          testID={`recipe-favorite-${recipe.id}`}
          accessibilityRole="button"
          accessibilityLabel={recipe.isFavorite ? `Remove ${recipe.name} from favorites` : `Add ${recipe.name} to favorites`}
          accessibilityState={{ selected: recipe.isFavorite }}
          hitSlop={10}
          onPress={() => onToggleFavorite(recipe)}
          style={styles.iconButton}
        >
          <Ionicons name={recipe.isFavorite ? 'star' : 'star-outline'} size={22} color={recipe.isFavorite ? colors.warning : colors.textFaint} />
        </Pressable>
      </View>

      <View style={{ height: spacing.md }} />
      <Text testID={`recipe-kind-${recipe.id}`} style={[typography.label, { color: colors.textMuted }]}>{title}</Text>
      <Text testID={`recipe-macros-${recipe.id}`} style={[typography.title, { color: colors.text }]}>{macroSummary(per.macros)}</Text>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{Math.round(per.grams)} g per serving · {macroSummary(recipe.totals)} total</Text>
      <View style={{ height: spacing.sm }} />
      <MacroBar protein={per.macros.protein} carbs={per.macros.carbs} fat={per.macros.fat} height={8} />
      <View style={[styles.actions, { marginTop: spacing.md }]}>
        <Button testID={`recipe-log-${recipe.id}`} title="Log" size="sm" icon="add-circle-outline" onPress={() => onLog(recipe)} />
        {onEdit ? <Button testID={`recipe-edit-${recipe.id}`} title="Edit" size="sm" variant="secondary" onPress={() => onEdit(recipe)} /> : null}
        {onDuplicate ? <Button testID={`recipe-duplicate-${recipe.id}`} title="Duplicate" size="sm" variant="ghost" icon="copy-outline" onPress={() => onDuplicate(recipe)} /> : null}
      </View>
    </Card>
  );
}

function RecipeLogSheet({
  recipe,
  initialDate,
  initialMealType,
  onClose,
  onLogged,
}: {
  recipe: Recipe | null;
  initialDate: ISODate;
  initialMealType: MealType;
  onClose: () => void;
  onLogged?: (request: RecipeLogRequest) => void;
}): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [date, setDate] = useState(initialDate);
  const [mealType, setMealType] = useState<MealType>(initialMealType);
  const [servings, setServings] = useState<number | null>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitRef = useRef(false);

  React.useEffect(() => {
    if (!recipe) return;
    setDate(initialDate);
    setMealType(recipe.defaultMealType ?? initialMealType);
    setServings(1);
    setError(null);
    setSaving(false);
    submitRef.current = false;
  }, [initialDate, initialMealType, recipe]);

  const factor = recipe ? recipeLogFactor(recipe, servings ?? 0) : 0;
  const previewItems = useMemo(() => (recipe ? scaleRecipeItems(recipe.items, factor) : []), [factor, recipe]);
  const previewTotals = recipeTotals(previewItems);
  const canLog = Boolean(recipe) && safeServings(servings, 0) > 0 && previewItems.length > 0;

  const handleLog = useCallback(() => {
    if (!recipe || !canLog || submitRef.current) return;
    submitRef.current = true;
    setSaving(true);
    setError(null);
    logRecipe({ recipeId: recipe.id, date, mealType, servings: safeServings(servings) })
      .then((entries) => {
        onLogged?.({ recipe, date, mealType, servings: safeServings(servings), entries });
        onClose();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not log recipe');
      })
      .finally(() => {
        submitRef.current = false;
        setSaving(false);
      });
  }, [canLog, date, mealType, onClose, onLogged, recipe, servings]);

  return (
    <Sheet visible={Boolean(recipe)} onClose={onClose} title={recipe ? `Log ${recipe.name}` : 'Log recipe'}>
      {recipe ? (
        <View testID="recipe-log-sheet">
          <Text style={[typography.body, { color: colors.textMuted }]}>This will add {previewItems.length} diary entries to {MEAL_LABELS[mealType].toLowerCase()} on {formatDateLabel(date)}.</Text>
          <View style={{ height: spacing.md }} />
          <DateStepper date={date} onChange={setDate} />
          <View style={{ height: spacing.md }} />
          <SegmentedControl<MealType> options={MEAL_OPTIONS} value={mealType} onChange={setMealType} size="sm" />
          <View style={{ height: spacing.md }} />
          <NumberField testID="recipe-log-servings" label={recipe.kind === 'recipe' ? 'Servings to log' : 'Meals to log'} value={servings} onChange={setServings} decimals={2} min={0} suffix={recipe.kind === 'recipe' ? 'servings' : 'meals'} />
          <View style={{ height: spacing.md }} />
          <Card testID="recipe-log-preview">
            <Text style={[typography.label, { color: colors.textMuted }]}>Will add</Text>
            <Text testID="recipe-log-preview-macros" style={[typography.h3, { color: colors.text }]}>{macroSummary(previewTotals.macros)}</Text>
            <Text style={[typography.caption, { color: colors.textMuted }]}>{Math.round(previewTotals.grams)} g across {previewItems.length} entries</Text>
            {previewItems.slice(0, 6).map((item) => (
              <Text key={item.id} style={[typography.caption, { color: colors.textMuted }]}>• {item.name} — {macroSummary(item.macros)}</Text>
            ))}
          </Card>
          {error ? <Text testID="recipe-log-error" style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
          <View style={{ height: spacing.lg }} />
          <Button testID="recipe-log-confirm" title="Add entries" onPress={handleLog} disabled={!canLog || saving} loading={saving} fullWidth />
        </View>
      ) : null}
    </Sheet>
  );
}

export function RecipePicker({
  date,
  mealType = 'breakfast',
  onLogged,
  onSelectRecipe,
  onCreateRecipe,
  onEditRecipe,
  initialKind = 'all',
  initialFavoritesOnly = false,
  limit = 50,
  showFilters = true,
}: RecipePickerProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>(initialKind);
  const [favoritesOnly, setFavoritesOnly] = useState(initialFavoritesOnly);
  const [selected, setSelected] = useState<Recipe | null>(null);
  const debouncedQuery = useDebouncedValue(query, 250);
  const trimmed = debouncedQuery.trim();

  const load = useCallback(async (): Promise<Recipe[]> => {
    const fromRepo = trimmed
      ? await searchRecipes(trimmed, limit)
      : await listRecipes({ kind: kind === 'all' ? undefined : kind, favoritesOnly, limit });
    return (fromRepo ?? [])
      .filter((recipe) => (kind === 'all' ? true : recipe.kind === kind))
      .filter((recipe) => (!favoritesOnly ? true : recipe.isFavorite))
      .sort(compareRecipes);
  }, [favoritesOnly, kind, limit, trimmed]);

  const { data, loading, error, reload } = useAsyncData<Recipe[]>(load, [trimmed, kind, favoritesOnly, limit], []);
  const searching = loading || query.trim() !== trimmed;

  const handleToggleFavorite = useCallback((recipe: Recipe) => {
    toggleFavoriteRecipe(recipe.id).then(() => reload()).catch(() => reload());
  }, [reload]);

  // Jumps straight into editing the copy so the user can tweak it right away
  // rather than having to find it again in the (now-reloaded) list.
  const handleDuplicate = useCallback((recipe: Recipe) => {
    duplicateRecipe(recipe.id)
      .then((created) => {
        reload();
        onEditRecipe?.(created);
      })
      .catch(() => reload());
  }, [onEditRecipe, reload]);

  const emptyTitle = trimmed ? `No saved meals or recipes for “${trimmed}”` : favoritesOnly ? 'No favorites yet' : 'Save a meal once, log it forever';
  const emptyMessage = trimmed
    ? 'Try a shorter search, or create a saved meal from your usual foods.'
    : 'Meals are combinations you log as-is, like your everyday breakfast. Recipes are bulk dishes split into servings, like a pot of chilli.';

  return (
    <View testID="recipe-picker" style={styles.picker}>
      {showFilters ? (
        <View style={[styles.filters, { paddingBottom: spacing.md }]}>
          <TextField testID="recipe-search-input" value={query} onChangeText={setQuery} placeholder="Search saved meals and recipes" autoCorrect={false} returnKeyType="search" right={searching ? <ActivityIndicator size="small" /> : undefined} />
          <View style={{ height: spacing.md }} />
          <SegmentedControl<KindFilter> options={KIND_OPTIONS} value={kind} onChange={setKind} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingTop: spacing.sm }]}>
            <Chip testID="recipe-filter-favorites" label="Favorites" icon="star-outline" selected={favoritesOnly} onPress={() => setFavoritesOnly((v) => !v)} />
          </ScrollView>
        </View>
      ) : null}

      {error ? <Text testID="recipe-list-error" style={[typography.caption, { color: colors.danger }]}>Could not load recipes: {error}</Text> : null}

      <FlatList
        testID="recipe-list"
        data={data}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={!searching ? <EmptyState testID="recipe-empty" icon="restaurant-outline" title={emptyTitle} message={emptyMessage} actionLabel={onCreateRecipe ? 'Create saved meal or recipe' : undefined} onAction={onCreateRecipe} /> : null}
        ListFooterComponent={onCreateRecipe && data.length > 0 ? <><View style={{ height: spacing.lg }} /><Divider /><Button testID="recipe-create" title="Create saved meal or recipe" variant="secondary" icon="add-outline" onPress={onCreateRecipe} fullWidth /></> : null}
        renderItem={({ item }) => <RecipeRow recipe={item} onLog={setSelected} onSelect={onSelectRecipe} onEdit={onEditRecipe} onDuplicate={onEditRecipe ? handleDuplicate : undefined} onToggleFavorite={handleToggleFavorite} />}
      />

      <RecipeLogSheet recipe={selected} initialDate={defaultLogDate(date)} initialMealType={mealType} onClose={() => setSelected(null)} onLogged={onLogged} />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8 },
  chips: { flexDirection: 'row' },
  filters: { width: '100%' },
  iconButton: { padding: 4 },
  picker: { flex: 1, width: '100%' },
  rowTitle: { flex: 1, marginRight: 12 },
  rowTop: { alignItems: 'flex-start', flexDirection: 'row' },
});
