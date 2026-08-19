/**
 * Hardened parser for vision model output.
 *
 * Real LLM answers arrive wrapped in markdown fences, prefixed with prose,
 * carrying "12g" style strings, percentages for confidence and occasionally a
 * bare array. `parseVisionJson` normalises all of that into `VisionFoodItem[]`
 * and NEVER throws: on total garbage it returns `{ items: [], warnings: [...] }`.
 */
import type { Macros, ServingUnit, VisionFoodItem, VisionMode } from '@/types';

export interface ParsedVision {
  items: VisionFoodItem[];
  warnings: string[];
}

const SERVING_UNITS: ServingUnit[] = ['g', 'ml', 'oz', 'serving', 'piece', 'cup', 'tbsp', 'tsp'];

const UNIT_ALIASES: Record<string, ServingUnit> = {
  g: 'g',
  gr: 'g',
  gm: 'g',
  gms: 'g',
  gram: 'g',
  grams: 'g',
  gramme: 'g',
  grammes: 'g',
  ml: 'ml',
  milliliter: 'ml',
  millilitre: 'ml',
  milliliters: 'ml',
  millilitres: 'ml',
  cc: 'ml',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  serving: 'serving',
  servings: 'serving',
  portion: 'serving',
  portions: 'serving',
  container: 'serving',
  package: 'serving',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  item: 'piece',
  items: 'piece',
  slice: 'piece',
  slices: 'piece',
  unit: 'piece',
  whole: 'piece',
  each: 'piece',
  cup: 'cup',
  cups: 'cup',
  tbsp: 'tbsp',
  tbs: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
};

const MAX_ITEMS = 25;
const CALORIE_MISMATCH_TOLERANCE = 0.3;
const DEFAULT_GRAMS = 100;
const DEFAULT_CONFIDENCE = 0.5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Coerces "12g", "1,200", "~250", "2-3", "1/2" and `{value: 3}` into a number. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null || value === undefined) return null;

  if (isRecord(value)) {
    const inner = pick(value, ['value', 'amount', 'grams', 'quantity', 'number']);
    return inner === undefined ? null : toNumber(inner);
  }

  if (typeof value !== 'string') return null;

  const cleaned = value
    .replace(/,/g, '')
    .replace(/[~≈><]/g, '')
    .trim();
  if (!cleaned) return null;

  const mixed = cleaned.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator) return Number(mixed[1]) + Number(mixed[2]) / denominator;
  }

  const fraction = cleaned.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator) return Number(fraction[1]) / denominator;
  }

  const range = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/i);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Non-negative, finite, rounded. */
function clampMacro(value: unknown, warnings: string[], label: string, name: string): number {
  const parsed = toNumber(value);
  if (parsed === null) return 0;
  if (parsed < 0) {
    warnings.push(`Negative ${label} for ${name} was corrected to 0.`);
    return 0;
  }
  return round(parsed);
}

function clampOptionalMacro(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === null) return undefined;
  return round(Math.max(0, parsed));
}

/** Accepts 0..1 and 0..100 percentages. */
export function normalizeConfidence(value: unknown): number {
  const parsed = toNumber(value);
  if (parsed === null) return DEFAULT_CONFIDENCE;
  const scaled = parsed > 1 ? parsed / 100 : parsed;
  if (!Number.isFinite(scaled)) return DEFAULT_CONFIDENCE;
  return round(Math.min(1, Math.max(0, scaled)), 2);
}

