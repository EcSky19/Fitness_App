import type { VisionFoodItem, VisionInput } from '@/types';

import { useAppStore } from '@/store/appStore';

import { __resetApiKeyCache, setApiKey } from '../apiKeys';
import { __setMockLatencyMs, MOCK_LATENCY_MS } from '../mockProvider';
import {
  analyzeImage,
  getVisionProvider,
  listVisionProviders,
  resolveVisionProviderId,
  visionItemToEntryDraft,
} from '../registry';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => store.get(key) ?? null),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});

const fetchMock = jest.fn();

const INPUT: VisionInput = {
  imageBase64: 'Zm9vZC1waG90by1ieXRlcw==',
  mimeType: 'image/jpeg',
  mode: 'food_photo',
};

const ITEMS_JSON = JSON.stringify({
  items: [
    {
      name: 'Turkey sandwich',
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 sandwich (230 g)',
      estimatedGrams: 230,
      calories: 480,
      protein: 30,
      carbs: 52,
      fat: 15,
      confidence: 0.8,
    },
  ],
  warnings: [],
});

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  __setMockLatencyMs(0);
});

afterAll(() => {
  __setMockLatencyMs(MOCK_LATENCY_MS);
});

beforeEach(async () => {
  fetchMock.mockReset();
  __resetApiKeyCache();
  delete process.env.EXPO_PUBLIC_VISION_PROVIDER;
  useAppStore.getState().updateSettings({ visionProvider: 'mock' });
  await setApiKey('openai', '');
  await setApiKey('gemini', '');
  __resetApiKeyCache();
});

describe('provider resolution', () => {
  it('defaults to mock', () => {
    expect(resolveVisionProviderId()).toBe('mock');
    expect(getVisionProvider().id).toBe('mock');
  });

  it('honours an explicit id', () => {
    expect(getVisionProvider('openai').id).toBe('openai');
    expect(getVisionProvider('gemini').id).toBe('gemini');
  });

  it('falls back to mock for an unknown id', () => {
    expect(getVisionProvider('does-not-exist').id).toBe('mock');
  });

  it('reads the env default when the store has no selection', () => {
    useAppStore.getState().updateSettings({ visionProvider: '' });
    process.env.EXPO_PUBLIC_VISION_PROVIDER = 'gemini';

    expect(resolveVisionProviderId()).toBe('gemini');
  });

  it('prefers the app store selection over the env default', () => {
    process.env.EXPO_PUBLIC_VISION_PROVIDER = 'openai';
    useAppStore.getState().updateSettings({ visionProvider: 'gemini' });

    expect(resolveVisionProviderId()).toBe('gemini');
    expect(getVisionProvider().id).toBe('gemini');
  });

  it('lets an explicit id win over the store', () => {
    useAppStore.getState().updateSettings({ visionProvider: 'gemini' });

    expect(resolveVisionProviderId('openai')).toBe('openai');
  });
});

describe('listVisionProviders', () => {
  it('reports configuration per provider', async () => {
    const before = listVisionProviders();

    expect(before.map((entry) => entry.id)).toEqual(['mock', 'openai', 'gemini']);
    expect(before[0]).toMatchObject({ requiresApiKey: false, configured: true });
    expect(before[1]).toMatchObject({ requiresApiKey: true, configured: false });

    await setApiKey('openai', 'sk-live-key-123456');
    const after = listVisionProviders();

    expect(after[1]?.configured).toBe(true);
    expect(after[1]?.modelId).toBe('gpt-4o-mini');
    expect(after.every((entry) => entry.label.length > 0)).toBe(true);
  });
});

