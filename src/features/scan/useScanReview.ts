/**
 * Editable state for the AI scan review screen.
 *
 * Everything the user can correct after a photo is analysed lives here: the
 * per-item values, a frozen copy of what the model originally returned, the
 * include/exclude flags, the proportional portion rescaling and the totals.
 *
 * The module is deliberately free of React Native imports so the whole
 * correction model can be unit tested in plain Node.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { macrosToCalories, roundTo, scaleMacros, sumMacros } from '@/domain';
import { visionItemToEntryDraft } from '@/services/vision';
import type {
  FoodEntry,
  ISODate,
  Macros,
  MealType,
  ServingUnit,
  VisionFoodItem,
  VisionMode,
  VisionResult,
} from '@/types';

export type EntryDraft = Omit<FoodEntry, 'id' | 'createdAt' | 'updatedAt'>;

export const MACRO_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'sodium',
] as const;

export type MacroKey = (typeof MACRO_KEYS)[number];

export const SERVING_UNITS: ServingUnit[] = [
  'g',
  'ml',
  'oz',
  'serving',
  'piece',
  'cup',
  'tbsp',
  'tsp',
];

export const PORTION_MULTIPLIERS: { label: string; factor: number }[] = [
  { label: '½×', factor: 0.5 },
  { label: '1×', factor: 1 },
  { label: '1½×', factor: 1.5 },
  { label: '2×', factor: 2 },
];

/** Absolute kcal tolerance before the 4/4/9 mismatch warning appears. */
const CALORIE_TOLERANCE_KCAL = 20;
/** Relative kcal tolerance (fraction of the computed value). */
const CALORIE_TOLERANCE_RATIO = 0.1;

const EPSILON = 1e-6;

export interface ReviewItem {
  id: string;
  name: string;
  brand: string | null;
  quantity: number;
  unit: ServingUnit;
  servingLabel: string;
  grams: number;
  macros: Macros;
  confidence: number;
  notes: string | null;
  /** Excluded items dim out and stop counting towards the totals. */
  included: boolean;
  /** True once any field differs from what the model returned. */
  wasEdited: boolean;
  /** Frozen model output; null for items the user added by hand. */
  original: VisionFoodItem | null;
  /** Reference portion used to rescale macros proportionally. */
  basisGrams: number;
  basisMacros: Macros;
}

export interface ScanReviewState {
  items: ReviewItem[];
  seq: number;
}

export type ScanReviewAction =
  | { type: 'setName'; id: string; value: string }
  | { type: 'setBrand'; id: string; value: string }
  | { type: 'setQuantity'; id: string; value: number | null }
  | { type: 'setGrams'; id: string; value: number | null }
  | { type: 'setUnit'; id: string; value: ServingUnit }
  | { type: 'setMacro'; id: string; key: MacroKey; value: number | null }
  | { type: 'multiply'; id: string; factor: number }
  | { type: 'fixCalories'; id: string }
  | { type: 'toggleIncluded'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'add' }
  | { type: 'reset'; result: VisionResult | null };

/* -------------------------------------------------------------------------- */
/* Numeric guards                                                             */
/* -------------------------------------------------------------------------- */

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nonNegative(value: unknown): number {
  return Math.max(0, finite(value));
}

/** Coerces every macro field to a finite, non-negative number. */
export function finiteMacros(value: unknown): Macros {
  const m = (value ?? {}) as Partial<Macros>;
  const out: Macros = {
    calories: nonNegative(m.calories),
    protein: nonNegative(m.protein),
    carbs: nonNegative(m.carbs),
    fat: nonNegative(m.fat),
  };
  if (m.fiber !== undefined && m.fiber !== null) out.fiber = nonNegative(m.fiber);
  if (m.sugar !== undefined && m.sugar !== null) out.sugar = nonNegative(m.sugar);
  if (m.sodium !== undefined && m.sodium !== null) out.sodium = nonNegative(m.sodium);
  return out;
}

