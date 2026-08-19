/**
 * Food search + serving math.
 *
 * This module is the bridge between the built-in seed database, the SQLite
 * food repository and the diary/scan screens. It is deliberately defensive:
 * search must keep working before the database has been opened, and seeding
 * must never crash app start.
 */

import * as domainModule from '@/domain';
import * as repositoriesModule from '@/db/repositories';
import {
  POPULAR_SEED_NAMES,
  SEED_FOODS,
  seedFoodToFoodInput,
  type FoodCategory,
  type SeedFood,
} from '@/data/foods.seed';
import type { Food, ISODateTime, Macros, ServingUnit } from '@/types';

type FoodInput = Partial<Food> & { name: string; per100g: Macros };

interface DomainApi {
  scaleMacros?: (per100g: Macros, grams: number) => Macros;
}

interface RepositoriesApi {
  searchFoods?: (query: string, limit?: number) => Promise<Food[]> | Food[];
  countFoods?: () => Promise<number> | number;
  seedFoods?: (foods: FoodInput[]) => Promise<unknown> | unknown;
  getFood?: (id: string) => Promise<Food | null> | Food | null;
  upsertFood?: (input: FoodInput) => Promise<Food> | Food;
}

// The domain and repository modules are owned by other modules and may still be
// barrels at build time; resolve their members lazily and fall back gracefully.
const domain = domainModule as unknown as DomainApi;
const repositories = repositoriesModule as unknown as RepositoriesApi;

const GRAMS_PER_OZ = 28.3495;
const DEFAULT_CUP_G = 240;
const FALLBACK_SERVING_G = 100;
const SEED_TIMESTAMP: ISODateTime = '1970-01-01T00:00:00.000Z';

/** Units offered in the quick-add / serving picker, in display order. */
export const QUICK_ADD_UNITS: ServingUnit[] = [
  'g',
  'serving',
  'oz',
  'cup',
  'tbsp',
  'tsp',
  'ml',
  'piece',
];

/**
 * Grams in one US cup, approximated per category.
 *
 * A cup is a volume, so grams depend on density. Water is 240 g/cup and every
 * factor below is expressed against that reference:
 *
 * - beverages 240 g   (water density)
 * - dairy 245 g       (milk/yogurt are slightly denser than water)
 * - condiments 252 g  (sauces, syrups, honey-style thick liquids)
 * - fats_oils 221 g   (oil is ~0.92 g/ml)
 * - prepared 216 g    (mixed dishes, casseroles, soups with solids)
 * - grains 190 g      (cooked rice/pasta, packed loosely)
 * - fruit 156 g       (chopped fruit)
 * - protein 151 g     (diced cooked meat, cooked beans)
 * - nuts_seeds 139 g  (whole nuts have large air gaps)
 * - supplements 120 g (powders)
 * - vegetable 96 g    (chopped raw vegetables are mostly air)
 * - snacks 60 g       (chips/popcorn are very light per cup)
 *
 * When the food is not in the seed database the name is used as a hint, and the
 * final fallback is the 240 g water cup.
 */
export const CUP_GRAMS_BY_CATEGORY: Record<FoodCategory, number> = {
  beverages: 240,
  dairy: 245,
  condiments: 252,
  fats_oils: 221,
  prepared: 216,
  grains: 190,
  fruit: 156,
  protein: 151,
  nuts_seeds: 139,
  supplements: 120,
  vegetable: 96,
  snacks: 60,
};

// ---------------------------------------------------------------- utilities

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function scaleMacrosFallback(per100g: Macros, grams: number): Macros {
  const ratio = safeNumber(grams) / 100;
  const scaled: Macros = {
    calories: round(safeNumber(per100g.calories) * ratio, 0),
    protein: round(safeNumber(per100g.protein) * ratio, 1),
    carbs: round(safeNumber(per100g.carbs) * ratio, 1),
    fat: round(safeNumber(per100g.fat) * ratio, 1),
  };
  if (per100g.fiber !== undefined) scaled.fiber = round(safeNumber(per100g.fiber) * ratio, 1);
  if (per100g.sugar !== undefined) scaled.sugar = round(safeNumber(per100g.sugar) * ratio, 1);
  if (per100g.sodium !== undefined) scaled.sodium = round(safeNumber(per100g.sodium) * ratio, 0);
  return scaled;
}

