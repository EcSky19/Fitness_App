/**
 * Regression tests for hostile / lossy vision model output.
 *
 * Each case here reproduced a real defect in `parse.ts`; the happy-path suite
 * lives in `parse.test.ts`.
 */
import { extractJson, normalizeConfidence, parseVisionJson, toNumber } from '../parse';

const base = {
  name: 'Test food',
  estimatedGrams: 100,
  calories: 100,
  protein: 5,
  carbs: 10,
  fat: 4,
};

describe('toNumber string coercion', () => {
  it('reads a leading-dot decimal as a fraction, not a whole number', () => {
    expect(toNumber('.5')).toBe(0.5);
    expect(toNumber('.25 cup')).toBe(0.25);
    expect(toNumber('-.5')).toBe(-0.5);
  });

  it('reads scientific notation', () => {
    expect(toNumber('1e3')).toBe(1000);
    expect(toNumber('1.5E2 kcal')).toBe(150);
    expect(toNumber('2e-2')).toBeCloseTo(0.02, 10);
  });

  it('keeps a comma as a thousands separator only when it groups three digits', () => {
    expect(toNumber('1,200')).toBe(1200);
    expect(toNumber('12,345,678')).toBe(12345678);
  });

  it('reads a trailing one or two digit comma group as a decimal comma', () => {
    expect(toNumber('1,2')).toBe(1.2);
    expect(toNumber('12,5 g')).toBe(12.5);
    expect(toNumber('0,75')).toBe(0.75);
  });

  it('still reads a dot decimal', () => {
    expect(toNumber('1.200')).toBe(1.2);
    expect(toNumber('30g')).toBe(30);
  });
});

describe('confidence normalisation', () => {
  it('treats a bare 1 as full confidence, not one percent', () => {
    expect(normalizeConfidence(1)).toBe(1);
    expect(normalizeConfidence('100%')).toBe(1);
  });

  it('rescales percentages above 1', () => {
    expect(normalizeConfidence(85)).toBe(0.85);
    expect(normalizeConfidence(7)).toBe(0.07);
  });
});