function roundMacros(m: Macros): Macros {
  const out: Macros = {
    calories: roundTo(m.calories, 0),
    protein: roundTo(m.protein, 1),
    carbs: roundTo(m.carbs, 1),
    fat: roundTo(m.fat, 1),
  };
  if (m.fiber !== undefined) out.fiber = roundTo(m.fiber, 1);
  if (m.sugar !== undefined) out.sugar = roundTo(m.sugar, 1);
  if (m.sodium !== undefined) out.sodium = roundTo(m.sodium, 0);
  return out;
}

function macrosEqual(a: Macros, b: Macros): boolean {
  return MACRO_KEYS.every((key) => Math.abs(finite(a[key]) - finite(b[key])) < EPSILON);
}

/* -------------------------------------------------------------------------- */
/* Portion maths                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Rescales `basisMacros` from `basisGrams` to `grams`.
 * A zero/invalid basis can never be divided by, so the macros pass through
 * untouched instead of becoming `NaN`.
 */
export function rescaleFromBasis(basisMacros: Macros, basisGrams: number, grams: number): Macros {
  const base = finiteMacros(basisMacros);
  const from = finite(basisGrams);
  const to = nonNegative(grams);
  if (from <= 0) return base;
  // scaleMacros(per100g, grams) === per100g * grams / 100, so feeding it the
  // ratio expressed "per 100" performs a plain proportional rescale.
  return roundMacros(finiteMacros(scaleMacros(base, (to / from) * 100)));
}

/** Absolute macros converted back to the per-100 g basis a `Food` row stores. */
export function perHundredGrams(macros: Macros, grams: number): Macros {
  const g = finite(grams);
  if (g <= 0) return finiteMacros(macros);
  // Inverse of scaleMacros: macros * 100 / g.
  return roundMacros(finiteMacros(scaleMacros(finiteMacros(macros), (100 / g) * 100)));
}

export interface CalorieCheck {
  /** kcal implied by 4/4/9 from protein / carbs / fat. */
  expected: number;
  /** entered calories - expected. */
  delta: number;
  mismatch: boolean;
}

/** Compares the entered calories against the 4/4/9 value of the macros. */
export function calorieCheck(macros: Macros): CalorieCheck {
  const m = finiteMacros(macros);
  const expected = roundTo(finite(macrosToCalories(m)), 0);
  const delta = roundTo(m.calories - expected, 0);
  const tolerance = Math.max(CALORIE_TOLERANCE_KCAL, expected * CALORIE_TOLERANCE_RATIO);
  return { expected, delta, mismatch: expected > 0 && Math.abs(delta) > tolerance };
}

/** Sum of the macros of every included item. */
export function totalsOf(items: ReviewItem[]): Macros {
  const included = items.filter((i) => i.included).map((i) => finiteMacros(i.macros));
  if (included.length === 0) return finiteMacros(null);
  return finiteMacros(sumMacros(included));
}

/* -------------------------------------------------------------------------- */
/* Item factories                                                             */
/* -------------------------------------------------------------------------- */

function nextId(seq: number): string {
  return `scan-item-${seq}`;
}

/** Builds an editable row from one model detection. */
export function createReviewItem(source: VisionFoodItem, id: string): ReviewItem {
  const macros = finiteMacros(source.macros);
  const grams = nonNegative(source.estimatedGrams);
  return {
    id,
    name: typeof source.name === 'string' ? source.name : '',
    brand: typeof source.brand === 'string' && source.brand.length > 0 ? source.brand : null,
    quantity: finite(source.quantity, 1),
    unit: SERVING_UNITS.includes(source.unit) ? source.unit : 'serving',
    servingLabel: typeof source.servingLabel === 'string' ? source.servingLabel : '',
    grams,
    macros,
    confidence: Math.min(1, Math.max(0, finite(source.confidence))),
    notes: typeof source.notes === 'string' && source.notes.length > 0 ? source.notes : null,
    included: true,
    wasEdited: false,
    original: { ...source, macros, estimatedGrams: grams },
    basisGrams: grams,
    basisMacros: macros,
  };
}

