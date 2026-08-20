import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteRecipe, getRecipe, saveRecipe } from '@/db/repositories';
import { perServing, recipeTotals, roundTo } from '@/domain';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Button, Card, Chip, Divider, MacroBar, NumberField, Screen, SegmentedControl, Sheet, TextField, useTheme } from '@/ui';
import { MEAL_LABELS, MEAL_TYPES } from '@/types/constants';
import type { Macros, MealType, Recipe, RecipeItem, RecipeKind } from '@/types';
import { macroSummary, safeServings, sortedRecipeItems } from './utils';

export interface RecipeEditFormProps {
  /** Existing recipe id. Omit to create a new saved meal/recipe. */
  recipeId?: string;
  /** Called after save, delete, or cancel. Parent owns routing. */
  onDone: () => void;
}

type DraftItem = Omit<RecipeItem, 'recipeId'> & { id: string };
type ItemField = 'quantity' | 'gramsTotal' | keyof Macros;

const KIND_OPTIONS: { label: string; value: RecipeKind }[] = [
  { label: 'Recipe (split into servings)', value: 'recipe' },
  { label: 'Saved meal (log as-is)', value: 'meal' },
];

const NONE_MEAL = 'none';
type MealChoice = MealType | typeof NONE_MEAL;
const MEAL_OPTIONS: { label: string; value: MealChoice }[] = [
  { label: 'No default', value: NONE_MEAL },
  ...MEAL_TYPES.map((meal) => ({ label: MEAL_LABELS[meal], value: meal })),
];

function emptyMacros(): Macros {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

let localId = 0;
function newLocalItem(): DraftItem {
  localId += 1;
  return {
    id: `new-${localId}`,
    foodId: null,
    name: '',
    quantity: 1,
    unit: 'serving',
    gramsTotal: 0,
    macros: emptyMacros(),
    sortOrder: localId,
  };
}

function fromRecipeItem(item: RecipeItem): DraftItem {
  return { ...item };
}

function normalizeItemForSave(item: DraftItem, sortOrder: number): Omit<RecipeItem, 'id' | 'recipeId'> {
  return {
    foodId: item.foodId,
    name: item.name.trim(),
    quantity: safeServings(item.quantity, 0),
    unit: item.unit.trim() || 'serving',
    gramsTotal: safeServings(item.gramsTotal, 0),
    macros: item.macros,
    sortOrder,
  };
}

function itemIsValid(item: DraftItem): boolean {
  return Boolean(item.name.trim()) && safeServings(item.quantity, 0) > 0 && safeServings(item.gramsTotal, 0) > 0;
}

function buildInitial(recipe: Recipe | null): {
  name: string;
  kind: RecipeKind;
  servings: number | null;
  defaultMeal: MealChoice;
  notes: string;
  photoUri: string;
  items: DraftItem[];
} {
  return {
    name: recipe?.name ?? '',
    kind: recipe?.kind ?? 'meal',
    servings: recipe?.servings ?? 1,
    defaultMeal: recipe?.defaultMealType ?? NONE_MEAL,
    notes: recipe?.notes ?? '',
    photoUri: recipe?.photoUri ?? '',
    items: sortedRecipeItems(recipe?.items ?? []).map(fromRecipeItem),
  };
}

function IngredientSheet({
  value,
  onClose,
  onSave,
}: {
  value: DraftItem | null;
  onClose: () => void;
  onSave: (item: DraftItem) => void;
}): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [draft, setDraft] = useState<DraftItem>(() => newLocalItem());

  React.useEffect(() => {
    if (value) setDraft({ ...value, macros: { ...value.macros } });
  }, [value]);

  const setNumber = (field: ItemField, next: number | null): void => {
    setDraft((current) => {
      if (field === 'quantity' || field === 'gramsTotal') return { ...current, [field]: next ?? 0 };
      return { ...current, macros: { ...current.macros, [field]: next ?? 0 } };
    });
  };

  const canSave = itemIsValid(draft);

  return (
    <Sheet visible={Boolean(value)} onClose={onClose} title={draft.id.startsWith('new-') ? 'Add ingredient' : 'Edit ingredient'}>
      <View testID="ingredient-sheet">
        <TextField testID="ingredient-name" label="Ingredient name" value={draft.name} onChangeText={(name) => setDraft((item) => ({ ...item, name }))} placeholder="Oats, milk, banana…" autoFocus />
        <View style={{ height: spacing.md }} />
        <View style={styles.twoCols}>
          <View style={styles.col}><NumberField testID="ingredient-quantity" label="Amount" value={draft.quantity} onChange={(v) => setNumber('quantity', v)} decimals={2} min={0} /></View>
          <View style={styles.col}><TextField testID="ingredient-unit" label="Unit" value={draft.unit} onChangeText={(unit) => setDraft((item) => ({ ...item, unit }))} placeholder="serving" /></View>
        </View>
        <View style={{ height: spacing.md }} />
        <NumberField testID="ingredient-grams" label="Total grams" value={draft.gramsTotal} onChange={(v) => setNumber('gramsTotal', v)} decimals={1} min={0} suffix="g" />
        <View style={{ height: spacing.md }} />
        <Text style={[typography.label, { color: colors.textMuted }]}>Macros for this ingredient amount</Text>
        <View style={styles.twoCols}>
          <View style={styles.col}><NumberField testID="ingredient-calories" label="Calories" value={draft.macros.calories} onChange={(v) => setNumber('calories', v)} decimals={0} min={0} /></View>
          <View style={styles.col}><NumberField testID="ingredient-protein" label="Protein" value={draft.macros.protein} onChange={(v) => setNumber('protein', v)} decimals={1} min={0} suffix="g" /></View>
        </View>
        <View style={styles.twoCols}>
          <View style={styles.col}><NumberField testID="ingredient-carbs" label="Carbs" value={draft.macros.carbs} onChange={(v) => setNumber('carbs', v)} decimals={1} min={0} suffix="g" /></View>
          <View style={styles.col}><NumberField testID="ingredient-fat" label="Fat" value={draft.macros.fat} onChange={(v) => setNumber('fat', v)} decimals={1} min={0} suffix="g" /></View>
        </View>
        {!canSave ? <Text testID="ingredient-error" style={[typography.caption, { color: colors.danger }]}>Name, amount and grams are required.</Text> : null}
        <View style={{ height: spacing.lg }} />
        <Button testID="ingredient-save" title="Save ingredient" onPress={() => onSave(draft)} disabled={!canSave} fullWidth />
      </View>
    </Sheet>
  );
}

