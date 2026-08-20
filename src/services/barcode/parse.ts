import type { Macros } from '@/types';

import { toNumber } from '@/services/vision/parse';

import type { BarcodeProduct } from './types';
import { isRecord, OPENFOODFACTS_PROVIDER_ID, round } from './types';

const MAX_TEXT_LENGTH = 120;
const MAX_IMAGE_URL_LENGTH = 500;
const MAX_CALORIES_100G = 1_200;
const MAX_GRAMS_100G = 100;
const MAX_SODIUM_MG_100G = 100_000;
const KJ_PER_KCAL = 4.184;

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function text(value: unknown, max = MAX_TEXT_LENGTH): string {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  if (!raw || raw.toLowerCase() === 'null') return '';
  return raw.length > max ? `${raw.slice(0, max - 1).trimEnd()}…` : raw;
}

function firstBrand(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return text(raw.split(',')[0]?.trim() ?? '') || null;
}

function clamp(value: unknown, max: number): number | null {
  const parsed = numberValue(value);
  if (parsed === null || parsed < 0 || parsed > max) return null;
  return round(parsed);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'string' && /^-?\d+,\d+(?:[eE][+-]?\d+)?(?:\s|$)/.test(value.trim())) {
    return toNumber(value.trim().replace(',', '.'));
  }
  return toNumber(value);
}

function macroFromNutriments(nutriments: Record<string, unknown>, base: string): number | null {
  return clamp(
    pick(nutriments, [`${base}_100g`, `${base}-100g`, `${base}`]),
    base === 'sodium' ? MAX_SODIUM_MG_100G : MAX_GRAMS_100G
  );
}

function energyKcal100g(nutriments: Record<string, unknown>): number | null {
  const kcal = clamp(pick(nutriments, ['energy-kcal_100g', 'energy_kcal_100g', 'calories_100g']), MAX_CALORIES_100G);
  if (kcal !== null) return kcal;

  const kj = clamp(pick(nutriments, ['energy_100g', 'energy-kj_100g', 'energy_kj_100g']), MAX_CALORIES_100G * KJ_PER_KCAL);
  return kj === null ? null : round(kj / KJ_PER_KCAL);
}

function servingGrams(product: Record<string, unknown>, nutriments?: Record<string, unknown>): number | null {
  const direct = clamp(pick(product, ['serving_quantity', 'servingQuantity', 'servingSizeG']), 100_000);
  if (direct !== null && direct > 0) return direct;

  const servingSize = text(pick(product, ['serving_size', 'servingSize']), 80);
  const parenthesized = servingSize.match(/\(([^)]*(?:g|ml)[^)]*)\)/i)?.[1];
  const gramsText = parenthesized ?? servingSize;
  const match = gramsText.match(/(\d[\d,.]*|\.\d+)\s*(g|gram|grams|ml|milliliter|milliliters|millilitre|millilitres)\b/i);
  if (match) {
    const parsed = numberValue(match[1]);
    if (parsed !== null && parsed > 0 && parsed <= 100_000) return round(parsed);
  }

  const fromNutriments = nutriments ? clamp(pick(nutriments, ['serving_size', 'serving_quantity']), 100_000) : null;
  return fromNutriments !== null && fromNutriments > 0 ? fromNutriments : null;
}

function perServingTo100g(nutriments: Record<string, unknown>, key: string, servingG: number, max: number): number | null {
  const serving = clamp(pick(nutriments, [`${key}_serving`, `${key}-serving`]), max * (servingG / 100));
  return serving === null ? null : round((serving / servingG) * 100);
}

