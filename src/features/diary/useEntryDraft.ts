/**
 * State machine behind `app/food-edit.tsx`.
 *
 * One screen serves four entry points and this hook owns every difference:
 *   - `entryId`   -> edit a logged entry
 *   - `foodId`    -> log a food picked in the search screen
 *   - `draft`     -> correct an AI (vision / label) detection handed over as JSON
 *   - `quickAdd`  -> type calories/macros with no food record at all
 *
 * Scaling rules
 *  - When a `Food` record drives the maths, `scaleFoodToEntry` is the source of
 *    truth for grams, serving label and macros.
 *  - As soon as the user corrects a macro by hand, the corrected numbers become
 *    the anchor and later quantity/unit changes scale *those* proportionally.
 *    The vision model only suggests; the user always wins.
 *  - Calories are never silently rewritten from protein/carbs/fat. A mismatch is
 *    surfaced as a warning with an explicit one-tap fix.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  addFoodEntry,
  bumpFoodUsage,
  deleteFoodEntry,
  getFood,
  getFoodEntry,
  updateFoodEntry,
  upsertFood,
} from '@/db/repositories';
import { macrosToCalories, roundTo, scaleMacros, todayISO, isValidISODate } from '@/domain';
import {
  QUICK_ADD_UNITS,
  resolveFoodById,
  scaleFoodToEntry,
  suggestUnitsForFood,
  unitLabel,
} from '@/services/foodSearch';
import { useAppStore } from '@/store/appStore';
import { MEAL_TYPES } from '@/types/constants';
import type {
  Food,
  FoodEntry,
  FoodSource,
  ID,
  ISODate,
  Macros,
  MealType,
  ServingUnit,
} from '@/types';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type EntryMode = 'edit' | 'food' | 'draft' | 'quick_add';

export type MacroKey = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodium';

export type NewFoodEntry = Omit<FoodEntry, 'id' | 'createdAt' | 'updatedAt'>;
export type NewFood = Omit<Food, 'id' | 'createdAt' | 'updatedAt'>;

export type RouteParamValue = string | string[] | undefined;

export interface EntryDraftParams {
  entryId?: RouteParamValue;
  foodId?: RouteParamValue;
  draft?: RouteParamValue;
  quickAdd?: RouteParamValue;
  date?: RouteParamValue;
  mealType?: RouteParamValue;
}

/** Anchor used to scale macros proportionally when no `Food` record applies. */
export interface ScaleBase {
  grams: number;
  quantity: number;
  unit: ServingUnit;
  macros: Macros;
}

export interface EntryDraftState {
  mode: EntryMode;
  loading: boolean;
  /** Non-fatal problem shown as a banner (bad draft payload, missing record...). */
  warning: string | null;
  entryId: ID | null;
  foodId: ID | null;
  food: Food | null;
  name: string;
  brand: string;
  quantity: number | null;
  unit: ServingUnit;
  units: ServingUnit[];
  gramsTotal: number;
  servingLabel: string;
  macros: Macros;
  date: ISODate;
  mealType: MealType;
  photoUri: string | null;
  source: FoodSource;
  visionConfidence: number | null;
  loggedAt: string;
  base: ScaleBase;
  /** True once the user typed a macro value by hand. */
  macrosOverridden: boolean;
  /** `wasEdited` carried over from an already stored entry. */
  wasEditedInitially: boolean;
  /** Serialized snapshot of the hydrated values; `dirty` compares against it. */
  snapshotKey: string;
  dirty: boolean;
}

export type EntryDraftAction =
  | { type: 'hydrate'; patch: Partial<EntryDraftState> }
  | { type: 'setName'; value: string }
  | { type: 'setBrand'; value: string }
  | { type: 'setQuantity'; value: number | null }
  | { type: 'setUnit'; value: ServingUnit }
  | { type: 'setMealType'; value: MealType }
  | { type: 'setDate'; value: ISODate }
  | { type: 'setMacro'; key: MacroKey; value: number | null }
  | { type: 'useComputedCalories' }
  | { type: 'setWarning'; value: string | null };