export function RecipeEditForm({ recipeId, onDone }: RecipeEditFormProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RecipeKind>('meal');
  const [servings, setServings] = useState<number | null>(1);
  const [defaultMeal, setDefaultMeal] = useState<MealChoice>(NONE_MEAL);
  const [notes, setNotes] = useState('');
  const [photoUri, setPhotoUri] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [editingItem, setEditingItem] = useState<DraftItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedIdRef = useRef<string | null>(null);
  const submitRef = useRef(false);

  const load = useCallback(async (): Promise<Recipe | null> => (recipeId ? getRecipe(recipeId) : null), [recipeId]);
  const { data: loaded, loading } = useAsyncData<Recipe | null>(load, [recipeId ?? 'new'], null);

  React.useEffect(() => {
    const key = recipeId ?? 'new';
    if (hydratedIdRef.current === key) return;
    if (recipeId && loading) return;
    const initial = buildInitial(loaded);
    setName(initial.name);
    setKind(initial.kind);
    setServings(initial.servings);
    setDefaultMeal(initial.defaultMeal);
    setNotes(initial.notes);
    setPhotoUri(initial.photoUri);
    setItems(initial.items);
    hydratedIdRef.current = key;
  }, [loaded, loading, recipeId]);

  const sortedItems = useMemo(() => sortedRecipeItems(items), [items]);
  const totals = useMemo(() => recipeTotals(sortedItems), [sortedItems]);
  const per = useMemo(() => perServing(totals.macros, totals.grams, safeServings(servings)), [servings, totals]);
  const canSave = Boolean(name.trim()) && safeServings(servings, 0) > 0 && sortedItems.length > 0 && sortedItems.every(itemIsValid);

  const close = useCallback(() => {
    onDone();
  }, [onDone]);

  const handleKindChange = useCallback((next: RecipeKind) => {
    setKind(next);
    if (next === 'meal') setServings(1);
  }, []);

  const handleSaveItem = useCallback((item: DraftItem) => {
    setItems((current) => {
      const exists = current.some((candidate) => candidate.id === item.id);
      const next = exists ? current.map((candidate) => (candidate.id === item.id ? item : candidate)) : [...current, { ...item, sortOrder: current.length }];
      return next.map((candidate, index) => ({ ...candidate, sortOrder: index }));
    });
    setEditingItem(null);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id).map((item, index) => ({ ...item, sortOrder: index })));
  }, []);

  const moveItem = useCallback((id: string, direction: -1 | 1) => {
    setItems((current) => {
      const next = sortedRecipeItems(current);
      const index = next.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next.map((candidate, sortOrder) => ({ ...candidate, sortOrder }));
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!canSave || submitRef.current) return;
    submitRef.current = true;
    setSaving(true);
    setError(null);
    saveRecipe({
      id: recipeId,
      name: name.trim(),
      kind,
      servings: safeServings(servings),
      defaultMealType: defaultMeal === NONE_MEAL ? null : defaultMeal,
      notes: notes.trim() || null,
      photoUri: photoUri.trim() || null,
      items: sortedItems.map(normalizeItemForSave),
    })
      .then(close)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not save recipe'))
      .finally(() => {
        submitRef.current = false;
        setSaving(false);
      });
  }, [canSave, close, defaultMeal, kind, name, notes, photoUri, recipeId, servings, sortedItems]);

  const handleDelete = useCallback(() => {
    if (!recipeId || saving) return;
    Alert.alert('Delete saved meal or recipe', `Delete “${name.trim() || 'this recipe'}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (submitRef.current) return;
          submitRef.current = true;
          setSaving(true);
          deleteRecipe(recipeId)
            .then(close)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not delete recipe'))
            .finally(() => {
              submitRef.current = false;
              setSaving(false);
            });
        },
      },
    ]);
  }, [close, name, recipeId, saving]);

  if (recipeId && loading && !loaded) {
    return <Screen><View style={styles.loading}><ActivityIndicator testID="recipe-edit-loading" size="large" color={colors.primary} /></View></Screen>;
  }

  return (
    <Screen scrollable title={recipeId ? 'Edit saved meal' : 'Create saved meal'} subtitle="Meals log as-is. Recipes split bulk cooking into servings.">
      <TextField testID="recipe-name" label="Name" value={name} onChangeText={setName} placeholder="Usual breakfast, chicken chilli…" autoFocus={!recipeId} />
      <View style={{ height: spacing.md }} />
      <SegmentedControl<RecipeKind> options={KIND_OPTIONS} value={kind} onChange={handleKindChange} />
      <Text testID="recipe-kind-help" style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>
        {kind === 'meal' ? 'Saved meals log the whole combination. Logging 2 meals doubles every ingredient.' : 'Recipes show per-serving macros and logging 1 serving adds a proportional share of each ingredient.'}
      </Text>
      <View style={{ height: spacing.md }} />
      <NumberField testID="recipe-servings" label={kind === 'recipe' ? 'Servings made' : 'Default meals'} value={servings} onChange={setServings} decimals={2} min={0} suffix={kind === 'recipe' ? 'servings' : 'meal'} />
      <View style={{ height: spacing.md }} />
      <SegmentedControl<MealChoice> options={MEAL_OPTIONS} value={defaultMeal} onChange={setDefaultMeal} size="sm" />
      <View style={{ height: spacing.md }} />
      <TextField testID="recipe-notes" label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Prep notes, brand swaps, oven time…" multiline />
      <View style={{ height: spacing.md }} />
      <TextField testID="recipe-photo-uri" label="Photo URI (optional)" value={photoUri} onChangeText={setPhotoUri} placeholder="file:///…" />
      {photoUri.trim() ? <Image testID="recipe-photo" source={{ uri: photoUri.trim() }} style={[styles.photo, { borderColor: colors.border, marginTop: spacing.md }]} resizeMode="cover" /> : null}

      <View style={{ height: spacing.lg }} />
      <Card testID="recipe-totals">
        <Text style={[typography.label, { color: colors.textMuted }]}>{kind === 'recipe' ? 'Per serving' : 'Meal total'}</Text>
        <Text testID="recipe-per-serving" style={[typography.h2, { color: colors.text }]}>{macroSummary(kind === 'recipe' ? per.macros : totals.macros)}</Text>
        <Text testID="recipe-total-macros" style={[typography.caption, { color: colors.textMuted }]}>{macroSummary(totals.macros)} total · {roundTo(totals.grams, 1)} g</Text>
        <View style={{ height: spacing.sm }} />
        <MacroBar protein={(kind === 'recipe' ? per.macros : totals.macros).protein} carbs={(kind === 'recipe' ? per.macros : totals.macros).carbs} fat={(kind === 'recipe' ? per.macros : totals.macros).fat} height={10} />
      </Card>

      <View style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
        <Text style={[typography.h3, { color: colors.text }]}>Ingredients</Text>
        <Button testID="ingredient-add" title="Add" size="sm" icon="add-outline" onPress={() => setEditingItem(newLocalItem())} />
      </View>
      {sortedItems.length === 0 ? <Text testID="ingredients-empty" style={[typography.body, { color: colors.textMuted }]}>Add each food once. The repository will replace the full ingredient list atomically when you save.</Text> : null}
      {sortedItems.map((item, index) => (
        <View key={item.id}>
          <Divider />
          <View testID={`ingredient-row-${item.id}`} style={styles.ingredientRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} onPress={() => setEditingItem(item)} style={styles.ingredientMain}>
              <Text style={[typography.title, { color: colors.text }]}>{item.name}</Text>
              <Text style={[typography.caption, { color: colors.textMuted }]}>{item.quantity} {item.unit} · {roundTo(item.gramsTotal, 1)} g · {macroSummary(item.macros)}</Text>
            </Pressable>
            <View style={styles.itemButtons}>
              <Chip testID={`ingredient-up-${item.id}`} label="↑" selected={false} onPress={() => moveItem(item.id, -1)} />
              <Chip testID={`ingredient-down-${item.id}`} label="↓" selected={false} onPress={() => moveItem(item.id, 1)} />
              <Chip testID={`ingredient-remove-${item.id}`} label="Remove" selected={false} onPress={() => removeItem(item.id)} />
            </View>
          </View>
          {index === sortedItems.length - 1 ? <Divider /> : null}
        </View>
      ))}

      {error ? <Text testID="recipe-edit-error" style={[typography.caption, { color: colors.danger }]}>{error}</Text> : null}
      {!canSave ? <Text testID="recipe-save-help" style={[typography.caption, { color: colors.textMuted, marginTop: spacing.md }]}>Name, servings and at least one complete ingredient are required.</Text> : null}
      <View style={{ height: spacing.xl }} />
      <Button testID="recipe-save" title={recipeId ? 'Save changes' : 'Save meal or recipe'} onPress={handleSave} disabled={!canSave || saving} loading={saving} fullWidth size="lg" />
      {recipeId ? <View style={{ marginTop: spacing.md }}><Button testID="recipe-delete" title="Delete" variant="danger" icon="trash-outline" onPress={handleDelete} disabled={saving} fullWidth /></View> : null}
      <View style={{ marginTop: spacing.md }}><Button testID="recipe-cancel" title="Cancel" variant="secondary" onPress={close} disabled={saving} fullWidth /></View>

      <IngredientSheet value={editingItem} onClose={() => setEditingItem(null)} onSave={handleSaveItem} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  col: { flex: 1 },
  ingredientMain: { flex: 1, minHeight: 44, justifyContent: 'center' },
  ingredientRow: { alignItems: 'center', flexDirection: 'row', paddingVertical: 8 },
  itemButtons: { alignItems: 'center', flexDirection: 'row', gap: 6, marginLeft: 8 },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingVertical: 48 },
  photo: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, height: 160, width: '100%' },
  sectionTitle: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  twoCols: { flexDirection: 'row', gap: 12 },
});
