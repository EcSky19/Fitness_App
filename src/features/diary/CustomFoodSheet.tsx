import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { upsertFood } from '@/db/repositories';
import { roundTo } from '@/domain';
import { useAppStore } from '@/store/appStore';
import { Button, NumberField, SegmentedControl, Sheet, TextField, useTheme } from '@/ui';
import type { Food, ID, Macros } from '@/types';

import { scaleMacrosByRatio, type NewFood } from './useEntryDraft';

type Basis = 'serving' | 'per100';

export interface CustomFoodSheetProps {
  visible: boolean;
  onClose: () => void;
  initialName?: string;
  /** Called with the new food id (or `null` when the repository returns nothing). */
  onCreated: (foodId: ID | null) => void;
}

const BASIS_OPTIONS: { label: string; value: Basis }[] = [
  { label: 'Per serving', value: 'serving' },
  { label: 'Per 100 g', value: 'per100' },
];

/** Inline "create custom food" form used by the food search screen. */
export function CustomFoodSheet({
  visible,
  onClose,
  initialName,
  onCreated,
}: CustomFoodSheetProps): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  const [name, setName] = useState(initialName ?? '');
  const [brand, setBrand] = useState('');
  const [servingSizeG, setServingSizeG] = useState<number | null>(100);
  const [servingLabel, setServingLabel] = useState('');
  const [basis, setBasis] = useState<Basis>('serving');
  const [calories, setCalories] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    savingRef.current = false;
    setName(initialName ?? '');
    setBrand('');
    setServingSizeG(100);
    setServingLabel('');
    setBasis('serving');
    setCalories(null);
    setProtein(null);
    setCarbs(null);
    setFat(null);
    setError(null);
  }, [visible, initialName]);

  const grams = servingSizeG != null && servingSizeG > 0 ? servingSizeG : 0;
  const nameError = name.trim() ? undefined : 'Name is required.';
  const gramsError = grams > 0 ? undefined : 'Serving size must be more than 0.';
  const canSave = !nameError && !gramsError && !saving;

  const handleSave = useCallback(async () => {
    // `saving` only disables the button on the next render, so a double tap
    // delivered inside one batch has to be rejected synchronously.
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const entered: Macros = {
        calories: calories ?? 0,
        protein: protein ?? 0,
        carbs: carbs ?? 0,
        fat: fat ?? 0,
      };
      const per100g = basis === 'serving' ? scaleMacrosByRatio(entered, 100 / grams) : entered;
      const payload: NewFood = {
        name: name.trim(),
        brand: brand.trim() ? brand.trim() : null,
        per100g,
        servingSizeG: roundTo(grams, 1),
        servingLabel: servingLabel.trim() || `1 serving (${roundTo(grams, 0)} g)`,
        barcode: null,
        source: 'custom',
        isFavorite: false,
        usageCount: 0,
        lastUsedAt: null,
      };
      const saved = (await upsertFood(payload)) as Food | ID | null | undefined;
      useAppStore.getState().invalidate();
      const id = typeof saved === 'string' ? saved : (saved?.id ?? null);
      onCreated(id);
    } catch {
      setError('Could not save this food. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [basis, brand, calories, canSave, carbs, fat, grams, name, onCreated, protein, servingLabel]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Create custom food">
      <View testID="custom-food-sheet">
        <TextField
          testID="custom-food-name"
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Homemade granola"
        />
        <View style={{ height: spacing.md }} />
        <TextField
          testID="custom-food-brand"
          label="Brand (optional)"
          value={brand}
          onChangeText={setBrand}
          placeholder="Brand"
        />
        <View style={{ height: spacing.md }} />
        <NumberField
          testID="custom-food-serving-size"
          label="Serving size"
          value={servingSizeG}
          onChange={setServingSizeG}
          suffix="g"
          decimals={1}
          min={0}
        />
        <View style={{ height: spacing.md }} />
        <TextField
          testID="custom-food-serving-label"
          label="Serving label (optional)"
          value={servingLabel}
          onChangeText={setServingLabel}
          placeholder="1 cup (60 g)"
        />

        <View style={{ height: spacing.lg }} />
        <SegmentedControl<Basis>
          options={BASIS_OPTIONS}
          value={basis}
          onChange={setBasis}
          size="sm"
        />

        <View style={{ height: spacing.md }} />
        <NumberField
          testID="custom-food-calories"
          label="Calories"
          value={calories}
          onChange={setCalories}
          suffix="kcal"
          min={0}
        />
        <View style={styles.row}>
          <View style={styles.cell}>
            <NumberField
              testID="custom-food-protein"
              label="Protein"
              value={protein}
              onChange={setProtein}
              suffix="g"
              decimals={1}
              min={0}
            />
          </View>
          <View style={[styles.cell, styles.cellGap]}>
            <NumberField
              testID="custom-food-carbs"
              label="Carbs"
              value={carbs}
              onChange={setCarbs}
              suffix="g"
              decimals={1}
              min={0}
            />
          </View>
          <View style={[styles.cell, styles.cellGap]}>
            <NumberField
              testID="custom-food-fat"
              label="Fat"
              value={fat}
              onChange={setFat}
              suffix="g"
              decimals={1}
              min={0}
            />
          </View>
        </View>

        {nameError || gramsError || error ? (
          <Text
            testID="custom-food-error"
            style={[typography.caption, styles.error, { color: colors.danger }]}
          >
            {error ?? nameError ?? gramsError}
          </Text>
        ) : null}

        <View style={{ height: spacing.lg }} />
        <Button
          testID="custom-food-save"
          title="Save food"
          onPress={() => void handleSave()}
          disabled={!canSave}
          loading={saving}
          fullWidth
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
  },
  cellGap: {
    marginLeft: 8,
  },
  error: {
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    marginTop: 12,
  },
});

export default CustomFoodSheet;