/** Blank row for a food the model missed. */
export function createBlankItem(id: string): ReviewItem {
  const macros = finiteMacros(null);
  return {
    id,
    name: '',
    brand: null,
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 serving',
    grams: 100,
    macros,
    confidence: 0,
    notes: null,
    included: true,
    wasEdited: true,
    original: null,
    basisGrams: 100,
    basisMacros: macros,
  };
}

export function createReviewItems(result: VisionResult | null): ReviewItem[] {
  const items = result?.items ?? [];
  return items.map((item, index) => createReviewItem(item, nextId(index)));
}

function initState(result: VisionResult | null): ScanReviewState {
  const items = createReviewItems(result);
  return { items, seq: items.length };
}

/** True once any editable field drifts away from the model's original value. */
export function isDirty(item: ReviewItem): boolean {
  const original = item.original;
  if (!original) return true;
  return (
    item.name.trim() !== (original.name ?? '').trim() ||
    (item.brand ?? '') !== (original.brand ?? '') ||
    item.unit !== original.unit ||
    item.servingLabel !== (original.servingLabel ?? '') ||
    Math.abs(item.quantity - finite(original.quantity, 1)) > EPSILON ||
    Math.abs(item.grams - finite(original.estimatedGrams)) > EPSILON ||
    !macrosEqual(item.macros, finiteMacros(original.macros))
  );
}

/** Applies a change and re-derives `wasEdited` from the frozen original. */
function patch(item: ReviewItem, changes: Partial<ReviewItem>): ReviewItem {
  const next: ReviewItem = { ...item, ...changes };
  return { ...next, wasEdited: isDirty(next) };
}

function withGrams(item: ReviewItem, grams: number): ReviewItem {
  const next = nonNegative(grams);
  return patch(item, {
    grams: roundTo(next, 1),
    macros: rescaleFromBasis(item.basisMacros, item.basisGrams, next),
  });
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

export function scanReviewReducer(
  state: ScanReviewState,
  action: ScanReviewAction
): ScanReviewState {
  switch (action.type) {
    case 'reset':
      return initState(action.result);

    case 'add': {
      const item = createBlankItem(nextId(state.seq));
      return { items: [...state.items, item], seq: state.seq + 1 };
    }

    case 'remove':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };

    default:
      break;
  }

  const items = state.items.map((item) => {
    if (item.id !== action.id) return item;

    switch (action.type) {
      case 'setName':
        return patch(item, { name: action.value });

      case 'setBrand':
        return patch(item, { brand: action.value.trim().length > 0 ? action.value : null });

      case 'setUnit':
        return patch(item, { unit: action.value });

      case 'setQuantity': {
        const quantity = nonNegative(action.value);
        // Keep grams proportional to the quantity the user typed.
        const perUnit = item.quantity > 0 ? item.grams / item.quantity : 0;
        const grams = perUnit > 0 ? quantity * perUnit : item.grams;
        return withGrams(patch(item, { quantity }), grams);
      }

      case 'setGrams':
        return withGrams(item, nonNegative(action.value));

      case 'multiply': {
        const factor = Math.max(0, finite(action.factor, 1));
        const grams = item.basisGrams > 0 ? item.basisGrams * factor : item.grams * factor;
        const quantity =
          item.original && finite(item.original.quantity, 0) > 0
            ? roundTo(finite(item.original.quantity, 1) * factor, 2)
            : item.quantity;
        return withGrams(patch(item, { quantity }), grams);
      }

      case 'setMacro': {
        const macros = finiteMacros({ ...item.macros, [action.key]: nonNegative(action.value) });
        // A hand-corrected macro becomes the new basis so later portion changes
        // scale from the corrected value rather than the model's estimate.
        return patch(item, { macros, basisMacros: macros, basisGrams: item.grams });
      }

      case 'fixCalories': {
        const macros = finiteMacros({
          ...item.macros,
          calories: roundTo(finite(macrosToCalories(finiteMacros(item.macros))), 0),
        });
        return patch(item, { macros, basisMacros: macros, basisGrams: item.grams });
      }

      case 'toggleIncluded':
        // Including / excluding is not an edit of the food itself.
        return { ...item, included: !item.included };

      default:
        return item;
    }
  });

  return { ...state, items };
}

