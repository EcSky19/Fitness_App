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
/** Longest free-text field we keep; anything beyond this is model noise. */
const MAX_TEXT_LENGTH = 120;
const MAX_NOTES_LENGTH = 280;
/** 100 kg of a single food is never a real portion. */
const MAX_GRAMS = 100_000;
/** Ceiling for a single macro/calorie figure, so garbage can't poison day totals. */
const MAX_MACRO = 100_000;

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

/**
 * A number as models write it: digits with optional grouping/decimal separators
 * and an optional exponent. Deliberately matches `.5` and `1,200` as one token
 * so the separators can be interpreted in context.
 */
const NUMBER_PATTERN = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?`;
const MIXED_FRACTION_RE = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/;
const FRACTION_RE = new RegExp(String.raw`^(${NUMBER_PATTERN})\s*/\s*(${NUMBER_PATTERN})`);
const RANGE_RE = new RegExp(String.raw`^(${NUMBER_PATTERN})\s*(?:-|–|to)\s*(${NUMBER_PATTERN})`, 'i');
const NUMBER_RE = new RegExp(String.raw`-?${NUMBER_PATTERN}`);

const THOUSANDS_RE = /^-?\d{1,3}(?:,\d{3})+$/;
const DECIMAL_COMMA_RE = /^-?\d+,\d{1,2}$/;

/**
 * Interprets one numeric token.
 *
 * A comma is a thousands separator only when it groups exactly three digits
 * (`1,200` -> 1200). A trailing group of one or two digits is read as a
 * European decimal comma (`1,2` -> 1.2), because no locale groups thousands
 * that way. Anything else has its commas stripped.
 */
function parseNumericToken(token: string): number | null {
  let text = token;
  if (THOUSANDS_RE.test(text)) text = text.replace(/,/g, '');
  else if (DECIMAL_COMMA_RE.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');

  if (!text || text === '-') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Coerces "12g", "1,200", "~250", "2-3", "1/2", ".5", "1e3" and `{value: 3}` into a number. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null || value === undefined) return null;

  if (isRecord(value)) {
    const inner = pick(value, ['value', 'amount', 'grams', 'quantity', 'number']);
    return inner === undefined ? null : toNumber(inner);
  }

  if (typeof value !== 'string') return null;

  const cleaned = value.replace(/[~≈><]/g, '').trim();
  if (!cleaned) return null;

  const mixed = cleaned.match(MIXED_FRACTION_RE);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator) return Number(mixed[1]) + Number(mixed[2]) / denominator;
  }

  const fraction = cleaned.match(FRACTION_RE);
  if (fraction) {
    const numerator = parseNumericToken(fraction[1] ?? '');
    const denominator = parseNumericToken(fraction[2] ?? '');
    if (numerator !== null && denominator) return numerator / denominator;
  }

  const range = cleaned.match(RANGE_RE);
  if (range) {
    const low = parseNumericToken(range[1] ?? '');
    const high = parseNumericToken(range[2] ?? '');
    if (low !== null && high !== null) return (low + high) / 2;
  }

  const match = cleaned.match(NUMBER_RE);
  return match ? parseNumericToken(match[0]) : null;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Caps free text so one runaway model field can't reach the diary or a warning. */
function truncate(value: string, max = MAX_TEXT_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** First usable (non-empty) text across `keys`, so an empty first field can't defeat the fallbacks. */
function firstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = truncate(toText(record[key]));
    if (value) return value;
  }
  return '';
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  // `-0` compares equal to 0 but serialises and matches differently.
  return rounded === 0 ? 0 : rounded;
}

/** Non-negative, finite, rounded, and capped at a physically possible value. */
function clampMacro(value: unknown, warnings: string[], label: string, name: string): number {
  const parsed = toNumber(value);
  if (parsed === null) return 0;
  if (parsed < 0) {
    warnings.push(`Negative ${label} for ${name} was corrected to 0.`);
    return 0;
  }
  if (parsed > MAX_MACRO) {
    warnings.push(`Implausible ${label} for ${name} was ignored.`);
    return 0;
  }
  return round(parsed);
}

function clampOptionalMacro(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === null) return undefined;
  return round(Math.min(MAX_MACRO, Math.max(0, parsed)));
}

/**
 * Accepts 0..1 and 0..100 percentages.
 *
 * Anything greater than 1 is read as a percentage (`85` -> 0.85), so a bare `1`
 * means full confidence rather than 1%. Models that want 1% must say `0.01`.
 */
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

  warnings.push(`Unknown unit "${truncate(toText(value), 24)}" for ${name}; using ${fallback}.`);
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

/**
 * Rebuilds a document that stopped mid-stream because the model hit its token
 * limit: rewinds to the last value that was definitely complete and closes the
 * containers still open at that point. Returns `null` when there is nothing to
 * salvage (so genuinely broken input still fails).
 */
function repairTruncated(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let stringIsValue = false;
  let previous = '';
  let safeIndex = -1;
  let safeStack: string[] = [];

  const mark = (index: number): void => {
    if (stack.length === 0) return;
    safeIndex = index;
    safeStack = [...stack];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        inString = false;
        previous = '"';
        if (stringIsValue) mark(i + 1);
      }
      continue;
    }

    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue;

    if (char === '"') {
      inString = true;
      // Inside an array every string is a value; inside an object only the one
      // that follows a colon is.
      stringIsValue = stack[stack.length - 1] === '[' || previous === ':';
      continue;
    }

    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      stack.pop();
      mark(i + 1);
    } else if (char === ',') mark(i);

    previous = char ?? '';
  }

  if (!inString && stack.length === 0) return null;
  if (safeIndex < 0) return null;

  const closers = safeStack
    .reverse()
    .map((open) => (open === '{' ? '}' : ']'))
    .join('');
  return text.slice(0, safeIndex) + closers;
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

  // Some models emit trailing commas or single quotes.
  const repaired = stripped
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/'/g, '"');
  const fromRepaired = tryParse(repaired) ?? tryParse(balancedSlice(repaired, '{', '}'));
  if (fromRepaired !== undefined) return fromRepaired;

  // Last resort: the response was cut off mid-object.
  return tryParse(repairTruncated(stripped)) ?? tryParse(repairTruncated(trimmed));
}

function collectWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => truncate(toText(entry), MAX_NOTES_LENGTH))
    .filter((entry) => entry.length > 0);
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

  const name = firstText(source, ['name', 'food', 'item', 'label', 'product', 'description']);
  if (!name) return null;

  const brandText = truncate(toText(pick(source, ['brand', 'brandName', 'brand_name', 'manufacturer'])));
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
  if (gramsRaw !== null && gramsRaw > 0 && gramsRaw <= MAX_GRAMS) {
    estimatedGrams = round(gramsRaw);
  } else if (gramsRaw !== null && gramsRaw > MAX_GRAMS) {
    estimatedGrams = DEFAULT_GRAMS;
    warnings.push(`Implausible portion size for ${name}; assumed ${DEFAULT_GRAMS} g.`);
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
    // Hold a derived figure to the same ceiling as a stated one: the macros are
    // each capped at MAX_MACRO, but their energy sum can be many times larger,
    // and an uncapped value here would poison day totals exactly as a raw
    // out-of-range `calories` field would.
    calories = Math.min(MAX_MACRO, Math.round(derived));
    warnings.push(`Calories missing for ${name}; derived from macros.`);
  } else if (calories > 0 && derived > 0) {
    // Symmetric: the same absolute gap warns whichever figure is the larger one.
    const drift = Math.abs(calories - derived) / Math.max(Math.min(calories, derived), 1);
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

  const servingLabelText = truncate(
    toText(pick(source, ['servingLabel', 'serving_label', 'serving', 'servingSize', 'serving_size', 'portion']))
  );
  const servingLabel = servingLabelText || buildServingLabel(quantity, unit, estimatedGrams);

  const notesText = truncate(toText(pick(source, ['notes', 'note', 'assumption', 'comment'])), MAX_NOTES_LENGTH);
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
