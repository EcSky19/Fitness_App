import { parseVisionJson } from '../parse';

describe('parseVisionJson', () => {
  const validItem = {
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
    notes: null,
  };

  it('parses a clean JSON object', () => {
    const result = parseVisionJson(JSON.stringify({ items: [validItem], warnings: [] }), 'food_photo');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: 'Grilled chicken breast',
      unit: 'piece',
      estimatedGrams: 170,
      confidence: 0.88,
    });
    expect(result.items[0]?.macros).toMatchObject({ calories: 265, protein: 52, carbs: 0, fat: 6 });
    expect(result.items[0]?.macros.sodium).toBe(320);
  });

  it('strips markdown fences', () => {
    const raw = [
      '```json',
      JSON.stringify({ items: [validItem, { ...validItem, name: 'Brown rice' }] }),
      '```',
    ].join('\n');
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items).toHaveLength(2);
    expect(result.items[1]?.name).toBe('Brown rice');
  });

  it('recovers JSON wrapped in prose', () => {
    const raw = `Sure! Here is what I can see on the plate:\n\n${JSON.stringify({
      items: [validItem],
    })}\n\nLet me know if you want a per-macro breakdown.`;

    const result = parseVisionJson(raw, 'food_photo');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Grilled chicken breast');
  });

  it('accepts a bare array', () => {
    const result = parseVisionJson(JSON.stringify([validItem]), 'food_photo');
    expect(result.items).toHaveLength(1);
  });

  it('accepts a single bare object', () => {
    const result = parseVisionJson(JSON.stringify(validItem), 'food_photo');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Grilled chicken breast');
  });

  it('coerces numeric strings with units, commas, tildes and ranges', () => {
    const raw = JSON.stringify({
      items: [
        {
          name: 'Pasta bake',
          quantity: '1',
          unit: 'serving',
          estimatedGrams: '320 g',
          calories: '1,200',
          protein: '~35 g',
          carbs: '120-140',
          fat: '30g',
          fiber: '5 g',
          sodium: '1,050 mg',
          confidence: '0.6',
        },
      ],
    });

    const item = parseVisionJson(raw, 'food_photo').items[0];

    expect(item?.estimatedGrams).toBe(320);
    expect(item?.macros.calories).toBe(1200);
    expect(item?.macros.protein).toBe(35);
    expect(item?.macros.carbs).toBe(130);
    expect(item?.macros.fat).toBe(30);
    expect(item?.macros.fiber).toBe(5);
    expect(item?.macros.sodium).toBe(1050);
    expect(item?.confidence).toBe(0.6);
  });

  it('rescales an out-of-range confidence percentage', () => {
    const raw = JSON.stringify({ items: [{ ...validItem, confidence: 85 }] });
    expect(parseVisionJson(raw, 'food_photo').items[0]?.confidence).toBe(0.85);
  });

  it('clamps confidence into 0..1', () => {
    const high = parseVisionJson(JSON.stringify({ items: [{ ...validItem, confidence: 250 }] }), 'food_photo');
    const low = parseVisionJson(JSON.stringify({ items: [{ ...validItem, confidence: -3 }] }), 'food_photo');

    expect(high.items[0]?.confidence).toBe(1);
    expect(low.items[0]?.confidence).toBe(0);
  });

  it('clamps negative macros to zero and warns', () => {
    const raw = JSON.stringify({ items: [{ ...validItem, protein: -12, fat: -1 }] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.macros.protein).toBe(0);
    expect(result.items[0]?.macros.fat).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/negative protein/i);
  });

  it('falls back to a valid serving unit and warns', () => {
    const result = parseVisionJson(
      JSON.stringify({ items: [{ ...validItem, unit: 'handful' }] }),
      'food_photo'
    );

    expect(result.items[0]?.unit).toBe('g');
    expect(result.warnings.join(' ')).toMatch(/unknown unit/i);
  });

  it('falls back to "serving" for nutrition labels', () => {
    const result = parseVisionJson(
      JSON.stringify({ items: [{ ...validItem, unit: 'bottle' }] }),
      'nutrition_label'
    );

    expect(result.items[0]?.unit).toBe('serving');
  });

  it('normalizes unit aliases', () => {
    const result = parseVisionJson(
      JSON.stringify({
        items: [
          { ...validItem, name: 'Rice', unit: 'grams' },
          { ...validItem, name: 'Milk', unit: 'Tablespoons' },
          { ...validItem, name: 'Bread', unit: 'slices' },
        ],
      }),
      'food_photo'
    );

    expect(result.items.map((item) => item.unit)).toEqual(['g', 'tbsp', 'piece']);
  });

  it('derives missing calories from macros', () => {
    const raw = JSON.stringify({
      items: [{ ...validItem, name: 'Oatmeal', calories: 0, protein: 10, carbs: 20, fat: 5 }],
    });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.macros.calories).toBe(165);
    expect(result.warnings.join(' ')).toMatch(/derived from macros/i);
  });

  it('keeps stated calories but warns on a >30% macro mismatch', () => {
    const raw = JSON.stringify({
      items: [{ ...validItem, name: 'Mystery bowl', calories: 800, protein: 10, carbs: 20, fat: 5 }],
    });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.macros.calories).toBe(800);
    expect(result.warnings.join(' ')).toMatch(/don't match macros for Mystery bowl/i);
  });

  it('accepts calories within the 30% tolerance without warning', () => {
    const raw = JSON.stringify({
      items: [{ ...validItem, name: 'Yogurt', calories: 180, protein: 10, carbs: 20, fat: 5 }],
    });

    expect(parseVisionJson(raw, 'food_photo').warnings.join(' ')).not.toMatch(/don't match macros/i);
  });

  it('defaults a missing portion size to 100 g with a warning', () => {
    const raw = JSON.stringify({ items: [{ ...validItem, estimatedGrams: 0 }] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.estimatedGrams).toBe(100);
    expect(result.warnings.join(' ')).toMatch(/assumed 100 g/i);
  });

  it('defaults a non-positive quantity to 1', () => {
    const raw = JSON.stringify({ items: [{ ...validItem, quantity: 0 }] });
    expect(parseVisionJson(raw, 'food_photo').items[0]?.quantity).toBe(1);
  });

  it('drops blank-name items and reports it', () => {
    const raw = JSON.stringify({ items: [{ ...validItem, name: '   ' }, validItem] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/no name/i);
  });

  it('returns an empty list when every item is dropped', () => {
    const raw = JSON.stringify({ items: [{ calories: 100 }, { name: '' }] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('keeps model-supplied warnings', () => {
    const raw = JSON.stringify({ items: [], warnings: ['No food detected in this photo.'] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items).toEqual([]);
    expect(result.warnings).toContain('No food detected in this photo.');
  });

  it('reads nested macros and snake_case keys', () => {
    const raw = JSON.stringify({
      items: [
        {
          name: 'Protein shake',
          serving_size: '1 scoop (32 g)',
          estimated_grams: 32,
          macros: {
            calories: 120,
            protein: 24,
            total_carbohydrate: 3,
            total_fat: 1.5,
            dietary_fiber: 1,
          },
          confidence: 0.9,
        },
      ],
    });
    const item = parseVisionJson(raw, 'nutrition_label').items[0];

    expect(item?.estimatedGrams).toBe(32);
    expect(item?.macros).toMatchObject({ calories: 120, protein: 24, carbs: 3, fat: 1.5, fiber: 1 });
    expect(item?.servingLabel).toBe('1 scoop (32 g)');
  });

  it('synthesizes a serving label when one is missing', () => {
    const raw = JSON.stringify({
      items: [{ name: 'Almonds', unit: 'g', estimatedGrams: 28, calories: 170, protein: 6, carbs: 6, fat: 15 }],
    });

    expect(parseVisionJson(raw, 'food_photo').items[0]?.servingLabel).toBe('28 g');
  });

  it('never throws on garbage input', () => {
    const garbage = ['lorem ipsum dolor sit amet', '', '   ', '{ broken json', '[[[', '42', 'null'];

    for (const raw of garbage) {
      expect(() => parseVisionJson(raw, 'food_photo')).not.toThrow();
      const result = parseVisionJson(raw, 'food_photo');
      expect(result.items).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it('never throws on non-string input', () => {
    const result = parseVisionJson(undefined as unknown as string, 'food_photo');

    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('repairs trailing commas', () => {
    const raw =
      '{"items": [{"name": "Toast", "estimatedGrams": 30, "calories": 80, "protein": 3, "carbs": 15, "fat": 1,},],}';

    expect(parseVisionJson(raw, 'food_photo').items).toHaveLength(1);
  });
});