function scaleMacros(per100g: Macros, grams: number): Macros {
  if (typeof domain.scaleMacros === 'function') {
    try {
      return domain.scaleMacros(per100g, grams);
    } catch {
      // fall through to the local implementation
    }
  }
  return scaleMacrosFallback(per100g, grams);
}

/** Lowercase, accent- and punctuation-insensitive, whitespace-collapsed. */
function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

function foodKey(name: string, brand: string | null | undefined): string {
  return `${normalize(name)}|${normalize(brand ?? '')}`;
}

function slug(input: string): string {
  return normalize(input).replace(/\s+/g, '-');
}

// ------------------------------------------------------- seed <-> Food shape

const SEED_BY_KEY = new Map<string, SeedFood>();
for (const seed of SEED_FOODS) SEED_BY_KEY.set(foodKey(seed.name, seed.brand), seed);

const POPULAR_RANK = new Map<string, number>();
POPULAR_SEED_NAMES.forEach((name, index) => POPULAR_RANK.set(normalize(name), index));

/** Stable synthetic id so the same seed food always maps to the same row. */
export function seedFoodId(seed: SeedFood): string {
  return seed.brand ? `seed:${slug(seed.name)}:${slug(seed.brand)}` : `seed:${slug(seed.name)}`;
}

/** Reverse of {@link seedFoodId}, used to resolve ids handed to other screens. */
const SEED_BY_ID = new Map<string, SeedFood>();
for (const seed of SEED_FOODS) SEED_BY_ID.set(seedFoodId(seed), seed);

/** Present a seed record as a `Food` so UI code can treat both sources alike. */
export function seedFoodToFood(seed: SeedFood): Food {
  return {
    id: seedFoodId(seed),
    name: seed.name,
    brand: seed.brand,
    per100g: { ...seed.per100g },
    servingSizeG: seed.servingSizeG,
    servingLabel: seed.servingLabel,
    barcode: seed.barcode ?? null,
    source: 'seed',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  };
}

// ------------------------------------------------------------ serving units

const LIQUID_NAME_RE =
  /\b(milk|juice|water|coffee|espresso|latte|cappuccino|tea|soda|cola|lemonade|beer|wine|whiskey|vodka|seltzer|kombucha|shake|smoothie|broth|stock|syrup|oil|vinegar|cream)\b/;

const PIECE_LABEL_RE =
  /\b(medium|large|small|slice|slices|piece|pieces|egg|whites?|bar|bars|cookie|donut|muffin|tortilla|pita|naan|bagel|breast|thigh|drumstick|wing|wings|link|links|patty|clove|fillet|chop|steak|capsule|stick|square|squares|roll|taco|burger|sandwich|burrito|quesadilla|pancakes|waffle|nuts|halves|prunes|date|apricot|sheets|spear|cap|pouch|pastry|crackers|chips|cake|container|bottle|can|tail|patties|nigiri)\b/;

function categoryForFood(food: Food): FoodCategory | undefined {
  const seed = SEED_BY_KEY.get(foodKey(food.name, food.brand));
  if (seed) return seed.category;

  const name = normalize(food.name);
  if (/\b(oil|ghee|lard|shortening|mayo|mayonnaise)\b/.test(name)) return 'fats_oils';
  if (LIQUID_NAME_RE.test(name)) return 'beverages';
  if (/\b(yogurt|yoghurt|cheese|butter|milk|cream)\b/.test(name)) return 'dairy';
  if (/\b(rice|pasta|noodle|noodles|oats|oatmeal|quinoa|bread|cereal|tortilla|bagel|flour|potato)\b/.test(name)) {
    return 'grains';
  }
  if (/\b(chips|crisps|popcorn|cracker|crackers|candy|chocolate|cookie|ice cream)\b/.test(name)) return 'snacks';
  if (/\b(sauce|dressing|ketchup|mustard|syrup|honey|jam|salsa|hummus)\b/.test(name)) return 'condiments';
  if (/\b(protein powder|whey|casein|creatine|gainer|collagen)\b/.test(name)) return 'supplements';
  return undefined;
}