/** Maps free-form unit text onto `ServingUnit`, falling back per mode. */
export function normalizeUnit(
  value: unknown,
  mode: VisionMode,
  warnings: string[],
  name: string
): ServingUnit {
  const fallback: ServingUnit = mode === 'nutrition_label' ? 'serving' : 'g';
  const raw = toText(value).toLowerCase().replace(/\./g, '').trim();
  if (!raw) return fallback;

  if ((SERVING_UNITS as string[]).includes(raw)) return raw as ServingUnit;

  const alias = UNIT_ALIASES[raw] ?? UNIT_ALIASES[raw.replace(/\s+/g, '')];
  if (alias) return alias;

  const firstWord = raw.split(/[\s/(]/)[0] ?? '';
  const wordAlias = UNIT_ALIASES[firstWord];
  if (wordAlias) return wordAlias;

  warnings.push(`Unknown unit "${toText(value)}" for ${name}; using ${fallback}.`);
  return fallback;
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced && typeof fenced[1] === 'string' && fenced[1].trim()) return fenced[1].trim();
  return text.replace(/```(?:json|JSON)?/g, '').trim();
}

/** Extracts the outermost balanced `{...}` / `[...]` region, ignoring braces inside strings. */
function balancedSlice(text: string, open: '{' | '[', close: '}' | ']'): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParse(candidate: string | null): unknown {
  if (!candidate) return undefined;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

/** Best-effort JSON recovery from prose/fenced/truncated model output. */
export function extractJson(raw: string): unknown {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return undefined;

  const stripped = stripFences(trimmed);
  const candidates: (string | null)[] = [
    stripped,
    trimmed,
    balancedSlice(stripped, '{', '}'),
    balancedSlice(stripped, '[', ']'),
    balancedSlice(trimmed, '{', '}'),
    balancedSlice(trimmed, '[', ']'),
  ];

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }

  // Last resort: some models emit trailing commas or single quotes.
  const repaired = stripped
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/'/g, '"');
  return tryParse(repaired) ?? tryParse(balancedSlice(repaired, '{', '}'));
}

function collectWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => toText(entry)).filter((entry) => entry.length > 0);
}

/** Coerces the parsed root into a list of raw item records. */
function toRawItems(root: unknown): { rawItems: unknown[]; recognised: boolean } {
  if (Array.isArray(root)) return { rawItems: root, recognised: true };

  if (isRecord(root)) {
    const listed = pick(root, ['items', 'foods', 'results', 'data', 'entries', 'detected_items']);
    if (Array.isArray(listed)) return { rawItems: listed, recognised: true };
    if (isRecord(listed)) return { rawItems: [listed], recognised: true };

    const looksLikeItem =
      pick(root, ['name', 'food', 'item', 'label', 'product', 'description']) !== undefined;
    if (looksLikeItem) return { rawItems: [root], recognised: true };

    return { rawItems: [], recognised: false };
  }

  return { rawItems: [], recognised: false };
}

function buildServingLabel(quantity: number, unit: ServingUnit, grams: number): string {
  if (unit === 'g') return `${Math.round(grams)} g`;
  const quantityText = Number.isInteger(quantity) ? String(quantity) : String(round(quantity, 2));
  return `${quantityText} ${unit}`;
}

function normalizeItem(raw: unknown, mode: VisionMode, warnings: string[]): VisionFoodItem | null {
  if (!isRecord(raw)) return null;

  const nested = isRecord(raw.macros) ? raw.macros : isRecord(raw.nutrition) ? raw.nutrition : null;
  const source: Record<string, unknown> = nested ? { ...raw, ...nested } : raw;

  const name = toText(pick(source, ['name', 'food', 'item', 'label', 'product', 'description']));
  if (!name) return null;

  const brandText = toText(pick(source, ['brand', 'brandName', 'brand_name', 'manufacturer']));
  const brand = brandText && brandText.toLowerCase() !== 'null' ? brandText : null;

  const quantityRaw = toNumber(pick(source, ['quantity', 'qty', 'amount', 'servings', 'count']));
  let quantity = quantityRaw !== null && quantityRaw > 0 ? round(quantityRaw, 2) : 1;
  if (quantityRaw !== null && quantityRaw <= 0) {
    warnings.push(`Invalid quantity for ${name}; using 1.`);
    quantity = 1;
  }

  const unit = normalizeUnit(
    pick(source, ['unit', 'units', 'servingUnit', 'serving_unit', 'measure']),
    mode,
    warnings,
    name
  );

  const gramsRaw = toNumber(
    pick(source, [
      'estimatedGrams',
      'estimated_grams',
      'grams',
      'gramsTotal',
      'grams_total',
      'weightGrams',
      'weight_g',
      'weight',
      'servingSizeG',
      'serving_size_g',
    ])
  );
  let estimatedGrams: number;
  if (gramsRaw !== null && gramsRaw > 0) {
    estimatedGrams = round(gramsRaw);
  } else {
    estimatedGrams = DEFAULT_GRAMS;
    warnings.push(`Missing portion size for ${name}; assumed ${DEFAULT_GRAMS} g.`);
  }

  const protein = clampMacro(pick(source, ['protein', 'protein_g', 'proteinG', 'proteins']), warnings, 'protein', name);
  const carbs = clampMacro(
    pick(source, ['carbs', 'carbohydrates', 'carbs_g', 'carbohydrate', 'totalCarbohydrate', 'total_carbohydrate']),
    warnings,
    'carbs',
    name
  );
  const fat = clampMacro(pick(source, ['fat', 'fat_g', 'fats', 'totalFat', 'total_fat']), warnings, 'fat', name);

  let calories = clampMacro(pick(source, ['calories', 'kcal', 'energy', 'calories_kcal', 'energyKcal']), warnings, 'calories', name);

  const derived = protein * 4 + carbs * 4 + fat * 9;
  if (calories <= 0 && derived > 0) {
    calories = Math.round(derived);
    warnings.push(`Calories missing for ${name}; derived from macros.`);
  } else if (calories > 0 && derived > 0) {
    const drift = Math.abs(calories - derived) / Math.max(derived, 1);
    if (drift > CALORIE_MISMATCH_TOLERANCE) {
      warnings.push(`Calories don't match macros for ${name}; double-check the numbers.`);
    }
  }

  const macros: Macros = { calories, protein, carbs, fat };
  const fiber = clampOptionalMacro(pick(source, ['fiber', 'fibre', 'dietaryFiber', 'dietary_fiber']));
  const sugar = clampOptionalMacro(pick(source, ['sugar', 'sugars', 'totalSugars', 'total_sugars']));
  const sodium = clampOptionalMacro(pick(source, ['sodium', 'sodium_mg', 'sodiumMg', 'salt']));
  if (fiber !== undefined) macros.fiber = fiber;
  if (sugar !== undefined) macros.sugar = sugar;
  if (sodium !== undefined) macros.sodium = sodium;

  const servingLabelText = toText(
    pick(source, ['servingLabel', 'serving_label', 'serving', 'servingSize', 'serving_size', 'portion'])
  );
  const servingLabel = servingLabelText || buildServingLabel(quantity, unit, estimatedGrams);

  const notesText = toText(pick(source, ['notes', 'note', 'assumption', 'comment']));
  const notes = notesText && notesText.toLowerCase() !== 'null' ? notesText : null;

  return {
    name,
    brand,
    quantity,
    unit,
    servingLabel,
    estimatedGrams,
    macros,
    confidence: normalizeConfidence(pick(source, ['confidence', 'certainty', 'score'])),
    notes,
  };
}