/* -------------------------------------------------------------------------- */
/* Drafts                                                                     */
/* -------------------------------------------------------------------------- */

export interface DraftContext {
  date: ISODate;
  mealType: MealType;
  photoUri: string | null;
  mode: VisionMode;
}

export function itemToVisionItem(item: ReviewItem): VisionFoodItem {
  return {
    name: item.name.trim(),
    brand: item.brand,
    quantity: item.quantity,
    unit: item.unit,
    servingLabel: item.servingLabel,
    estimatedGrams: item.grams,
    macros: finiteMacros(item.macros),
    confidence: item.confidence,
    notes: item.notes,
  };
}

/** `food_photo` scans log as `vision`, label scans as `label`. */
export function sourceForMode(mode: VisionMode): 'vision' | 'label' {
  return mode === 'nutrition_label' ? 'label' : 'vision';
}

/** Builds one entry draft per included item, carrying the user's corrections. */
export function buildDrafts(items: ReviewItem[], ctx: DraftContext): EntryDraft[] {
  return items
    .filter((item) => item.included)
    .map((item) => {
      const base = visionItemToEntryDraft(itemToVisionItem(item), {
        date: ctx.date,
        mealType: ctx.mealType,
        photoUri: ctx.photoUri,
      });
      return {
        ...base,
        date: ctx.date,
        mealType: ctx.mealType,
        name: item.name.trim(),
        brand: item.brand,
        quantity: item.quantity,
        unit: item.unit,
        servingLabel: item.servingLabel,
        gramsTotal: item.grams,
        macros: finiteMacros(item.macros),
        photoUri: ctx.photoUri,
        source: sourceForMode(ctx.mode),
        visionConfidence: item.original ? item.confidence : null,
        wasEdited: item.wasEdited,
      };
    });
}

export interface FoodDraft {
  name: string;
  brand: string | null;
  per100g: Macros;
  servingSizeG: number;
  servingLabel: string;
  barcode: null;
  source: 'vision' | 'label';
  isFavorite: boolean;
  usageCount: number;
  lastUsedAt: null;
}

