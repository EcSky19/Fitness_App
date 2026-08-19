/**
 * Offline demo provider.
 *
 * Always "configured", so the app is fully usable without an API key. Results
 * are picked and jittered deterministically from a hash of the input, so the
 * same photo always yields the same answer while different photos look
 * genuinely different. Output goes through `parseVisionJson` — the exact path a
 * real provider takes.
 */
import type { VisionInput, VisionProvider, VisionResult } from '@/types';

import { parseVisionJson } from './parse';
import { MOCK_PROVIDER_ID } from './types';

export const MOCK_MODEL_ID = 'macrotrack-demo-v1';

/** Simulated round-trip so the UI exercises its loading state. */
export const MOCK_LATENCY_MS = 900;

let latencyMs = MOCK_LATENCY_MS;

/** Test helper: shortens the simulated delay. */
export function __setMockLatencyMs(ms: number): void {
  latencyMs = Math.max(0, ms);
}

interface MockItem {
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  servingLabel: string;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
  confidence: number;
  notes: string | null;
}

const FOOD_PHOTO_PLATES: MockItem[][] = [
  [
    {
      name: 'Grilled chicken breast',
      brand: null,
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 breast (170 g)',
      estimatedGrams: 170,
      calories: 265,
      protein: 52,
      carbs: 0,
      fat: 6,
      fiber: null,
      sugar: null,
      sodium: 320,
      confidence: 0.88,
      notes: 'Assumed grilled with about 1 tsp of oil.',
    },
    {
      name: 'Brown rice, cooked',
      brand: null,
      quantity: 1,
      unit: 'cup',
      servingLabel: '1 cup (150 g)',
      estimatedGrams: 150,
      calories: 165,
      protein: 3.5,
      carbs: 34,
      fat: 1.3,
      fiber: 2.7,
      sugar: 0.5,
      sodium: 5,
      confidence: 0.82,
      notes: null,
    },
    {
      name: 'Steamed broccoli',
      brand: null,
      quantity: 1,
      unit: 'cup',
      servingLabel: '1 cup (90 g)',
      estimatedGrams: 90,
      calories: 38,
      protein: 2.5,
      carbs: 6,
      fat: 0.4,
      fiber: 2.4,
      sugar: 1.4,
      sodium: 30,
      confidence: 0.79,
      notes: null,
    },
  ],
  [
    {
      name: 'Baked salmon fillet',
      brand: null,
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 fillet (140 g)',
      estimatedGrams: 140,
      calories: 300,
      protein: 34,
      carbs: 0,
      fat: 18,
      fiber: null,
      sugar: null,
      sodium: 260,
      confidence: 0.86,
      notes: 'Skin-on fillet, lightly oiled.',
    },
    {
      name: 'Roasted sweet potato',
      brand: null,
      quantity: 1,
      unit: 'cup',
      servingLabel: '1 cup cubed (130 g)',
      estimatedGrams: 130,
      calories: 150,
      protein: 2,
      carbs: 27,
      fat: 3.5,
      fiber: 4.2,
      sugar: 8,
      sodium: 45,
      confidence: 0.76,
      notes: 'Roasted in olive oil.',
    },
    {
      name: 'Roasted asparagus',
      brand: null,
      quantity: 6,
      unit: 'piece',
      servingLabel: '6 spears (85 g)',
      estimatedGrams: 85,
      calories: 46,
      protein: 2,
      carbs: 3.8,
      fat: 2.5,
      fiber: 2,
      sugar: 1.6,
      sodium: 55,
      confidence: 0.71,
      notes: null,
    },
  ],
  [
    {
      name: 'Scrambled eggs',
      brand: null,
      quantity: 2,
      unit: 'piece',
      servingLabel: '2 large eggs (110 g)',
      estimatedGrams: 110,
      calories: 170,
      protein: 13,
      carbs: 1.5,
      fat: 12,
      fiber: null,
      sugar: 1,
      sodium: 290,
      confidence: 0.87,
      notes: 'Cooked with a little butter.',
    },
    {
      name: 'Avocado toast',
      brand: null,
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 slice with 1/2 avocado (105 g)',
      estimatedGrams: 105,
      calories: 205,
      protein: 5,
      carbs: 17,
      fat: 13,
      fiber: 6,
      sugar: 1.5,
      sodium: 210,
      confidence: 0.74,
      notes: 'Whole-grain bread assumed.',
    },
    {
      name: 'Blueberries',
      brand: null,
      quantity: 0.5,
      unit: 'cup',
      servingLabel: '1/2 cup (75 g)',
      estimatedGrams: 75,
      calories: 48,
      protein: 0.6,
      carbs: 11,
      fat: 0.2,
      fiber: 1.8,
      sugar: 7.5,
      sodium: 1,
      confidence: 0.83,
      notes: null,
    },
  ],
  [
    {
      name: 'Cheeseburger',
      brand: null,
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 burger (210 g)',
      estimatedGrams: 210,
      calories: 485,
      protein: 30,
      carbs: 32,
      fat: 26,
      fiber: 2,
      sugar: 7,
      sodium: 890,
      confidence: 0.8,
      notes: 'Assumed quarter-pound patty with one slice of cheese.',
    },
    {
      name: 'French fries',
      brand: null,
      quantity: 1,
      unit: 'serving',
      servingLabel: 'Medium portion (115 g)',
      estimatedGrams: 115,
      calories: 315,
      protein: 4,
      carbs: 40,
      fat: 15,
      fiber: 3.5,
      sugar: 0.5,
      sodium: 320,
      confidence: 0.77,
      notes: 'Deep fried.',
    },
    {
      name: 'Side salad with vinaigrette',
      brand: null,
      quantity: 1,
      unit: 'serving',
      servingLabel: 'Small bowl (95 g)',
      estimatedGrams: 95,
      calories: 90,
      protein: 1.5,
      carbs: 5,
      fat: 7,
      fiber: 1.5,
      sugar: 2.5,
      sodium: 180,
      confidence: 0.62,
      notes: 'Dressing included; adjust if the salad was served dry.',
    },
  ],
  [
    {
      name: 'Spaghetti bolognese',
      brand: null,
      quantity: 1,
      unit: 'serving',
      servingLabel: '1 plate (320 g)',
      estimatedGrams: 320,
      calories: 475,
      protein: 24,
      carbs: 62,
      fat: 14,
      fiber: 5,
      sugar: 9,
      sodium: 720,
      confidence: 0.81,
      notes: 'Beef ragu over white pasta.',
    },
    {
      name: 'Garlic bread',
      brand: null,
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 slice (55 g)',
      estimatedGrams: 55,
      calories: 195,
      protein: 4,
      carbs: 26,
      fat: 8,
      fiber: 1.2,
      sugar: 1.5,
      sodium: 330,
      confidence: 0.73,
      notes: null,
    },
    {
      name: 'Grated parmesan',
      brand: null,
      quantity: 1,
      unit: 'tbsp',
      servingLabel: '1 tbsp (12 g)',
      estimatedGrams: 12,
      calories: 50,
      protein: 4.2,
      carbs: 0.4,
      fat: 3.5,
      fiber: null,
      sugar: null,
      sodium: 190,
      confidence: 0.58,
      notes: 'Hard to judge under the sauce.',
    },
  ],
];