export interface EntryDraftErrors {
  name?: string;
  quantity?: string;
  macros?: string;
}

export interface CalorieCheck {
  /** kcal implied by protein/carbs/fat at 4/4/9. */
  computed: number;
  entered: number;
  /** `entered - computed` */
  delta: number;
  isMismatch: boolean;
}

/* -------------------------------------------------------------------------- */
/* Constants + small helpers                                                  */
/* -------------------------------------------------------------------------- */

export const ZERO_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/** Relative gap between typed calories and 4/4/9 calories before we warn. */
export const CALORIE_TOLERANCE = 0.1;

export const MACRO_KEYS: MacroKey[] = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'sodium',
];

const DEFAULT_UNITS: ServingUnit[] = ['g', 'serving', 'oz', 'cup', 'piece'];

/** Grams in one of each fixed-size unit; `serving`/`piece` depend on the food. */
const UNIT_GRAMS: Record<ServingUnit, number | null> = {
  g: 1,
  ml: 1,
  oz: 28.349523125,
  cup: 240,
  tbsp: 15,
  tsp: 5,
  serving: null,
  piece: null,
};

const SERVING_UNITS: ServingUnit[] = ['g', 'ml', 'oz', 'serving', 'piece', 'cup', 'tbsp', 'tsp'];