/** Grams in one cup of this food; see CUP_GRAMS_BY_CATEGORY for the model. */
export function cupGramsFor(food: Food): number {
  const category = categoryForFood(food);
  return category ? CUP_GRAMS_BY_CATEGORY[category] : DEFAULT_CUP_G;
}

function servingGramsFor(food: Food): number {
  const size = safeNumber(food.servingSizeG);
  return size > 0 ? size : FALLBACK_SERVING_G;
}

function isLiquidFood(food: Food): boolean {
  const category = categoryForFood(food);
  if (category === 'beverages') return true;
  return LIQUID_NAME_RE.test(normalize(food.name)) && !/cheese/.test(normalize(food.name));
}

function isPieceFood(food: Food): boolean {
  return PIECE_LABEL_RE.test(normalize(food.servingLabel ?? ''));
}

export function gramsFor(food: Food, quantity: number, unit: ServingUnit): number {
  const qty = safeNumber(quantity);
  if (qty === 0) return 0;

  switch (unit) {
    case 'g':
    case 'ml':
      return round(qty, 2);
    case 'oz':
      return round(qty * GRAMS_PER_OZ, 2);
    case 'serving':
    case 'piece':
      return round(qty * servingGramsFor(food), 2);
    case 'cup':
      return round(qty * cupGramsFor(food), 2);
    case 'tbsp':
      return round((qty * cupGramsFor(food)) / 16, 2);
    case 'tsp':
      return round((qty * cupGramsFor(food)) / 48, 2);
    default:
      return round(qty, 2);
  }
}

function formatQuantity(quantity: number): string {
  const qty = round(safeNumber(quantity), 2);
  return Number.isInteger(qty) ? String(qty) : String(qty);
}

export function unitLabel(u: ServingUnit, quantity?: number): string {
  const plural = quantity === undefined ? false : Math.abs(quantity) !== 1;
  switch (u) {
    case 'serving':
      return plural ? 'servings' : 'serving';
    case 'piece':
      return plural ? 'pieces' : 'piece';
    case 'cup':
      return plural ? 'cups' : 'cup';
    case 'g':
      return 'g';
    case 'ml':
      return 'ml';
    case 'oz':
      return 'oz';
    case 'tbsp':
      return 'tbsp';
    case 'tsp':
      return 'tsp';
    default:
      return u;
  }
}

export function suggestUnitsForFood(food: Food): ServingUnit[] {
  const category = categoryForFood(food);

  if (category === 'condiments' || category === 'fats_oils') {
    return ['tbsp', 'tsp', 'g', 'serving', 'oz', 'cup'];
  }
  if (category === 'nuts_seeds') return ['g', 'tbsp', 'serving', 'oz', 'cup', 'tsp'];
  if (isLiquidFood(food)) return ['ml', 'cup', 'serving', 'tbsp', 'oz', 'g'];
  if (isPieceFood(food)) return ['piece', 'serving', 'g', 'oz', 'cup'];
  if (category === 'supplements') return ['serving', 'g', 'oz', 'cup', 'tbsp'];
  return ['g', 'serving', 'oz', 'cup', 'tbsp', 'piece'];
}

function describePortion(
  quantity: number,
  unit: ServingUnit,
  gramsTotal: number,
): string {
  const qty = formatQuantity(quantity);
  const grams = round(gramsTotal, 1);

  if (unit === 'g' || unit === 'ml') return `${qty} ${unitLabel(unit)}`;
  return `${qty} ${unitLabel(unit, quantity)} (${grams} g)`;
}

export function scaleFoodToEntry(
  food: Food,
  quantity: number,
  unit: ServingUnit,
): { gramsTotal: number; macros: Macros; servingLabel: string } {
  const gramsTotal = gramsFor(food, quantity, unit);
  return {
    gramsTotal,
    macros: scaleMacros(food.per100g, gramsTotal),
    servingLabel: describePortion(quantity, unit, gramsTotal),
  };
}