function buildMacros(nutriments: Record<string, unknown>, servingG: number | null): Macros | null {
  const protein = macroFromNutriments(nutriments, 'proteins') ?? (servingG ? perServingTo100g(nutriments, 'proteins', servingG, MAX_GRAMS_100G) : null) ?? 0;
  const carbs = macroFromNutriments(nutriments, 'carbohydrates') ?? (servingG ? perServingTo100g(nutriments, 'carbohydrates', servingG, MAX_GRAMS_100G) : null) ?? 0;
  const fat = macroFromNutriments(nutriments, 'fat') ?? (servingG ? perServingTo100g(nutriments, 'fat', servingG, MAX_GRAMS_100G) : null) ?? 0;

  let calories = energyKcal100g(nutriments);
  if (calories === null && servingG) {
    const servingKcal = clamp(pick(nutriments, ['energy-kcal_serving', 'energy_kcal_serving', 'calories_serving']), MAX_CALORIES_100G * (servingG / 100));
    if (servingKcal !== null) calories = round((servingKcal / servingG) * 100);
    else {
      const servingKj = clamp(pick(nutriments, ['energy_serving', 'energy-kj_serving', 'energy_kj_serving']), MAX_CALORIES_100G * KJ_PER_KCAL * (servingG / 100));
      if (servingKj !== null) calories = round((servingKj / KJ_PER_KCAL / servingG) * 100);
    }
  }

  const derived = protein * 4 + carbs * 4 + fat * 9;
  // Same ceiling as a stated figure. Each macro is capped at 100 g/100 g, so an
  // uncapped derived value could reach 1700 kcal/100 g and quietly exceed the
  // very limit `MAX_CALORIES_100G` enforces. No real food comes close (pure oil
  // is ~884), so this only ever trims physically impossible source data.
  if ((calories === null || calories <= 0) && derived > 0) {
    calories = Math.min(MAX_CALORIES_100G, Math.round(derived));
  }
  if (calories === null) calories = 0;

  const macros: Macros = { calories, protein, carbs, fat };
  const fiber = macroFromNutriments(nutriments, 'fiber') ?? (servingG ? perServingTo100g(nutriments, 'fiber', servingG, MAX_GRAMS_100G) : null);
  const sugar = macroFromNutriments(nutriments, 'sugars') ?? (servingG ? perServingTo100g(nutriments, 'sugars', servingG, MAX_GRAMS_100G) : null);
  const sodiumKg = macroFromNutriments(nutriments, 'sodium') ?? (servingG ? perServingTo100g(nutriments, 'sodium', servingG, MAX_GRAMS_100G) : null);
  const salt = macroFromNutriments(nutriments, 'salt') ?? (servingG ? perServingTo100g(nutriments, 'salt', servingG, MAX_GRAMS_100G) : null);

  if (fiber !== null) macros.fiber = fiber;
  if (sugar !== null) macros.sugar = sugar;
  if (sodiumKg !== null) macros.sodium = round(sodiumKg * 1000, 0);
  else if (salt !== null) macros.sodium = round(salt * 1000 * 0.393, 0);

  return macros;
}

function safeImageUrl(value: unknown): string | null {
  const url = text(value, MAX_IMAGE_URL_LENGTH);
  if (!url || !/^https:\/\//i.test(url)) return null;
  return url;
}

export function parseOpenFoodFactsProduct(payload: unknown, barcode: string): BarcodeProduct | null {
  if (!isRecord(payload)) throw new Error('Unexpected product response.');
  if (payload.status === 0 || payload.status === '0') return null;

  const product = isRecord(payload.product) ? payload.product : payload;
  if (!isRecord(product)) throw new Error('Unexpected product response.');

  const nutriments = isRecord(product.nutriments) ? product.nutriments : {};
  const servingSizeG = servingGrams(product, nutriments);
  const per100g = buildMacros(nutriments, servingSizeG);
  if (!per100g) throw new Error('Missing nutrition data.');

  const name =
    text(pick(product, ['product_name', 'product_name_en', 'generic_name', 'abbreviated_product_name'])) ||
    'Unnamed product';

  return {
    barcode,
    name,
    brand: firstBrand(pick(product, ['brands', 'brands_tags', 'manufacturing_places'])),
    per100g,
    servingSizeG,
    imageUrl: safeImageUrl(pick(product, ['image_front_url', 'image_url', 'selected_images'])),
    source: OPENFOODFACTS_PROVIDER_ID,
  };
}