export function firstParam(value: RouteParamValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isMealType(value: unknown): value is MealType {
  return typeof value === 'string' && (MEAL_TYPES as string[]).includes(value);
}

export function isServingUnit(value: unknown): value is ServingUnit {
  return typeof value === 'string' && (SERVING_UNITS as string[]).includes(value);
}

/** `'YYYY-MM-DD'` or `undefined`. Rejects shapes that name no real day. */
export function normalizeDateParam(value: RouteParamValue): ISODate | undefined {
  const raw = firstParam(value)?.trim();
  return raw && isValidISODate(raw) ? raw : undefined;
}

export function normalizeMealParam(value: RouteParamValue): MealType | undefined {
  const raw = firstParam(value);
  return isMealType(raw) ? raw : undefined;
}

/** Meal guessed from the wall clock, used when a caller omits `mealType`. */
export function inferMealType(now: Date = new Date()): MealType {
  const hour = now.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function toNonNegative(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Proportionally scales ABSOLUTE macros by `ratio`.
 * `scaleMacros(per100g, grams)` computes `per100g * grams / 100`, so feeding it
 * `ratio * 100` grams yields exactly `macros * ratio` — the domain keeps owning
 * the arithmetic.
 */
export function scaleMacrosByRatio(macros: Macros, ratio: number): Macros {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
  const scaled = scaleMacros(macros, safeRatio * 100) as Macros | undefined;
  const out: Macros = {
    calories: toNonNegative(scaled?.calories),
    protein: toNonNegative(scaled?.protein),
    carbs: toNonNegative(scaled?.carbs),
    fat: toNonNegative(scaled?.fat),
  };
  // Optional micros are preserved even if the domain helper drops them.
  if (macros.fiber != null) out.fiber = scaled?.fiber ?? roundTo(macros.fiber * safeRatio, 1);
  if (macros.sugar != null) out.sugar = scaled?.sugar ?? roundTo(macros.sugar * safeRatio, 1);
  if (macros.sodium != null) out.sodium = scaled?.sodium ?? roundTo(macros.sodium * safeRatio, 1);
  return out;
}

function gramsPerUnit(base: ScaleBase, unit: ServingUnit): number {
  const anchor = base.quantity > 0 && base.grams > 0 ? base.grams / base.quantity : 0;
  if (unit === base.unit && anchor > 0) return anchor;
  const fixed = UNIT_GRAMS[unit];
  if (fixed != null) return fixed;
  return anchor;
}

/** Grams for `quantity` of `unit` when there is no `Food` record to ask. */
export function projectGrams(base: ScaleBase, quantity: number, unit: ServingUnit): number {
  return roundTo(gramsPerUnit(base, unit) * Math.max(0, quantity), 1);
}

/** Scale factor from the anchor to `grams`/`quantity`, divide-by-zero safe. */
export function amountRatio(base: ScaleBase, grams: number, quantity: number): number {
  if (base.grams > 0) return Math.max(0, grams) / base.grams;
  if (base.quantity > 0) return Math.max(0, quantity) / base.quantity;
  return 1;
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(roundTo(quantity, 2));
}

/** `"1.5 cups (360 g)"` for entries with no `Food` record behind them. */
export function draftServingLabel(quantity: number, unit: ServingUnit, grams: number): string {
  const label = `${formatQuantity(quantity)} ${unitLabel(unit, quantity)}`;
  if (unit === 'g' || unit === 'ml' || grams <= 0) return label;
  return `${label} (${roundTo(grams, 0)} g)`;
}

function unionUnits(units: ServingUnit[], unit: ServingUnit): ServingUnit[] {
  return units.includes(unit) ? units : [unit, ...units];
}

function safeSuggestUnits(food: Food | null, unit: ServingUnit): ServingUnit[] {
  const suggested = food ? suggestUnitsForFood(food) : QUICK_ADD_UNITS;
  const list = Array.isArray(suggested) && suggested.length > 0 ? suggested : DEFAULT_UNITS;
  return unionUnits(list.filter(isServingUnit), unit);
}

function readMacros(value: unknown): Macros | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const macros: Macros = {
    calories: toNonNegative(raw.calories),
    protein: toNonNegative(raw.protein),
    carbs: toNonNegative(raw.carbs),
    fat: toNonNegative(raw.fat),
  };
  if (raw.fiber != null) macros.fiber = toNonNegative(raw.fiber);
  if (raw.sugar != null) macros.sugar = toNonNegative(raw.sugar);
  if (raw.sodium != null) macros.sodium = toNonNegative(raw.sodium);
  return macros;
}

export interface ParsedDraft {
  value: Partial<NewFoodEntry> | null;
  error: string | null;
}

const DRAFT_ERROR = "That scanned item couldn't be read — start from a quick add.";

/**
 * Defensively decodes the `draft` param handed over by the scan flow.
 * Never throws: a malformed payload degrades to quick-add plus a warning banner.
 */
export function parseDraftParam(raw: RouteParamValue): ParsedDraft {
  const text = firstParam(raw);
  if (!text) return { value: null, error: null };

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(decodeURIComponent(text));
    } catch {
      return { value: null, error: DRAFT_ERROR };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: null, error: DRAFT_ERROR };
  }

  const obj = parsed as Record<string, unknown>;
  const macros = readMacros(obj.macros);
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name && !macros) return { value: null, error: DRAFT_ERROR };

  const quantity = toNonNegative(obj.quantity);
  const value: Partial<NewFoodEntry> = {
    name,
    brand: typeof obj.brand === 'string' ? obj.brand : null,
    foodId: typeof obj.foodId === 'string' ? obj.foodId : null,
    quantity: quantity > 0 ? quantity : 1,
    unit: isServingUnit(obj.unit) ? obj.unit : 'serving',
    servingLabel: typeof obj.servingLabel === 'string' ? obj.servingLabel : '',
    gramsTotal: toNonNegative(obj.gramsTotal),
    macros: macros ?? { ...ZERO_MACROS },
    photoUri: typeof obj.photoUri === 'string' ? obj.photoUri : null,
    source: typeof obj.source === 'string' ? (obj.source as FoodSource) : 'vision',
    visionConfidence:
      typeof obj.visionConfidence === 'number' && Number.isFinite(obj.visionConfidence)
        ? Math.min(1, Math.max(0, obj.visionConfidence))
        : null,
  };
  if (isMealType(obj.mealType)) value.mealType = obj.mealType;
  if (typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.date)) value.date = obj.date;

  return { value, error: null };
}

/* -------------------------------------------------------------------------- */
/* Derived helpers (pure, unit tested)                                        */
/* -------------------------------------------------------------------------- */

