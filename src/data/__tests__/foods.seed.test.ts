import {
  ALCOHOL_SEED_NAMES,
  FOOD_CATEGORIES,
  FOOD_CATEGORY_LABELS,
  POPULAR_SEED_NAMES,
  SEED_FOODS,
  countSeedFoodsByCategory,
  getSeedFoodsByCategory,
  seedFoodToFoodInput,
  type FoodCategory,
  type SeedFood,
} from '@/data/foods.seed';

const CATEGORY_SET = new Set<FoodCategory>(FOOD_CATEGORIES);

/** Energy predicted by the Atwater 4/4/9 factors. */
function atwater(f: SeedFood): number {
  return f.per100g.protein * 4 + f.per100g.carbs * 4 + f.per100g.fat * 9;
}

function keyOf(f: SeedFood): string {
  return `${f.name.toLowerCase()}|${(f.brand ?? '').toLowerCase()}`;
}

function findFood(name: string): SeedFood {
  const found = SEED_FOODS.find((f) => f.name === name);
  if (!found) throw new Error(`Seed food not found: ${name}`);
  return found;
}

const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'] as const;

describe('SEED_FOODS dataset', () => {
  it('contains at least 250 foods', () => {
    expect(SEED_FOODS.length).toBeGreaterThanOrEqual(250);
  });

  it('covers every category with a meaningful number of foods', () => {
    const counts = countSeedFoodsByCategory();
    const thin = FOOD_CATEGORIES.filter((c) => counts[c] < 8);
    expect(thin).toEqual([]);
  });

  it('has unique name + brand pairs', () => {
    const seen = new Map<string, number>();
    for (const f of SEED_FOODS) seen.set(keyOf(f), (seen.get(keyOf(f)) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(duplicates).toEqual([]);
  });

  it('has a label for every category and only known categories', () => {
    const unknown = SEED_FOODS.filter((f) => !CATEGORY_SET.has(f.category)).map((f) => f.name);
    expect(unknown).toEqual([]);
    for (const category of FOOD_CATEGORIES) {
      expect(typeof FOOD_CATEGORY_LABELS[category]).toBe('string');
      expect(FOOD_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }
  });

  it('has no negative, NaN or non-finite nutrition values', () => {
    const bad: string[] = [];
    for (const f of SEED_FOODS) {
      for (const key of MACRO_KEYS) {
        const value = f.per100g[key];
        if (value === undefined) continue;
        if (!Number.isFinite(value) || value < 0) bad.push(`${f.name}.${key}=${String(value)}`);
      }
      if (!Number.isFinite(f.servingSizeG) || f.servingSizeG <= 0) {
        bad.push(`${f.name}.servingSizeG=${String(f.servingSizeG)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps macro totals physically plausible (<= 100 g per 100 g)', () => {
    const bad = SEED_FOODS.filter(
      (f) => f.per100g.protein + f.per100g.carbs + f.per100g.fat > 100.5,
    ).map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('keeps calories within 10% of the 4/4/9 calculation (alcohol excepted)', () => {
    const allowed = new Set(ALCOHOL_SEED_NAMES);
    const offenders: string[] = [];

    for (const f of SEED_FOODS) {
      if (allowed.has(f.name)) continue;
      const expected = atwater(f);
      const actual = f.per100g.calories;

      if (expected === 0) {
        if (actual !== 0) offenders.push(`${f.name}: ${actual} kcal but macros are all zero`);
        continue;
      }
      const drift = Math.abs(actual - expected) / expected;
      if (drift > 0.1) {
        offenders.push(`${f.name}: ${actual} kcal vs ${expected.toFixed(1)} (${(drift * 100).toFixed(1)}%)`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('gives zero-calorie foods all-zero macros', () => {
    const zeroCalorie = SEED_FOODS.filter((f) => f.per100g.calories === 0);
    expect(zeroCalorie.map((f) => f.name)).toEqual(
      expect.arrayContaining(['Water', 'Coffee, black', 'Diet cola']),
    );
    for (const f of zeroCalorie) {
      expect(f.per100g.protein).toBe(0);
      expect(f.per100g.carbs).toBe(0);
      expect(f.per100g.fat).toBe(0);
    }
  });

  it('flags every alcohol exception as a real seed food that needs it', () => {
    for (const name of ALCOHOL_SEED_NAMES) {
      const food = findFood(name);
      expect(food.category).toBe('beverages');
      // Ethanol energy is unaccounted for by the macro triplet.
      expect(food.per100g.calories).toBeGreaterThan(atwater(food));
    }
  });

  it('has a serving label with a gram figure that matches servingSizeG', () => {
    const offenders: string[] = [];
    for (const f of SEED_FOODS) {
      if (f.servingLabel.trim().length === 0) {
        offenders.push(`${f.name}: empty label`);
        continue;
      }
      const match = /(\d+(?:\.\d+)?)\s*g\b/.exec(f.servingLabel);
      if (!match) {
        offenders.push(`${f.name}: "${f.servingLabel}" has no gram figure`);
        continue;
      }
      if (Number(match[1]) !== f.servingSizeG) {
        offenders.push(`${f.name}: label says ${match[1]} g but servingSizeG is ${f.servingSizeG}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('describes a household portion in every serving label', () => {
    const offenders = SEED_FOODS.filter((f) => !/[a-z]/i.test(f.servingLabel.replace(/\dg/gi, '')))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('uses realistic serving sizes', () => {
    const offenders = SEED_FOODS.filter((f) => f.servingSizeG < 0.5 || f.servingSizeG > 600).map(
      (f) => `${f.name}=${f.servingSizeG}`,
    );
    expect(offenders).toEqual([]);
  });

  it('has non-empty trimmed names and lowercase non-empty aliases', () => {
    const offenders: string[] = [];
    for (const f of SEED_FOODS) {
      if (f.name.trim() !== f.name || f.name.length === 0) offenders.push(`name:${f.name}`);
      for (const alias of f.aliases ?? []) {
        if (alias.trim().length === 0) offenders.push(`${f.name}: empty alias`);
        if (alias !== alias.toLowerCase()) offenders.push(`${f.name}: alias not lowercase (${alias})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exposes popular foods that all exist', () => {
    expect(POPULAR_SEED_NAMES.length).toBeGreaterThanOrEqual(10);
    for (const name of POPULAR_SEED_NAMES) expect(() => findFood(name)).not.toThrow();
  });

  describe('spot checks against reference values', () => {
    it('chicken breast is ~165 kcal and 31 g protein per 100 g', () => {
      const chicken = findFood('Chicken breast, cooked');
      expect(chicken.per100g.calories).toBe(165);
      expect(chicken.per100g.protein).toBe(31);
      expect(chicken.per100g.carbs).toBe(0);
      expect(chicken.category).toBe('protein');
    });

    it('banana is ~89 kcal per 100 g', () => {
      const banana = findFood('Banana');
      expect(banana.per100g.calories).toBe(89);
      expect(banana.servingSizeG).toBe(118);
      expect(banana.category).toBe('fruit');
    });

    it('almonds are ~579 kcal per 100 g', () => {
      const almonds = findFood('Almonds');
      expect(almonds.per100g.calories).toBe(579);
      expect(almonds.per100g.fat).toBeCloseTo(49.9, 1);
      expect(almonds.per100g.protein).toBeCloseTo(21.2, 1);
    });

    it('olive oil is 884 kcal and 100 g fat per 100 g', () => {
      const oil = findFood('Olive oil');
      expect(oil.per100g.calories).toBe(884);
      expect(oil.per100g.fat).toBe(100);
      expect(oil.per100g.protein).toBe(0);
      expect(oil.per100g.carbs).toBe(0);
    });

    it('whole egg is ~143 kcal per 100 g', () => {
      const egg = findFood('Egg, whole, raw');
      expect(egg.per100g.calories).toBe(143);
      expect(egg.per100g.protein).toBeCloseTo(12.6, 1);
      expect(egg.servingSizeG).toBe(50);
    });

    it('white rice cooked is ~130 kcal per 100 g', () => {
      const rice = findFood('White rice, cooked');
      expect(rice.per100g.calories).toBe(130);
      expect(rice.per100g.carbs).toBeCloseTo(28.2, 1);
    });

    it('nonfat Greek yogurt is protein forward', () => {
      const yogurt = findFood('Greek yogurt, plain nonfat');
      expect(yogurt.per100g.protein).toBeGreaterThan(9);
      expect(yogurt.per100g.fat).toBeLessThan(1);
    });
  });

  describe('required staple coverage', () => {
    const staples = [
      'Chicken breast, cooked',
      'Chicken thigh, boneless skinless',
      'Turkey breast, roasted',
      'Ground beef, 95% lean, cooked',
      'Ground beef, 85% lean, cooked',
      'Sirloin steak, grilled',
      'Pork chop, boneless',
      'Bacon, pan-fried',
      'Salmon, Atlantic, cooked',
      'Tuna, canned in water',
      'Tilapia, cooked',
      'Shrimp, cooked',
      'Cod, cooked',
      'Egg, whole, raw',
      'Egg white, raw',
      'Tofu, firm',
      'Tempeh',
      'Seitan',
      'Black beans, cooked',
      'Pinto beans, cooked',
      'Kidney beans, cooked',
      'Lentils, cooked',
      'Chickpeas, cooked',
      'Milk, whole 3.25%',
      'Milk, 2%',
      'Milk, skim',
      'Greek yogurt, plain nonfat',
      'Cottage cheese, 2%',
      'Cheddar cheese',
      'Mozzarella, part-skim',
      'Parmesan, grated',
      'Feta cheese',
      'Cream cheese',
      'Butter',
      'Heavy whipping cream',
      'Almond milk, unsweetened',
      'Oat milk, original',
      'Soy milk, unsweetened',
      'White rice, cooked',
      'Brown rice, cooked',
      'Quinoa, cooked',
      'Oats, rolled, dry',
      'Oatmeal, cooked with water',
      'Whole wheat bread',
      'White bread',
      'Bagel, plain',
      'Flour tortilla',
      'Corn tortilla',
      'Pasta, cooked',
      'Couscous, cooked',
      'Sweet potato, baked',
      'Potato, baked with skin',
      'Sweet corn, cooked',
      'Banana',
      'Apple',
      'Orange',
      'Strawberries',
      'Blueberries',
      'Raspberries',
      'Grapes',
      'Watermelon',
      'Mango',
      'Pineapple',
      'Avocado',
      'Peach',
      'Pear',
      'Cherries',
      'Kiwi',
      'Dates, medjool',
      'Raisins',
      'Broccoli, raw',
      'Spinach, raw',
      'Kale, raw',
      'Carrots, raw',
      'Bell pepper, red',
      'Tomato',
      'Cucumber',
      'Zucchini',
      'Cauliflower',
      'Green beans, cooked',
      'Asparagus, cooked',
      'Mushrooms, white',
      'Onion, raw',
      'Romaine lettuce',
      'Brussels sprouts, cooked',
      'Cabbage, raw',
      'Peas, green cooked',
      'Eggplant, cooked',
      'Almonds',
      'Peanuts, dry roasted',
      'Peanut butter',
      'Almond butter',
      'Walnuts',
      'Cashews',
      'Pistachios',
      'Chia seeds',
      'Flaxseed, ground',
      'Sunflower seeds',
      'Olive oil',
      'Coconut oil',
      'Canola oil',
      'Mayonnaise',
      'Water',
      'Coffee, black',
      'Latte with whole milk',
      'Orange juice',
      'Apple juice',
      'Cola',
      'Diet cola',
      'Sports drink',
      'Beer, regular',
      'Wine, red',
      'Protein shake, ready to drink',
      'Protein bar',
      'Granola bar',
      'Potato chips',
      'Tortilla chips',
      'Popcorn, air-popped',
      'Dark chocolate, 70%',
      'Ice cream, vanilla',
      'Pizza, cheese',
      'Cheeseburger, fast food',
      'French fries, fast food',
      'Sushi roll, California',
      'Chicken burrito',
      'Caesar salad',
      'Mac and cheese',
      'Ketchup',
      'Mustard, yellow',
      'Soy sauce',
      'Ranch dressing',
      'Sriracha',
      'Honey',
      'Maple syrup',
      'Sugar, granulated',
      'Salsa',
      'Hummus',
      'Whey protein isolate powder',
      'Casein protein powder',
      'Creatine monohydrate',
      'Mass gainer powder',
    ];

    it.each(staples)('includes %s', (name) => {
      expect(() => findFood(name)).not.toThrow();
    });
  });
});

describe('getSeedFoodsByCategory', () => {
  it('returns only foods from that category', () => {
    const fruit = getSeedFoodsByCategory('fruit');
    expect(fruit.length).toBeGreaterThan(20);
    expect(fruit.every((f) => f.category === 'fruit')).toBe(true);
  });

  it('category counts add up to the dataset size', () => {
    const counts = countSeedFoodsByCategory();
    const total = FOOD_CATEGORIES.reduce((sum, c) => sum + counts[c], 0);
    expect(total).toBe(SEED_FOODS.length);
  });
});

describe('seedFoodToFoodInput', () => {
  it('maps a seed record onto a Food-shaped insert payload', () => {
    const banana = findFood('Banana');
    const input = seedFoodToFoodInput(banana);

    expect(input).toMatchObject({
      name: 'Banana',
      brand: null,
      servingSizeG: 118,
      servingLabel: '1 medium (118 g)',
      barcode: null,
      source: 'seed',
      isFavorite: false,
      usageCount: 0,
      lastUsedAt: null,
    });
    expect(input.per100g).toEqual(banana.per100g);
  });

  it('copies per100g rather than sharing the reference', () => {
    const seed = SEED_FOODS[0];
    const input = seedFoodToFoodInput(seed);
    input.per100g.calories = -1;
    expect(seed.per100g.calories).not.toBe(-1);
  });

  it('produces a valid payload for every seed food', () => {
    for (const seed of SEED_FOODS) {
      const input = seedFoodToFoodInput(seed);
      expect(input.name.length).toBeGreaterThan(0);
      expect(input.source).toBe('seed');
      expect(input.servingSizeG).toBe(seed.servingSizeG);
      expect(input.per100g.calories).toBe(seed.per100g.calories);
    }
  });
});