const NUTRITION_LABELS: MockItem[] = [
  {
    name: 'Non-fat Greek yogurt, vanilla',
    brand: 'Chobani',
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 container (150 g)',
    estimatedGrams: 150,
    calories: 120,
    protein: 16,
    carbs: 13,
    fat: 0,
    fiber: 0,
    sugar: 9,
    sodium: 65,
    confidence: 0.94,
    notes: '1 serving per container.',
  },
  {
    name: 'Old fashioned rolled oats',
    brand: 'Quaker',
    quantity: 1,
    unit: 'serving',
    servingLabel: '1/2 cup dry (40 g)',
    estimatedGrams: 40,
    calories: 150,
    protein: 5,
    carbs: 27,
    fat: 3,
    fiber: 4,
    sugar: 1,
    sodium: 0,
    confidence: 0.92,
    notes: 'About 13 servings per container.',
  },
  {
    name: 'Builders protein bar, chocolate',
    brand: 'Clif',
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 bar (68 g)',
    estimatedGrams: 68,
    calories: 280,
    protein: 20,
    carbs: 30,
    fat: 8,
    fiber: 3,
    sugar: 21,
    sodium: 230,
    confidence: 0.9,
    notes: '1 serving per container.',
  },
  {
    name: 'Penne rigate, dry',
    brand: 'Barilla',
    quantity: 1,
    unit: 'serving',
    servingLabel: '2 oz dry (56 g)',
    estimatedGrams: 56,
    calories: 200,
    protein: 7,
    carbs: 42,
    fat: 1,
    fiber: 2,
    sugar: 2,
    sodium: 0,
    confidence: 0.91,
    notes: 'About 8 servings per container.',
  },
  {
    name: 'Whole almonds',
    brand: 'Kirkland Signature',
    quantity: 1,
    unit: 'serving',
    servingLabel: '1 oz, about 23 almonds (28 g)',
    estimatedGrams: 28,
    calories: 170,
    protein: 6,
    carbs: 6,
    fat: 15,
    fiber: 3,
    sugar: 1,
    sodium: 0,
    confidence: 0.89,
    notes: 'About 48 servings per container.',
  },
];