/** kcal implied by the macros, and whether the typed calories disagree. */
export function calorieCheck(macros: Macros, tolerance = CALORIE_TOLERANCE): CalorieCheck {
  const computed = roundTo(
    macrosToCalories({ protein: macros.protein, carbs: macros.carbs, fat: macros.fat }),
    0
  );
  const entered = roundTo(macros.calories, 0);
  const delta = roundTo(entered - computed, 0);
  const isMismatch = computed > 0 && Math.abs(delta) / computed > tolerance;
  return { computed, entered, delta, isMismatch };
}

export function validateEntryDraft(state: EntryDraftState): EntryDraftErrors {
  const errors: EntryDraftErrors = {};
  if (!state.name.trim()) errors.name = 'Give this entry a name.';
  if (state.quantity == null || state.quantity <= 0) errors.quantity = 'Amount must be more than 0.';
  const negative = MACRO_KEYS.some((key) => {
    const value = state.macros[key];
    return typeof value === 'number' && value < 0;
  });
  if (negative) errors.macros = 'Values cannot be negative.';
  return errors;
}

export function isEntryDraftValid(state: EntryDraftState): boolean {
  return Object.keys(validateEntryDraft(state)).length === 0;
}

/** True when the user touched any value (AI-provided or not). */
export function wasEditedFor(state: EntryDraftState): boolean {
  return state.wasEditedInitially || state.dirty;
}

function snapshotOf(state: EntryDraftState): string {
  return JSON.stringify([
    state.name.trim(),
    state.brand.trim(),
    state.quantity,
    state.unit,
    state.date,
    state.mealType,
    MACRO_KEYS.map((key) => state.macros[key] ?? null),
  ]);
}

function withDirty(state: EntryDraftState): EntryDraftState {
  const dirty = snapshotOf(state) !== state.snapshotKey;
  return dirty === state.dirty ? state : { ...state, dirty };
}

function rebased(state: EntryDraftState, macros: Macros): ScaleBase {
  return {
    grams: state.gramsTotal,
    quantity: state.quantity ?? 0,
    unit: state.unit,
    macros,
  };
}

/* -------------------------------------------------------------------------- */
/* Reducer                                                                    */
/* -------------------------------------------------------------------------- */

function recomputeAmount(
  state: EntryDraftState,
  quantity: number | null,
  unit: ServingUnit
): EntryDraftState {
  const qty = Math.max(0, quantity ?? 0);

  if (state.food) {
    const scaled = scaleFoodToEntry(state.food, qty, unit);
    const grams = toNonNegative(scaled?.gramsTotal);
    const macros = state.macrosOverridden
      ? scaleMacrosByRatio(state.base.macros, amountRatio(state.base, grams, qty))
      : (readMacros(scaled?.macros) ?? state.macros);
    return {
      ...state,
      quantity,
      unit,
      gramsTotal: grams,
      servingLabel: scaled?.servingLabel || draftServingLabel(qty, unit, grams),
      macros,
    };
  }

  const grams = projectGrams(state.base, qty, unit);
  return {
    ...state,
    quantity,
    unit,
    gramsTotal: grams,
    servingLabel: draftServingLabel(qty, unit, grams),
    macros: scaleMacrosByRatio(state.base.macros, amountRatio(state.base, grams, qty)),
  };
}

