import type { Macros } from '@/types';

import type { BarcodeProduct, BarcodeProvider } from './types';
import { MOCK_PROVIDER_ID } from './types';

const NOT_FOUND_CODES = new Set(['0000000000000', '00000000', '042100005264']);
const ADJECTIVES = ['Classic', 'Organic', 'Crunchy', 'Protein', 'Whole Grain', 'Vanilla', 'Roasted'];
const FOODS = ['Granola Bar', 'Greek Yogurt', 'Trail Mix', 'Oat Cereal', 'Pasta Sauce', 'Almond Drink', 'Rice Cakes'];
const BRANDS = ['MacroTrack Demo', 'North Valley', 'Summit Foods', 'Daily Pantry', 'Open Kitchen'];

function hashDigits(barcode: string): number {
  let hash = 2166136261;
  for (let i = 0; i < barcode.length; i += 1) {
    hash ^= barcode.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function productFor(barcode: string): BarcodeProduct | null {
  if (NOT_FOUND_CODES.has(barcode)) return null;

  const hash = hashDigits(barcode);
  const protein = round(3 + (hash % 180) / 10);
  const carbs = round(8 + ((hash >>> 5) % 520) / 10);
  const fat = round(1 + ((hash >>> 11) % 260) / 10);
  const calories = Math.round(protein * 4 + carbs * 4 + fat * 9);
  const fiber = round(Math.min(carbs, ((hash >>> 17) % 80) / 10));
  const sugar = round(Math.min(carbs, ((hash >>> 21) % 180) / 10));
  const sodium = Math.round((hash >>> 3) % 620);
  const servingSizeG = 25 + (hash % 76);

  const per100g: Macros = { calories, protein, carbs, fat, fiber, sugar, sodium };

  return {
    barcode,
    name: `${ADJECTIVES[hash % ADJECTIVES.length]} ${FOODS[(hash >>> 8) % FOODS.length]}`,
    brand: BRANDS[(hash >>> 16) % BRANDS.length] ?? 'MacroTrack Demo',
    per100g,
    servingSizeG,
    imageUrl: null,
    source: MOCK_PROVIDER_ID,
  };
}

export const mockBarcodeProvider: BarcodeProvider = {
  id: MOCK_PROVIDER_ID,
  label: 'Demo (offline)',

  async lookup(barcode: string): Promise<{ ok: true; data: BarcodeProduct | null }> {
    return { ok: true, data: productFor(barcode) };
  },
};

export default mockBarcodeProvider;