/** FNV-1a, stable across platforms. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Samples long base64 payloads so hashing stays cheap but input-sensitive. */
function fingerprint(input: VisionInput): number {
  const image = typeof input.imageBase64 === 'string' ? input.imageBase64 : '';
  const sample =
    image.length <= 512
      ? image
      : `${image.length}:${image.slice(0, 128)}:${image.slice(Math.floor(image.length / 2), Math.floor(image.length / 2) + 128)}:${image.slice(-128)}`;
  return hashString(`${input.mode}|${input.hint ?? ''}|${input.mimeType ?? ''}|${sample}`);
}

function scaleItem(item: MockItem, factor: number): MockItem {
  const scale = (value: number, decimals = 1): number => {
    const factorial = 10 ** decimals;
    return Math.round(value * factor * factorial) / factorial;
  };
  return {
    ...item,
    estimatedGrams: Math.max(1, Math.round(item.estimatedGrams * factor)),
    calories: Math.max(0, Math.round(item.calories * factor)),
    protein: scale(item.protein),
    carbs: scale(item.carbs),
    fat: scale(item.fat),
    fiber: item.fiber === null ? null : scale(item.fiber),
    sugar: item.sugar === null ? null : scale(item.sugar),
    sodium: item.sodium === null ? null : Math.round(item.sodium * factor),
  };
}

function buildPayload(input: VisionInput): string {
  const hash = fingerprint(input);

  if (input.mode === 'nutrition_label') {
    const label = NUTRITION_LABELS[hash % NUTRITION_LABELS.length] as MockItem;
    return JSON.stringify({ items: [label], warnings: [] });
  }

  const plate = FOOD_PHOTO_PLATES[hash % FOOD_PHOTO_PLATES.length] as MockItem[];
  const items = plate.map((item, index) => {
    // ±12 % portion jitter, applied uniformly so calories still match 4/4/9.
    const spread = ((hash >>> (index * 3 + 5)) % 25) - 12;
    return scaleItem(item, 1 + spread / 100);
  });

  return JSON.stringify({ items, warnings: [] });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const mockProvider: VisionProvider = {
  id: MOCK_PROVIDER_ID,
  modelId: MOCK_MODEL_ID,

  isConfigured(): boolean {
    return true;
  },

  async analyze(input: VisionInput): Promise<VisionResult> {
    const startedAt = Date.now();
    await delay(latencyMs);

    const rawText = buildPayload(input);
    const parsed = parseVisionJson(rawText, input.mode);

    return {
      mode: input.mode,
      items: parsed.items,
      provider: MOCK_PROVIDER_ID,
      modelId: MOCK_MODEL_ID,
      latencyMs: Date.now() - startedAt,
      rawText,
      warnings: [
        ...parsed.warnings,
        'Demo estimate generated on-device. Check each item and edit before saving.',
      ],
    };
  },
};

export default mockProvider;