describe('analyzeImage', () => {
  it('falls back to the mock provider with a warning when the selection is unconfigured', async () => {
    const result = await analyzeImage(INPUT, 'openai');

    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data?.provider).toBe('mock');
    expect(result.data?.items.length).toBeGreaterThanOrEqual(1);
    expect(result.data?.warnings.join(' ')).toMatch(/no api key/i);
    expect(result.data?.warnings.join(' ')).toMatch(/settings/i);
  });

  it('uses the configured provider when a key is present', async () => {
    await setApiKey('openai', 'sk-live-key-123456');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: ITEMS_JSON } }] }),
      text: async () => ITEMS_JSON,
    } as unknown as Response);

    const result = await analyzeImage(INPUT, 'openai');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.data?.provider).toBe('openai');
    expect(result.data?.modelId).toBe('gpt-4o-mini');
    expect(result.data?.items[0]?.name).toBe('Turkey sandwich');
    expect(result.data?.rawText).toContain('Turkey sandwich');
    expect(result.data?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.data?.warnings).toEqual([]);
  });

  it('returns ok:false with a user-facing message when the provider fails', async () => {
    await setApiKey('openai', 'sk-live-key-123456');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => 'unauthorized sk-live-key-123456',
    } as unknown as Response);

    const result = await analyzeImage(INPUT, 'openai');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid API key. Add a valid key in Settings.');
    expect(result.data).toBeUndefined();
    expect(result.error).not.toContain('sk-live-key-123456');
  });

  it('rejects an empty payload', async () => {
    const result = await analyzeImage({ ...INPUT, imageBase64: '' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no photo/i);
  });

  it('rejects an oversized payload before any network call', async () => {
    const oversized = 'A'.repeat(21 * 1024 * 1024);

    const result = await analyzeImage({ ...INPUT, imageBase64: oversized }, 'openai');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds a warning when nothing was detected', async () => {
    await setApiKey('openai', 'sk-live-key-123456');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"items":[],"warnings":[]}' } }] }),
      text: async () => '{}',
    } as unknown as Response);

    const result = await analyzeImage({ ...INPUT, mode: 'nutrition_label' }, 'openai');

    expect(result.ok).toBe(true);
    expect(result.data?.items).toEqual([]);
    expect(result.data?.warnings.join(' ')).toMatch(/nutrition label/i);
  });

  it('runs the demo provider end to end for both modes', async () => {
    for (const mode of ['food_photo', 'nutrition_label'] as const) {
      const result = await analyzeImage({ ...INPUT, mode });

      expect(result.ok).toBe(true);
      expect(result.data?.mode).toBe(mode);
      expect(result.data?.provider).toBe('mock');
      expect(result.data?.items.length).toBeGreaterThanOrEqual(1);
      expect(result.data?.rawText).toEqual(expect.any(String));
    }
  });
});

describe('visionItemToEntryDraft', () => {
  const item: VisionFoodItem = {
    name: 'Grilled chicken breast',
    brand: null,
    quantity: 1,
    unit: 'piece',
    servingLabel: '1 breast (170 g)',
    estimatedGrams: 170,
    macros: { calories: 265, protein: 52, carbs: 0, fat: 6, sodium: 320 },
    confidence: 0.88,
    notes: 'Assumed grilled.',
  };

  it('builds a complete diary entry draft', () => {
    const draft = visionItemToEntryDraft(item, {
      date: '2026-08-19',
      mealType: 'lunch',
      photoUri: 'file:///photos/meal.jpg',
    });

    expect(draft).toEqual({
      date: '2026-08-19',
      mealType: 'lunch',
      foodId: null,
      name: 'Grilled chicken breast',
      brand: null,
      quantity: 1,
      unit: 'piece',
      servingLabel: '1 breast (170 g)',
      gramsTotal: 170,
      macros: { calories: 265, protein: 52, carbs: 0, fat: 6, sodium: 320 },
      photoUri: 'file:///photos/meal.jpg',
      source: 'vision',
      visionConfidence: 0.88,
      wasEdited: false,
      loggedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(draft.loggedAt))).toBe(false);
  });

  it('marks nutrition label scans as label entries', () => {
    const fromMode = visionItemToEntryDraft(
      item,
      { date: '2026-08-19', mealType: 'snack', photoUri: null },
      'nutrition_label'
    );
    const fromSource = visionItemToEntryDraft(
      item,
      { date: '2026-08-19', mealType: 'snack', photoUri: null },
      'label'
    );

    expect(fromMode.source).toBe('label');
    expect(fromSource.source).toBe('label');
    expect(fromMode.photoUri).toBeNull();
  });

  it('copies macros instead of aliasing them', () => {
    const draft = visionItemToEntryDraft(item, {
      date: '2026-08-19',
      mealType: 'dinner',
      photoUri: null,
    });

    draft.macros.calories = 1;
    expect(item.macros.calories).toBe(265);
  });
});