/** Converts an item back to a reusable per-100 g custom food. */
export function itemToFoodDraft(item: ReviewItem, mode: VisionMode): FoodDraft {
  const grams = item.grams > 0 ? item.grams : 100;
  return {
    name: item.name.trim(),
    brand: item.brand,
    per100g: perHundredGrams(item.macros, grams),
    servingSizeG: roundTo(grams, 1),
    servingLabel:
      item.servingLabel.trim().length > 0 ? item.servingLabel : `${roundTo(grams, 0)} g`,
    barcode: null,
    source: sourceForMode(mode),
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface ScanReviewApi {
  items: ReviewItem[];
  includedItems: ReviewItem[];
  includedCount: number;
  totals: Macros;
  canLog: boolean;
  /** Human readable reason the log button is blocked, or null. */
  validationError: string | null;
  setName: (id: string, value: string) => void;
  setBrand: (id: string, value: string) => void;
  setQuantity: (id: string, value: number | null) => void;
  setGrams: (id: string, value: number | null) => void;
  setUnit: (id: string, value: ServingUnit) => void;
  setMacro: (id: string, key: MacroKey, value: number | null) => void;
  applyMultiplier: (id: string, factor: number) => void;
  fixCalories: (id: string) => void;
  toggleIncluded: (id: string) => void;
  removeItem: (id: string) => void;
  addItem: () => void;
  reset: (result: VisionResult | null) => void;
}

export function useScanReview(result: VisionResult | null): ScanReviewApi {
  const [state, dispatch] = useReducer(scanReviewReducer, result, initState);
  const lastResult = useRef(result);

  useEffect(() => {
    if (lastResult.current === result) return;
    lastResult.current = result;
    dispatch({ type: 'reset', result });
  }, [result]);

  const includedItems = useMemo(() => state.items.filter((i) => i.included), [state.items]);
  const totals = useMemo(() => totalsOf(state.items), [state.items]);

  const validationError = useMemo(() => {
    if (includedItems.length === 0) return 'Include at least one item to log.';
    if (includedItems.some((i) => i.name.trim().length === 0)) return 'Every item needs a name.';
    if (includedItems.some((i) => MACRO_KEYS.some((k) => finite(i.macros[k]) < 0))) {
      return 'Macros cannot be negative.';
    }
    return null;
  }, [includedItems]);

  const setName = useCallback((id: string, value: string) => {
    dispatch({ type: 'setName', id, value });
  }, []);
  const setBrand = useCallback((id: string, value: string) => {
    dispatch({ type: 'setBrand', id, value });
  }, []);
  const setQuantity = useCallback((id: string, value: number | null) => {
    dispatch({ type: 'setQuantity', id, value });
  }, []);
  const setGrams = useCallback((id: string, value: number | null) => {
    dispatch({ type: 'setGrams', id, value });
  }, []);
  const setUnit = useCallback((id: string, value: ServingUnit) => {
    dispatch({ type: 'setUnit', id, value });
  }, []);
  const setMacro = useCallback((id: string, key: MacroKey, value: number | null) => {
    dispatch({ type: 'setMacro', id, key, value });
  }, []);
  const applyMultiplier = useCallback((id: string, factor: number) => {
    dispatch({ type: 'multiply', id, factor });
  }, []);
  const fixCalories = useCallback((id: string) => {
    dispatch({ type: 'fixCalories', id });
  }, []);
  const toggleIncluded = useCallback((id: string) => {
    dispatch({ type: 'toggleIncluded', id });
  }, []);
  const removeItem = useCallback((id: string) => {
    dispatch({ type: 'remove', id });
  }, []);
  const addItem = useCallback(() => {
    dispatch({ type: 'add' });
  }, []);
  const reset = useCallback((next: VisionResult | null) => {
    lastResult.current = next;
    dispatch({ type: 'reset', result: next });
  }, []);

  return {
    items: state.items,
    includedItems,
    includedCount: includedItems.length,
    totals,
    canLog: validationError === null,
    validationError,
    setName,
    setBrand,
    setQuantity,
    setGrams,
    setUnit,
    setMacro,
    applyMultiplier,
    fixCalories,
    toggleIncluded,
    removeItem,
    addItem,
    reset,
  };
}

/* -------------------------------------------------------------------------- */
/* Payload parsing                                                            */
/* -------------------------------------------------------------------------- */

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function coerceVisionItem(raw: unknown): VisionFoodItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Partial<VisionFoodItem>;
  if (typeof item.name !== 'string') return null;
  return {
    name: item.name,
    brand: typeof item.brand === 'string' ? item.brand : null,
    quantity: finite(item.quantity, 1),
    unit: item.unit && SERVING_UNITS.includes(item.unit) ? item.unit : 'serving',
    servingLabel: typeof item.servingLabel === 'string' ? item.servingLabel : '',
    estimatedGrams: nonNegative(item.estimatedGrams),
    macros: finiteMacros(item.macros),
    confidence: Math.min(1, Math.max(0, finite(item.confidence))),
    notes: typeof item.notes === 'string' ? item.notes : null,
  };
}

/**
 * Parses the `payload` query param handed over by the scan screen.
 * Returns null for anything malformed so the screen can show an error instead
 * of crashing.
 */
export function parseVisionPayload(raw: string | string[] | undefined | null): VisionResult | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const candidates = [value, safeDecode(value)].filter((c): c is string => typeof c === 'string');
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const data = parsed as Partial<VisionResult>;
    if (!Array.isArray(data.items)) continue;
    const items = data.items.map(coerceVisionItem).filter((i): i is VisionFoodItem => i !== null);
    return {
      mode: data.mode === 'nutrition_label' ? 'nutrition_label' : 'food_photo',
      items,
      provider: typeof data.provider === 'string' ? data.provider : 'unknown',
      modelId: typeof data.modelId === 'string' ? data.modelId : '',
      latencyMs: finite(data.latencyMs),
      rawText: typeof data.rawText === 'string' ? data.rawText : null,
      warnings: Array.isArray(data.warnings)
        ? data.warnings.filter((w): w is string => typeof w === 'string')
        : [],
    };
  }
  return null;
}