export function entryDraftReducer(
  state: EntryDraftState,
  action: EntryDraftAction
): EntryDraftState {
  switch (action.type) {
    case 'hydrate': {
      const merged: EntryDraftState = { ...state, ...action.patch, dirty: false };
      return { ...merged, snapshotKey: snapshotOf(merged) };
    }
    case 'setName':
      return withDirty({ ...state, name: action.value });
    case 'setBrand':
      return withDirty({ ...state, brand: action.value });
    case 'setQuantity':
      return withDirty(recomputeAmount(state, action.value, state.unit));
    case 'setUnit':
      return withDirty(recomputeAmount(state, state.quantity, action.value));
    case 'setMealType':
      return withDirty({ ...state, mealType: action.value });
    case 'setDate':
      return withDirty({ ...state, date: action.value });
    case 'setMacro': {
      const value = toNonNegative(action.value ?? 0);
      const macros: Macros = { ...state.macros, [action.key]: value };
      return withDirty({ ...state, macros, macrosOverridden: true, base: rebased(state, macros) });
    }
    case 'useComputedCalories': {
      const { computed } = calorieCheck(state.macros);
      const macros: Macros = { ...state.macros, calories: computed };
      return withDirty({ ...state, macros, macrosOverridden: true, base: rebased(state, macros) });
    }
    case 'setWarning':
      return { ...state, warning: action.value };
    default:
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Initial state                                                              */
/* -------------------------------------------------------------------------- */

export interface EntryDraftDefaults {
  date: ISODate;
  mealType: MealType;
}

export function initialEntryDraftState(
  params: EntryDraftParams,
  defaults: EntryDraftDefaults
): EntryDraftState {
  const entryId = firstParam(params.entryId) ?? null;
  const foodId = firstParam(params.foodId) ?? null;
  const parsedDraft = parseDraftParam(params.draft);
  const draft = parsedDraft.value;

  const date = normalizeDateParam(params.date) ?? defaults.date;
  const mealType = normalizeMealParam(params.mealType) ?? defaults.mealType;

  let mode: EntryMode = 'quick_add';
  if (entryId) mode = 'edit';
  else if (draft) mode = 'draft';
  else if (foodId) mode = 'food';

  const quantity = draft?.quantity ?? 1;
  const unit: ServingUnit = draft?.unit ?? 'serving';
  const macros = draft?.macros ?? { ...ZERO_MACROS };
  const grams = draft?.gramsTotal ?? 0;

  const base: EntryDraftState = {
    mode,
    loading: mode === 'edit' || mode === 'food',
    warning: parsedDraft.error,
    entryId,
    foodId: draft?.foodId ?? foodId,
    food: null,
    name: draft?.name ?? '',
    brand: draft?.brand ?? '',
    quantity,
    unit,
    units: safeSuggestUnits(null, unit),
    gramsTotal: grams,
    servingLabel: draft?.servingLabel || draftServingLabel(quantity, unit, grams),
    macros,
    date: draft?.date ?? date,
    mealType: draft?.mealType ?? mealType,
    photoUri: draft?.photoUri ?? null,
    source: draft?.source ?? (mode === 'food' ? 'custom' : 'quick_add'),
    visionConfidence: draft?.visionConfidence ?? null,
    loggedAt: new Date().toISOString(),
    base: { grams, quantity, unit, macros },
    macrosOverridden: false,
    wasEditedInitially: false,
    snapshotKey: '',
    dirty: false,
  };

  return { ...base, snapshotKey: snapshotOf(base) };
}

function patchFromEntry(entry: FoodEntry, food: Food | null): Partial<EntryDraftState> {
  const macros = readMacros(entry.macros) ?? { ...ZERO_MACROS };
  return {
    loading: false,
    entryId: entry.id,
    foodId: entry.foodId,
    food,
    name: entry.name,
    brand: entry.brand ?? '',
    quantity: entry.quantity,
    unit: entry.unit,
    units: safeSuggestUnits(food, entry.unit),
    gramsTotal: entry.gramsTotal,
    servingLabel: entry.servingLabel,
    macros,
    date: entry.date,
    mealType: entry.mealType,
    photoUri: entry.photoUri,
    source: entry.source,
    visionConfidence: entry.visionConfidence,
    loggedAt: entry.loggedAt,
    base: { grams: entry.gramsTotal, quantity: entry.quantity, unit: entry.unit, macros },
    // A previously edited entry already holds the user's corrected macros; treat
    // them as the scaling anchor so a later quantity/unit change keeps the
    // correction instead of silently re-deriving from the food record.
    macrosOverridden: entry.wasEdited,
    wasEditedInitially: entry.wasEdited,
  };
}

function patchFromFood(food: Food, quantity: number): Partial<EntryDraftState> {
  const units = safeSuggestUnits(food, 'serving');
  const unit = units[0] ?? 'serving';
  const scaled = scaleFoodToEntry(food, quantity, unit);
  const grams = toNonNegative(scaled?.gramsTotal);
  const macros = readMacros(scaled?.macros) ?? { ...ZERO_MACROS };
  // A `seed:` id is synthetic — that row only exists in the built-in catalogue,
  // so the entry must not reference it through the `food_id` foreign key.
  const persistedId = food.id.startsWith('seed:') ? null : food.id;
  return {
    loading: false,
    food,
    foodId: persistedId,
    name: food.name,
    brand: food.brand ?? '',
    quantity,
    unit,
    units,
    gramsTotal: grams,
    servingLabel: scaled?.servingLabel || draftServingLabel(quantity, unit, grams),
    macros,
    source: food.source === 'seed' ? 'custom' : food.source,
    base: { grams, quantity, unit, macros },
  };
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                              */
/* -------------------------------------------------------------------------- */

export function buildEntryInput(state: EntryDraftState): NewFoodEntry {
  const quantity = state.quantity ?? 0;
  return {
    date: state.date,
    mealType: state.mealType,
    foodId: state.foodId,
    name: state.name.trim(),
    brand: state.brand.trim() ? state.brand.trim() : null,
    quantity,
    unit: state.unit,
    servingLabel: state.servingLabel || draftServingLabel(quantity, state.unit, state.gramsTotal),
    gramsTotal: roundTo(state.gramsTotal, 1),
    macros: state.macros,
    photoUri: state.photoUri,
    source: state.source,
    visionConfidence: state.visionConfidence,
    wasEdited: wasEditedFor(state),
    loggedAt: state.loggedAt,
  };
}

/** Converts the corrected absolute macros back into a per-100 g food record. */
export function buildCustomFoodInput(state: EntryDraftState): NewFood {
  const grams = state.gramsTotal > 0 ? state.gramsTotal : 100;
  const per100g = scaleMacrosByRatio(state.macros, 100 / grams);
  return {
    name: state.name.trim(),
    brand: state.brand.trim() ? state.brand.trim() : null,
    per100g,
    servingSizeG: roundTo(grams, 1),
    servingLabel: state.servingLabel || draftServingLabel(1, state.unit, grams),
    barcode: null,
    source: 'custom',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseEntryDraftResult {
  state: EntryDraftState;
  mode: EntryMode;
  loading: boolean;
  saving: boolean;
  error: string | null;
  errors: EntryDraftErrors;
  canSave: boolean;
  wasEdited: boolean;
  calories: CalorieCheck;
  setName: (value: string) => void;
  setBrand: (value: string) => void;
  setQuantity: (value: number | null) => void;
  setUnit: (value: ServingUnit) => void;
  setMealType: (value: MealType) => void;
  setDate: (value: ISODate) => void;
  setMacro: (key: MacroKey, value: number | null) => void;
  useComputedCalories: () => void;
  dismissWarning: () => void;
  toEntryInput: () => NewFoodEntry;
  save: () => Promise<boolean>;
  remove: () => Promise<boolean>;
  saveAsCustomFood: () => Promise<boolean>;
}

export function useEntryDraft(params: EntryDraftParams): UseEntryDraftResult {
  const selectedDate = useAppStore((s) => s.selectedDate);

  const [state, dispatch] = useReducer(
    entryDraftReducer,
    params,
    (initial): EntryDraftState =>
      initialEntryDraftState(initial, {
        date: selectedDate || todayISO(),
        mealType: inferMealType(),
      })
  );

  const [saving, setSaving] = useState(false);
  /**
   * `saving` only blocks the button on the *next* render; a double tap is
   * delivered inside a single batch, so the guard has to be synchronous.
   */
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const entryIdParam = firstParam(params.entryId);
  const foodIdParam = firstParam(params.foodId);
  const mode = state.mode;
  const initialQuantity = state.quantity ?? 1;

  useEffect(() => {
    let cancelled = false;

    async function hydrate(): Promise<void> {
      if (mode === 'edit' && entryIdParam) {
        const entry = await getFoodEntry(entryIdParam);
        if (cancelled) return;
        if (!entry) {
          dispatch({
            type: 'hydrate',
            patch: { loading: false, warning: 'That entry no longer exists.' },
          });
          return;
        }
        let food: Food | null = null;
        if (entry.foodId) {
          try {
            food = (await getFood(entry.foodId)) ?? null;
          } catch {
            food = null;
          }
        }
        if (cancelled) return;
        dispatch({ type: 'hydrate', patch: patchFromEntry(entry, food) });
        return;
      }

      if (mode === 'food' && foodIdParam) {
        // `resolveFoodById` also materialises seed foods that search offered
        // before the catalogue finished importing, so the entry can reference
        // a real row.
        const food = await resolveFoodById(foodIdParam);
        if (cancelled) return;
        if (!food) {
          dispatch({
            type: 'hydrate',
            patch: { loading: false, warning: 'That food is no longer available.' },
          });
          return;
        }
        dispatch({ type: 'hydrate', patch: patchFromFood(food, initialQuantity) });
      }
    }

    void hydrate().catch(() => {
      if (cancelled) return;
      dispatch({
        type: 'hydrate',
        patch: { loading: false, warning: 'Could not load this item. You can still edit it here.' },
      });
    });

    return () => {
      cancelled = true;
    };
    // Hydration runs once per route target; later edits must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, entryIdParam, foodIdParam]);

  const errors = useMemo(() => validateEntryDraft(state), [state]);
  const calories = useMemo(() => calorieCheck(state.macros), [state.macros]);
  const canSave = Object.keys(errors).length === 0 && !state.loading && !saving;
  const wasEdited = wasEditedFor(state);

  const setName = useCallback((value: string) => dispatch({ type: 'setName', value }), []);
  const setBrand = useCallback((value: string) => dispatch({ type: 'setBrand', value }), []);
  const setQuantity = useCallback(
    (value: number | null) => dispatch({ type: 'setQuantity', value }),
    []
  );
  const setUnit = useCallback((value: ServingUnit) => dispatch({ type: 'setUnit', value }), []);
  const setMealType = useCallback((value: MealType) => dispatch({ type: 'setMealType', value }), []);
  const setDate = useCallback((value: ISODate) => dispatch({ type: 'setDate', value }), []);
  const setMacro = useCallback(
    (key: MacroKey, value: number | null) => dispatch({ type: 'setMacro', key, value }),
    []
  );
  const useComputedCalories = useCallback(() => dispatch({ type: 'useComputedCalories' }), []);
  const dismissWarning = useCallback(() => dispatch({ type: 'setWarning', value: null }), []);
  const toEntryInput = useCallback(() => buildEntryInput(state), [state]);

  const save = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    if (Object.keys(validateEntryDraft(state)).length > 0) return false;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const input = buildEntryInput(state);
      if (state.mode === 'edit' && state.entryId) {
        await updateFoodEntry(state.entryId, input);
      } else {
        await addFoodEntry(input);
      }
      if (state.foodId) {
        try {
          await bumpFoodUsage(state.foodId);
        } catch {
          // Usage stats are best-effort; never fail a save because of them.
        }
      }
      useAppStore.getState().invalidate();
      return true;
    } catch {
      setError('Could not save this entry. Please try again.');
      return false;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }, [state]);

  const remove = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    if (!state.entryId) return false;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await deleteFoodEntry(state.entryId);
      useAppStore.getState().invalidate();
      return true;
    } catch {
      setError('Could not delete this entry. Please try again.');
      return false;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }, [state.entryId]);

  const saveAsCustomFood = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    if (!state.name.trim()) return false;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await upsertFood(buildCustomFoodInput(state));
      useAppStore.getState().invalidate();
      return true;
    } catch {
      setError('Could not save this as a custom food.');
      return false;
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }, [state]);

  return {
    state,
    mode,
    loading: state.loading,
    saving,
    error,
    errors,
    canSave,
    wasEdited,
    calories,
    setName,
    setBrand,
    setQuantity,
    setUnit,
    setMealType,
    setDate,
    setMacro,
    useComputedCalories,
    dismissWarning,
    toEntryInput,
    save,
    remove,
    saveAsCustomFood,
  };
}

export default useEntryDraft;