export function buildQuickAddFood(name: string, macros: Macros): FoodInput {
  const cleanName = name.trim().length > 0 ? name.trim() : 'Quick add';
  const per100g: Macros = {
    calories: Math.max(0, round(safeNumber(macros.calories), 0)),
    protein: Math.max(0, round(safeNumber(macros.protein), 1)),
    carbs: Math.max(0, round(safeNumber(macros.carbs), 1)),
    fat: Math.max(0, round(safeNumber(macros.fat), 1)),
  };
  if (macros.fiber !== undefined) per100g.fiber = Math.max(0, round(safeNumber(macros.fiber), 1));
  if (macros.sugar !== undefined) per100g.sugar = Math.max(0, round(safeNumber(macros.sugar), 1));
  if (macros.sodium !== undefined) per100g.sodium = Math.max(0, round(safeNumber(macros.sodium), 0));

  // Quick-add macros describe one serving, so one serving is defined as 100 g.
  return {
    name: cleanName,
    brand: null,
    per100g,
    servingSizeG: 100,
    servingLabel: '1 serving (100 g)',
    barcode: null,
    source: 'quick_add',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
  };
}

// ------------------------------------------------------------------- search

const SCORE = {
  exactName: 1000,
  exactAlias: 940,
  exactBrand: 880,
  prefixName: 850,
  prefixAlias: 780,
  prefixBrand: 740,
  wordName: 700,
  wordAlias: 640,
  wordBrand: 600,
  substringName: 520,
  substringAlias: 460,
  substringBrand: 420,
  allTokens: 380,
  subsequence: 240,
  fuzzyBase: 100,
} as const;

const MIN_FUZZY_QUERY_LENGTH = 4;
const MIN_FUZZY_SIMILARITY = 0.7;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

function isSubsequence(query: string, target: string): boolean {
  let index = 0;
  for (const char of target) {
    if (char === query[index]) index += 1;
    if (index === query.length) return true;
  }
  return query.length === 0;
}

function hasWordMatch(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const index = haystack.indexOf(needle);
  if (index < 0) return false;
  return index === 0 || haystack[index - 1] === ' ';
}

function bestFuzzy(query: string, haystack: string): number {
  let best = similarity(query, haystack);
  for (const token of haystack.split(' ')) {
    if (token.length === 0) continue;
    const score = similarity(query, token);
    if (score > best) best = score;
  }
  return best;
}

interface Scored {
  food: SeedFood;
  score: number;
}

function scoreSeedFood(seed: SeedFood, query: string, queryTokens: string[]): number {
  const name = normalize(seed.name);
  const brand = normalize(seed.brand ?? '');
  const aliases = (seed.aliases ?? []).map(normalize);
  const haystack = [name, brand, ...aliases].filter(Boolean).join(' ');

  let score = 0;

  if (name === query) score = SCORE.exactName;
  else if (aliases.includes(query)) score = SCORE.exactAlias;
  else if (brand.length > 0 && brand === query) score = SCORE.exactBrand;
  else if (name.startsWith(query)) score = SCORE.prefixName;
  else if (aliases.some((a) => a.startsWith(query))) score = SCORE.prefixAlias;
  else if (brand.length > 0 && brand.startsWith(query)) score = SCORE.prefixBrand;
  else if (hasWordMatch(name, query)) score = SCORE.wordName;
  else if (aliases.some((a) => hasWordMatch(a, query))) score = SCORE.wordAlias;
  else if (brand.length > 0 && hasWordMatch(brand, query)) score = SCORE.wordBrand;
  else if (name.includes(query)) score = SCORE.substringName;
  else if (aliases.some((a) => a.includes(query))) score = SCORE.substringAlias;
  else if (brand.length > 0 && brand.includes(query)) score = SCORE.substringBrand;
  else if (queryTokens.length > 1 && queryTokens.every((token) => haystack.includes(token))) {
    score = SCORE.allTokens;
  } else if (isSubsequence(query, name)) score = SCORE.subsequence;
  else if (query.length >= MIN_FUZZY_QUERY_LENGTH) {
    const best = Math.max(bestFuzzy(query, name), ...aliases.map((a) => bestFuzzy(query, a)), 0);
    if (best >= MIN_FUZZY_SIMILARITY) score = SCORE.fuzzyBase + Math.round(best * 100);
  }

  if (score === 0) return 0;

  // Small, tier-preserving nudge so household staples win ties.
  const popularRank = POPULAR_RANK.get(name);
  if (popularRank !== undefined) score += 10 - Math.min(9, popularRank / 3);
  return score;
}

