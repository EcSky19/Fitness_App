import type { VisionInput } from '@/types';

import { __setMockLatencyMs, MOCK_LATENCY_MS, mockProvider } from '../mockProvider';

const SERVING_UNITS = ['g', 'ml', 'oz', 'serving', 'piece', 'cup', 'tbsp', 'tsp'];

function input(overrides: Partial<VisionInput> = {}): VisionInput {
  return {
    imageBase64: 'aGVsbG8td29ybGQtcGhvdG8=',
    mimeType: 'image/jpeg',
    mode: 'food_photo',
    ...overrides,
  };
}

describe('mockProvider', () => {
  beforeAll(() => {
    __setMockLatencyMs(0);
  });

  afterAll(() => {
    __setMockLatencyMs(MOCK_LATENCY_MS);
  });

  it('is always configured', () => {
    expect(mockProvider.isConfigured()).toBe(true);
    expect(mockProvider.id).toBe('mock');
  });

  it('simulates a ~900 ms round trip by default', () => {
    expect(MOCK_LATENCY_MS).toBe(900);
  });

  it('returns a multi-item plate for food photos', async () => {
    const result = await mockProvider.analyze(input());

    expect(result.mode).toBe('food_photo');
    expect(result.provider).toBe('mock');
    expect(result.modelId).toBeTruthy();
    expect(result.rawText).toEqual(expect.any(String));
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
  });

  it('returns a single packaged item for nutrition labels', async () => {
    const result = await mockProvider.analyze(input({ mode: 'nutrition_label' }));

    expect(result.mode).toBe('nutrition_label');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.brand).toBeTruthy();
    expect(result.items[0]?.servingLabel).toMatch(/\(|\d/);
  });

  it.each(['food_photo', 'nutrition_label'] as const)('returns valid items for %s', async (mode) => {
    const result = await mockProvider.analyze(input({ mode }));

    expect(result.items.length).toBeGreaterThanOrEqual(1);
    for (const item of result.items) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.estimatedGrams).toBeGreaterThan(0);
      expect(item.quantity).toBeGreaterThan(0);
      expect(SERVING_UNITS).toContain(item.unit);
      expect(item.confidence).toBeGreaterThan(0);
      expect(item.confidence).toBeLessThanOrEqual(1);
      expect(item.macros.calories).toBeGreaterThan(0);
      expect(item.macros.protein).toBeGreaterThanOrEqual(0);
      expect(item.macros.carbs).toBeGreaterThanOrEqual(0);
      expect(item.macros.fat).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces internally consistent canned data (no parser corrections)', async () => {
    for (const mode of ['food_photo', 'nutrition_label'] as const) {
      for (let i = 0; i < 8; i += 1) {
        const result = await mockProvider.analyze(input({ mode, imageBase64: `photo-${i}` }));
        const corrections = result.warnings.filter((warning) =>
          /don't match macros|assumed 100 g|unknown unit|no name|negative/i.test(warning)
        );
        expect(corrections).toEqual([]);
      }
    }
  });

  it('flags the result as a demo estimate', async () => {
    const result = await mockProvider.analyze(input());
    expect(result.warnings.join(' ')).toMatch(/demo/i);
  });

  it('is deterministic for the same input', async () => {
    const first = await mockProvider.analyze(input({ imageBase64: 'stable-photo-payload' }));
    const second = await mockProvider.analyze(input({ imageBase64: 'stable-photo-payload' }));

    expect(second.items).toEqual(first.items);
    expect(second.rawText).toEqual(first.rawText);
  });

  it('varies across different photos', async () => {
    const names = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      const result = await mockProvider.analyze(input({ imageBase64: `photo-payload-${i}` }));
      names.add(result.items.map((item) => item.name).join('|'));
    }

    expect(names.size).toBeGreaterThan(1);
  });

  it('varies with the hint and the mode', async () => {
    const plain = await mockProvider.analyze(input({ imageBase64: 'same-bytes' }));
    const hinted = await mockProvider.analyze(input({ imageBase64: 'same-bytes', hint: 'chicken salad' }));

    expect(hinted.items).not.toEqual([]);
    expect(hinted.rawText === plain.rawText).toBe(false);
  });
});