/**
 * Parses raw model text into normalised items plus human-readable warnings.
 * Never throws.
 */
export function parseVisionJson(raw: string, mode: VisionMode): ParsedVision {
  const warnings: string[] = [];

  try {
    if (typeof raw !== 'string' || !raw.trim()) {
      return { items: [], warnings: ['The vision model returned an empty response.'] };
    }

    const root = extractJson(raw);
    if (root === undefined || root === null) {
      return { items: [], warnings: ["Couldn't read the vision model's response. Try again."] };
    }

    if (isRecord(root)) warnings.push(...collectWarnings(root.warnings));

    const { rawItems, recognised } = toRawItems(root);
    if (!recognised) {
      return {
        items: [],
        warnings: [...warnings, "The vision model's response didn't contain any food items."],
      };
    }

    const limited = rawItems.slice(0, MAX_ITEMS);
    if (rawItems.length > MAX_ITEMS) {
      warnings.push(`Only the first ${MAX_ITEMS} detected items were kept.`);
    }

    const items: VisionFoodItem[] = [];
    let dropped = 0;
    for (const rawItem of limited) {
      const item = normalizeItem(rawItem, mode, warnings);
      if (item) items.push(item);
      else dropped += 1;
    }

    if (dropped > 0) {
      warnings.push(
        dropped === 1 ? 'Skipped 1 item with no name.' : `Skipped ${dropped} items with no name.`
      );
    }
    if (items.length === 0 && limited.length > 0) {
      warnings.push('No usable food items were found in the response.');
    }

    return { items, warnings };
  } catch {
    return { items: [], warnings: ["Couldn't read the vision model's response. Try again."] };
  }
}