function compareScored(a: Scored, b: Scored): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.food.name.length !== b.food.name.length) return a.food.name.length - b.food.name.length;
  return a.food.name.localeCompare(b.food.name);
}

function popularSeedFoods(limit: number): SeedFood[] {
  const popular: SeedFood[] = [];
  for (const name of POPULAR_SEED_NAMES) {
    const seed = SEED_BY_KEY.get(foodKey(name, null));
    if (seed) popular.push(seed);
    if (popular.length >= limit) break;
  }
  return popular;
}

/**
 * Fuzzy, accent-insensitive search over the built-in database.
 *
 * Ranking: exact > prefix > word-boundary > substring > all-tokens >
 * subsequence > Levenshtein similarity (queries of 4+ characters only, so
 * "chiken" still finds chicken). Ties break by shortest name, then alphabetically.
 * An empty query returns a curated popular list rather than the whole database.
 */
export function searchSeedFoods(q: string, limit = 50): SeedFood[] {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const query = normalize(q ?? '');
  if (query.length === 0) return popularSeedFoods(max);

  const queryTokens = query.split(' ').filter(Boolean);
  const scored: Scored[] = [];

  for (const seed of SEED_FOODS) {
    const score = scoreSeedFood(seed, query, queryTokens);
    if (score > 0) scored.push({ food: seed, score });
  }

  scored.sort(compareScored);
  return scored.slice(0, max).map((entry) => entry.food);
}

/**
 * Search the user's saved foods first, then top up from the seed database.
 * Never throws: a missing or failing repository degrades to seed-only results.
 */
export async function searchAllFoods(q: string, limit = 50): Promise<Food[]> {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const results: Food[] = [];
  const seen = new Set<string>();

  const push = (food: Food): void => {
    if (results.length >= max) return;
    const key = foodKey(food.name, food.brand);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(food);
  };

  try {
    if (typeof repositories.searchFoods === 'function') {
      const fromDb = await repositories.searchFoods(q, max);
      if (Array.isArray(fromDb)) {
        for (const food of fromDb) {
          if (food && typeof food.name === 'string') push(food);
        }
      }
    }
  } catch {
    // The DB may not be open yet; seed results below still give a usable UI.
  }

  if (results.length < max) {
    for (const seed of searchSeedFoods(q, max * 2)) {
      if (results.length >= max) break;
      push(seedFoodToFood(seed));
    }
  }

  return results;
}

/**
 * Insert the built-in database on first launch. Safe to call on every app
 * start: it no-ops when foods already exist and returns 0 on any failure.
 */
export async function ensureFoodsSeeded(): Promise<number> {
  try {
    if (typeof repositories.countFoods !== 'function' || typeof repositories.seedFoods !== 'function') {
      return 0;
    }

    const existing = await repositories.countFoods();
    if (typeof existing !== 'number' || !Number.isFinite(existing) || existing > 0) return 0;

    const inputs = SEED_FOODS.map(seedFoodToFoodInput);
    const inserted = await repositories.seedFoods(inputs);
    return typeof inserted === 'number' && Number.isFinite(inserted) ? inserted : inputs.length;
  } catch {
    return 0;
  }
}

/**
 * Resolves a food id coming from a search result into a persisted `Food`.
 *
 * Search can hand back seed foods before the catalogue has been imported —
 * their ids look like `seed:chicken-breast` and have no row in SQLite — so
 * anything that stores the id (a diary entry's `food_id` foreign key) would
 * fail. Those are materialised on demand here; the in-memory seed food is the
 * last resort when the repository is unavailable.
 */
export async function resolveFoodById(id: string): Promise<Food | null> {
  const key = typeof id === 'string' ? id.trim() : '';
  if (key.length === 0) return null;

  try {
    if (typeof repositories.getFood === 'function') {
      const stored = await repositories.getFood(key);
      if (stored) return stored;
    }
  } catch {
    // Fall through to the seed catalogue.
  }

  const seed = SEED_BY_ID.get(key);
  if (!seed) return null;

  try {
    if (typeof repositories.upsertFood === 'function') {
      const saved = await repositories.upsertFood(seedFoodToFoodInput(seed));
      if (saved) return saved;
    }
  } catch {
    // The database may not be writable yet; the entry can still be logged
    // without a food reference.
  }

  return seedFoodToFood(seed);
}