describe('calorie / macro mismatch check', () => {
  /** `carbs` grams -> the macros imply `carbs * 4` kcal. */
  const item = (calories: number, carbs: number) => ({
    items: [{ ...base, name: 'Bowl', calories, protein: 0, carbs, fat: 0 }],
  });

  it('warns symmetrically when the stated calories are too LOW for the macros', () => {
    // Macros imply 140 kcal, the model said 100: a 40 kcal miss, same as below.
    const result = parseVisionJson(JSON.stringify(item(100, 35)), 'food_photo');
    expect(result.warnings.join(' ')).toMatch(/don't match macros for Bowl/i);
  });

  it('still warns when the stated calories are too HIGH for the macros', () => {
    // Macros imply 100 kcal, the model said 140: the mirror image of the above.
    const result = parseVisionJson(JSON.stringify(item(140, 25)), 'food_photo');
    expect(result.warnings.join(' ')).toMatch(/don't match macros for Bowl/i);
  });

  it('stays quiet inside the tolerance in both directions', () => {
    for (const [calories, carbs] of [
      [80, 25],
      [120, 25],
      [100, 20],
      [100, 30],
    ]) {
      const result = parseVisionJson(JSON.stringify(item(calories, carbs)), 'food_photo');
      expect(result.warnings.join(' ')).not.toMatch(/don't match macros/i);
    }
  });

  it('never warns about calories it derived itself', () => {
    const raw = JSON.stringify({
      items: [{ ...base, name: 'Derived', calories: 0, protein: 10, carbs: 20, fat: 5 }],
    });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.macros.calories).toBe(165);
    expect(result.warnings.join(' ')).toMatch(/derived from macros/i);
    expect(result.warnings.join(' ')).not.toMatch(/don't match macros/i);
  });
});

describe('truncated model output', () => {
  it('recovers the complete items from a response cut off mid-object', () => {
    const raw =
      '{"items":[{"name":"White rice","estimatedGrams":200,"calories":260,"protein":5,"carbs":57,"fat":0.5},' +
      '{"name":"Chicken breast","estimatedGrams":150,"calories":';

    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items.map((i) => i.name)).toContain('White rice');
    expect(result.items[0]?.macros.calories).toBe(260);
  });

  it('recovers a truncated response inside an unterminated string', () => {
    const raw = '{"items":[{"name":"Oatmeal","calories":150,"protein":5,"carbs":27,"fat":3},{"name":"Blueb';
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items.map((i) => i.name)).toContain('Oatmeal');
  });

  it('recovers a truncated response inside a markdown fence', () => {
    const raw = '```json\n{"items":[{"name":"Toast","calories":80,"protein":3,"carbs":15,"fat":1},{"name":';
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items.map((i) => i.name)).toContain('Toast');
  });

  it('extractJson repairs an unbalanced object', () => {
    expect(extractJson('{"items":[{"name":"Rice"')).toMatchObject({
      items: [{ name: 'Rice' }],
    });
  });

  it('still gives up on input with no JSON at all', () => {
    const result = parseVisionJson('I am afraid I cannot help with that.', 'food_photo');
    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('hostile values', () => {
  it('keeps braces that live inside a string value', () => {
    const raw = '{"items":[{"name":"rice {special}","calories":200,"protein":4,"carbs":44,"fat":0.4}]}';
    expect(parseVisionJson(raw, 'food_photo').items[0]?.name).toBe('rice {special}');
  });

  it('never emits negative zero', () => {
    // `JSON.stringify(-0)` is "0", so a model only ever delivers -0 as a string.
    const raw =
      '{"items":[{"name":"Zeroes","estimatedGrams":100,"calories":"-0","protein":"-0 g","carbs":"-0","fat":"-0"}]}';
    const macros = parseVisionJson(raw, 'food_photo').items[0]?.macros;

    expect(Object.is(macros?.calories, -0)).toBe(false);
    expect(Object.is(macros?.protein, -0)).toBe(false);
    expect(Object.is(macros?.carbs, -0)).toBe(false);
    expect(Object.is(macros?.fat, -0)).toBe(false);
  });

  it('truncates an absurdly long name instead of storing it whole', () => {
    const raw = JSON.stringify({ items: [{ ...base, name: 'A'.repeat(5000) }] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.name.length).toBeLessThanOrEqual(120);
    for (const warning of result.warnings) expect(warning.length).toBeLessThan(400);
  });

  it('rejects an impossible portion size instead of storing it', () => {
    const raw = JSON.stringify({ items: [{ ...base, estimatedGrams: 1e15 }] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.estimatedGrams).toBeLessThanOrEqual(100_000);
    expect(result.warnings.join(' ')).toMatch(/portion size/i);
  });

  it('rejects an impossible calorie figure instead of poisoning day totals', () => {
    const raw = JSON.stringify({ items: [{ ...base, name: 'Bogus', calories: 1e12, protein: 1e9 }] });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.macros.calories).toBeLessThanOrEqual(100_000);
    expect(result.items[0]?.macros.protein).toBeLessThanOrEqual(100_000);
    expect(result.warnings.join(' ')).toMatch(/implausible/i);
  });

  it('caps calories derived from macros at the same ceiling as a stated figure', () => {
    // Each macro is individually under MAX_MACRO, so it survives clamping, but
    // their energy sum (4·p + 4·c + 9·f) is not. When `calories` is absent the
    // parser derives it from the macros — and that derived figure must be held
    // to the very ceiling MAX_MACRO exists to enforce, or a single garbled item
    // smuggles a ~1.5M kcal number straight into the day's totals.
    const raw = JSON.stringify({
      items: [{ ...base, name: 'Cap bypass', calories: 0, protein: 90_000, carbs: 90_000, fat: 90_000 }],
    });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items[0]?.macros.calories).toBeLessThanOrEqual(100_000);
  });

  it('survives arrays where numbers belong, and nulls where objects belong', () => {
    const raw = '{"items":[null,{"name":"B","calories":[10],"protein":1,"carbs":1,"fat":0}]}';
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.macros.calories).toBe(8);
  });

  it('uses an alternate name key instead of dropping an item whose "name" is empty', () => {
    // Some models put the label under "food"/"label" and leave "name" empty.
    // Those keys are accepted fallbacks, so the photographed item must survive
    // rather than be silently dropped as "no name" — that is lost diary data.
    const raw = JSON.stringify({
      items: [
        { name: '', food: 'Pepperoni pizza', estimatedGrams: 200, calories: 500, protein: 20, carbs: 55, fat: 20 },
      ],
    });
    const result = parseVisionJson(raw, 'food_photo');

    expect(result.items.map((i) => i.name)).toContain('Pepperoni pizza');
  });

  it('keeps unicode names intact', () => {
    const raw = JSON.stringify({ items: [{ ...base, name: '🍕 Pizza margherita' }] });
    expect(parseVisionJson(raw, 'food_photo').items[0]?.name).toBe('🍕 Pizza margherita');
  });

  it('handles a language-tagged markdown fence', () => {
    const raw = `\`\`\`JSON\n${JSON.stringify({ items: [{ ...base, name: 'Egg' }] })}\n\`\`\``;
    expect(parseVisionJson(raw, 'food_photo').items[0]?.name).toBe('Egg');
  });
});
