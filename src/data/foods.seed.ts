/**
 * MacroTrack built-in food database.
 *
 * Values are USDA-style nutrition per 100 g (or per 100 ml for liquids, where
 * 1 ml is treated as 1 g).
 *
 * ## Energy consistency rule
 * Every entry is internally consistent with the Atwater 4/4/9 calculation:
 *
 *     calories ~= protein * 4 + carbs * 4 + fat * 9   (within ~10%)
 *
 * Reference databases do NOT satisfy that identity exactly, because they apply
 * food-specific Atwater factors and count dietary fiber differently depending
 * on how fermentable it is. To keep the app's math honest (a logged entry's
 * calories must equal the sum of its scaled macros), the `carbs` field holds
 * the *energy-contributing* carbohydrate:
 *
 * - Legumes, grains, nuts and starches: essentially total carbohydrate, since
 *   their fiber is largely fermented and is counted as energy by the reference
 *   values.
 * - Non-starchy vegetables and berries: closer to available carbohydrate
 *   (total minus most of the fiber), matching their much lower true calories.
 *
 * Total dietary fiber is always reported separately in `per100g.fiber`, so a US
 * label's "total carbohydrate" is approximately `carbs + fiber` for the
 * high-fiber plant foods above. Calories, protein and fat are the reference
 * values and are never adjusted.
 *
 * Alcoholic drinks are the one documented exception: ethanol supplies 7 kcal/g
 * and is not part of the macro triplet, so beer/wine/spirits legitimately carry
 * more calories than 4/4/9 predicts. They are listed in ALCOHOL_SEED_NAMES.
 */

import type { Food, Macros } from '@/types';

export type FoodCategory =
  | 'protein'
  | 'dairy'
  | 'grains'
  | 'fruit'
  | 'vegetable'
  | 'nuts_seeds'
  | 'fats_oils'
  | 'beverages'
  | 'snacks'
  | 'condiments'
  | 'prepared'
  | 'supplements';

export const FOOD_CATEGORIES: readonly FoodCategory[] = [
  'protein',
  'dairy',
  'grains',
  'fruit',
  'vegetable',
  'nuts_seeds',
  'fats_oils',
  'beverages',
  'snacks',
  'condiments',
  'prepared',
  'supplements',
];

export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  protein: 'Protein & Seafood',
  dairy: 'Dairy & Eggs',
  grains: 'Grains & Starches',
  fruit: 'Fruit',
  vegetable: 'Vegetables',
  nuts_seeds: 'Nuts & Seeds',
  fats_oils: 'Fats & Oils',
  beverages: 'Beverages',
  snacks: 'Snacks & Sweets',
  condiments: 'Condiments & Sauces',
  prepared: 'Prepared Meals',
  supplements: 'Supplements',
};

export interface SeedFood {
  name: string;
  brand: string | null;
  /** Nutrition per 100 g (or per 100 ml for liquids). */
  per100g: Macros;
  /** Grams in one natural serving. */
  servingSizeG: number;
  /** Household portion including its gram weight, e.g. "1 medium (118 g)". */
  servingLabel: string;
  category: FoodCategory;
  /** Alternative search terms, e.g. ['aubergine'] for eggplant. */
  aliases?: string[];
  barcode?: string | null;
}

/**
 * Foods whose energy comes partly from ethanol (7 kcal/g) and therefore cannot
 * satisfy the 4/4/9 macro identity.
 */
export const ALCOHOL_SEED_NAMES: readonly string[] = [
  'Beer, regular',
  'Beer, light',
  'Wine, red',
  'Wine, white',
  'Champagne',
  'Hard seltzer',
  'Vodka',
  'Whiskey',
];

/** Compact row form: keeps ~350 nutrition records readable and diff-friendly. */
type SeedRow = readonly [
  name: string,
  brand: string | null,
  category: FoodCategory,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber: number,
  sugar: number,
  sodium: number,
  servingSizeG: number,
  servingLabel: string,
  aliases?: readonly string[],
];

const ROWS: readonly SeedRow[] = [
  // ---------------------------------------------------------------- protein
  ['Chicken breast, cooked', null, 'protein', 165, 31, 0, 3.6, 0, 0, 74, 120, '1 breast half (120 g)', ['chicken', 'grilled chicken', 'chicken breast']],
  ['Chicken breast, raw', null, 'protein', 120, 22.5, 0, 2.6, 0, 0, 45, 115, '1 breast half (115 g)', ['raw chicken']],
  ['Chicken thigh, boneless skinless', null, 'protein', 209, 26, 0, 10.9, 0, 0, 88, 90, '1 thigh (90 g)', ['chicken thigh']],
  ['Chicken thigh with skin, roasted', null, 'protein', 229, 25, 0, 13.6, 0, 0, 84, 100, '1 thigh (100 g)'],
  ['Chicken wings, roasted', null, 'protein', 254, 25.9, 0, 17.6, 0, 0, 82, 85, '4 wings (85 g)', ['buffalo wings']],
  ['Chicken drumstick, skinless', null, 'protein', 175, 24.2, 0, 8.1, 0, 0, 95, 72, '1 drumstick (72 g)'],
  ['Ground chicken, cooked', null, 'protein', 189, 23.8, 0, 10.2, 0, 0, 82, 112, '4 oz cooked (112 g)'],
  ['Rotisserie chicken, white meat', null, 'protein', 190, 28, 0, 8, 0, 0, 400, 140, '1 cup shredded (140 g)'],
  ['Turkey breast, roasted', null, 'protein', 147, 29.9, 0, 2, 0, 0, 60, 85, '3 oz sliced (85 g)', ['turkey']],
  ['Ground turkey, 93% lean, cooked', null, 'protein', 213, 27, 0, 11.2, 0, 0, 78, 112, '4 oz cooked (112 g)'],
  ['Deli turkey breast slices', null, 'protein', 104, 17, 2.5, 2.3, 0, 1.6, 1000, 56, '2 slices (56 g)', ['lunch meat', 'cold cuts']],
  ['Ground beef, 95% lean, cooked', null, 'protein', 174, 25.6, 0, 7.6, 0, 0, 66, 112, '4 oz cooked (112 g)', ['lean ground beef', 'mince']],
  ['Ground beef, 85% lean, cooked', null, 'protein', 250, 25.8, 0, 15.9, 0, 0, 72, 112, '4 oz cooked (112 g)', ['hamburger meat']],
  ['Ground beef, 80% lean, cooked', null, 'protein', 272, 24.9, 0, 18.8, 0, 0, 75, 112, '4 oz cooked (112 g)'],
  ['Sirloin steak, grilled', null, 'protein', 201, 29.6, 0, 8.4, 0, 0, 55, 170, '6 oz steak (170 g)', ['steak', 'beef steak']],
  ['Ribeye steak, grilled', null, 'protein', 291, 24.8, 0, 21.2, 0, 0, 58, 170, '6 oz steak (170 g)', ['rib eye']],
  ['Filet mignon, grilled', null, 'protein', 212, 29.2, 0, 9.9, 0, 0, 52, 170, '6 oz steak (170 g)', ['beef tenderloin']],
  ['Beef brisket, braised', null, 'protein', 246, 28.4, 0, 14.1, 0, 0, 60, 85, '3 oz (85 g)'],
  ['Pork chop, boneless', null, 'protein', 231, 28.8, 0, 12.1, 0, 0, 62, 130, '1 chop (130 g)', ['pork']],
  ['Pork tenderloin, roasted', null, 'protein', 143, 26, 0, 3.5, 0, 0, 57, 85, '3 oz (85 g)'],
  ['Pulled pork, cooked', null, 'protein', 230, 25, 4, 12, 0, 3.5, 480, 140, '1 cup (140 g)'],
  ['Bacon, pan-fried', null, 'protein', 541, 37, 1.4, 42, 0, 0, 1717, 24, '3 slices (24 g)', ['streaky bacon']],
  ['Turkey bacon, cooked', null, 'protein', 226, 29.4, 3.4, 10.2, 0, 0, 1300, 28, '2 slices (28 g)'],
  ['Ham, sliced lean', null, 'protein', 145, 20.9, 1.5, 5.5, 0, 1.5, 1200, 56, '2 slices (56 g)'],
  ['Prosciutto', null, 'protein', 195, 26, 0.5, 10, 0, 0, 2200, 28, '3 slices (28 g)'],
  ['Pork sausage links, cooked', null, 'protein', 339, 19.4, 1.5, 28.4, 0, 0, 800, 68, '2 links (68 g)'],
  ['Chicken sausage', null, 'protein', 172, 16.5, 2.5, 10.5, 0, 1.5, 700, 85, '1 link (85 g)'],
  ['Beef jerky', null, 'protein', 410, 33.2, 11, 25.6, 1, 9, 2000, 28, '1 oz (28 g)'],
  ['Lamb chop, cooked', null, 'protein', 258, 25.6, 0, 16.5, 0, 0, 72, 113, '1 chop (113 g)', ['lamb']],
  ['Duck breast, roasted', null, 'protein', 201, 23.5, 0, 11.2, 0, 0, 65, 140, '1 breast (140 g)'],
  ['Veal cutlet, cooked', null, 'protein', 172, 31, 0, 4.6, 0, 0, 80, 113, '1 cutlet (113 g)'],
  ['Salmon, Atlantic, cooked', null, 'protein', 206, 22.1, 0, 12.3, 0, 0, 61, 113, '1 fillet (113 g)', ['salmon']],
  ['Salmon, sockeye, cooked', null, 'protein', 168, 26.5, 0, 6.4, 0, 0, 64, 113, '1 fillet (113 g)', ['wild salmon']],
  ['Smoked salmon', null, 'protein', 117, 18.3, 0, 4.3, 0, 0, 1880, 57, '2 oz (57 g)', ['lox']],
  ['Canned salmon, drained', null, 'protein', 139, 19.8, 0, 6.1, 0, 0, 420, 85, '3 oz (85 g)'],
  ['Tuna, canned in water', null, 'protein', 116, 25.5, 0, 0.8, 0, 0, 320, 142, '1 can drained (142 g)', ['canned tuna', 'tuna']],
  ['Tuna, canned in oil', null, 'protein', 198, 29.1, 0, 8.2, 0, 0, 354, 142, '1 can drained (142 g)'],
  ['Ahi tuna steak, cooked', null, 'protein', 130, 29.2, 0, 0.6, 0, 0, 47, 113, '1 steak (113 g)', ['yellowfin tuna']],
  ['Tilapia, cooked', null, 'protein', 128, 26.2, 0, 2.7, 0, 0, 56, 113, '1 fillet (113 g)'],
  ['Cod, cooked', null, 'protein', 105, 22.8, 0, 0.9, 0, 0, 78, 113, '1 fillet (113 g)'],
  ['Halibut, cooked', null, 'protein', 111, 22.5, 0, 1.6, 0, 0, 68, 113, '1 fillet (113 g)'],
  ['Mackerel, cooked', null, 'protein', 262, 23.9, 0, 17.8, 0, 0, 83, 113, '1 fillet (113 g)'],
  ['Sardines, canned in oil', null, 'protein', 208, 24.6, 0, 11.5, 0, 0, 505, 92, '1 can drained (92 g)'],
  ['Shrimp, cooked', null, 'protein', 99, 24, 0.2, 0.3, 0, 0, 111, 85, '3 oz, about 12 shrimp (85 g)', ['prawns']],
  ['Crab meat, cooked', null, 'protein', 97, 19.4, 0, 1.5, 0, 0, 293, 85, '3 oz (85 g)'],
  ['Lobster, cooked', null, 'protein', 89, 19, 0, 0.9, 0, 0, 486, 145, '1 tail (145 g)'],
  ['Scallops, cooked', null, 'protein', 111, 20.5, 5.4, 0.8, 0, 0, 392, 85, '3 oz (85 g)'],
  ['Mussels, cooked', null, 'protein', 172, 23.8, 7.4, 4.5, 0, 0, 369, 85, '3 oz (85 g)'],
  ['Oysters, raw', null, 'protein', 68, 7.1, 3.9, 2.5, 0, 0, 106, 84, '6 medium (84 g)'],
  ['Tofu, firm', null, 'protein', 144, 15.5, 3.5, 8, 2.3, 0.6, 14, 126, '1/2 block (126 g)', ['bean curd']],
  ['Tofu, silken', null, 'protein', 55, 4.8, 2, 3, 0.2, 1, 8, 120, '1/2 cup (120 g)'],
  ['Tempeh', null, 'protein', 205, 20.3, 7.6, 11.4, 6, 0, 14, 84, '3 oz (84 g)'],
  ['Seitan', null, 'protein', 141, 25, 7, 1, 0.6, 0, 400, 85, '3 oz (85 g)', ['wheat gluten']],
  ['Black beans, cooked', null, 'protein', 132, 8.9, 23.7, 0.5, 8.7, 0.3, 2, 172, '1 cup (172 g)', ['frijoles negros']],
  ['Pinto beans, cooked', null, 'protein', 143, 9, 26.2, 0.7, 9, 0.3, 1, 171, '1 cup (171 g)'],
  ['Kidney beans, cooked', null, 'protein', 127, 8.7, 22.8, 0.5, 6.4, 0.3, 2, 177, '1 cup (177 g)'],
  ['Navy beans, cooked', null, 'protein', 140, 8.2, 26.1, 0.6, 10.5, 0.4, 0, 182, '1 cup (182 g)'],
  ['Lentils, cooked', null, 'protein', 116, 9, 20.1, 0.4, 7.9, 1.8, 2, 198, '1 cup (198 g)', ['dal', 'daal']],
  ['Chickpeas, cooked', null, 'protein', 164, 8.9, 27.4, 2.6, 7.6, 4.8, 7, 164, '1 cup (164 g)', ['garbanzo beans', 'garbanzo']],
  ['Split peas, cooked', null, 'protein', 118, 8.3, 21.1, 0.4, 8.3, 2.9, 2, 196, '1 cup (196 g)'],
  ['Edamame, shelled', null, 'protein', 121, 11.9, 8.9, 5.2, 5.2, 2.2, 6, 155, '1 cup (155 g)', ['soybeans']],
  ['Refried beans, canned', null, 'protein', 90, 5.3, 14.4, 1.4, 5, 0.5, 400, 120, '1/2 cup (120 g)'],
  ['Baked beans, canned', null, 'protein', 119, 5.2, 21.6, 0.5, 5.5, 8.2, 422, 127, '1/2 cup (127 g)'],

  // ------------------------------------------------------------------ dairy
  ['Egg, whole, raw', null, 'dairy', 143, 12.6, 0.7, 9.5, 0, 0.4, 142, 50, '1 large egg (50 g)', ['egg', 'eggs']],
  ['Egg, hard-boiled', null, 'dairy', 155, 12.6, 1.1, 10.6, 0, 1.1, 124, 50, '1 large egg (50 g)', ['boiled egg']],
  ['Egg, scrambled', null, 'dairy', 149, 10, 1.6, 11, 0, 1.4, 145, 61, '1 large egg (61 g)'],
  ['Egg, fried', null, 'dairy', 196, 13.6, 0.8, 14.8, 0, 0.4, 207, 46, '1 large egg (46 g)'],
  ['Egg white, raw', null, 'dairy', 52, 10.9, 0.7, 0.2, 0, 0.7, 166, 33, '1 large egg white (33 g)', ['egg whites']],
  ['Egg yolk, raw', null, 'dairy', 322, 15.9, 3.6, 26.5, 0, 0.6, 48, 17, '1 large yolk (17 g)'],
  ['Milk, whole 3.25%', null, 'dairy', 61, 3.2, 4.8, 3.3, 0, 4.8, 43, 244, '1 cup (244 g)', ['whole milk', 'milk']],
  ['Milk, 2%', null, 'dairy', 50, 3.3, 4.8, 2, 0, 4.9, 47, 244, '1 cup (244 g)', ['reduced fat milk']],
  ['Milk, 1%', null, 'dairy', 42, 3.4, 5, 1, 0, 5.2, 44, 244, '1 cup (244 g)', ['lowfat milk']],
  ['Milk, skim', null, 'dairy', 34, 3.4, 5, 0.2, 0, 5.1, 42, 244, '1 cup (244 g)', ['nonfat milk', 'fat free milk']],
  ['Chocolate milk, lowfat', null, 'dairy', 83, 3.2, 13.3, 1.9, 0.4, 12.4, 60, 244, '1 cup (244 g)'],
  ['Greek yogurt, plain whole milk', null, 'dairy', 97, 9, 3.6, 5, 0, 3.6, 35, 170, '1 container (170 g)', ['greek yoghurt']],
  ['Greek yogurt, plain nonfat', null, 'dairy', 59, 10.3, 3.6, 0.4, 0, 3.2, 36, 170, '1 container (170 g)', ['fat free greek yogurt']],
  ['Greek yogurt, vanilla lowfat', null, 'dairy', 95, 8, 13, 1.5, 0, 11.5, 40, 150, '1 container (150 g)'],
  ['Yogurt, plain whole milk', null, 'dairy', 61, 3.5, 4.7, 3.3, 0, 4.7, 46, 245, '1 cup (245 g)', ['yoghurt']],
  ['Yogurt, plain lowfat', null, 'dairy', 63, 5.3, 7, 1.6, 0, 7, 70, 245, '1 cup (245 g)'],
  ['Kefir, plain lowfat', null, 'dairy', 55, 3.5, 4.5, 2.4, 0, 4.4, 50, 240, '1 cup (240 g)'],
  ['Cottage cheese, 2%', null, 'dairy', 84, 11, 4.3, 2.3, 0, 4.1, 330, 226, '1 cup (226 g)'],
  ['Cottage cheese, nonfat', null, 'dairy', 72, 10.4, 6.7, 0.3, 0, 5.3, 330, 226, '1 cup (226 g)'],
  ['Ricotta cheese, part-skim', null, 'dairy', 138, 11.4, 5.1, 7.9, 0, 0.3, 125, 124, '1/2 cup (124 g)'],
  ['Cheddar cheese', null, 'dairy', 403, 24.9, 1.3, 33.1, 0, 0.5, 653, 28, '1 slice (28 g)', ['cheese']],
  ['Mozzarella, part-skim', null, 'dairy', 254, 24.3, 2.8, 15.9, 0, 1.2, 619, 28, '1 oz (28 g)'],
  ['Mozzarella, whole milk', null, 'dairy', 300, 22.2, 2.2, 22.4, 0, 1, 627, 28, '1 oz (28 g)'],
  ['String cheese', null, 'dairy', 300, 24, 2, 22, 0, 1, 620, 28, '1 stick (28 g)', ['cheese stick']],
  ['Parmesan, grated', null, 'dairy', 420, 28.4, 13.9, 27.8, 0, 0.9, 1600, 5, '1 tbsp (5 g)', ['parmigiano']],
  ['Swiss cheese', null, 'dairy', 380, 27, 5.4, 27.8, 0, 1.3, 192, 28, '1 slice (28 g)'],
  ['Provolone cheese', null, 'dairy', 351, 25.6, 2.1, 26.6, 0, 0.6, 876, 28, '1 slice (28 g)'],
  ['Feta cheese', null, 'dairy', 264, 14.2, 4.1, 21.3, 0, 4.1, 1116, 28, '1 oz crumbled (28 g)'],
  ['Goat cheese, soft', null, 'dairy', 268, 18.5, 2.5, 21, 0, 2.1, 368, 28, '1 oz (28 g)', ['chevre']],
  ['Blue cheese', null, 'dairy', 353, 21.4, 2.3, 28.7, 0, 0.5, 1395, 28, '1 oz (28 g)'],
  ['American cheese slice', null, 'dairy', 371, 18, 8, 30, 0, 5, 1450, 21, '1 slice (21 g)'],
  ['Cream cheese', null, 'dairy', 342, 5.9, 5.5, 34.2, 0, 3.8, 321, 30, '2 tbsp (30 g)'],
  ['Cream cheese, light', null, 'dairy', 201, 7.9, 7.5, 15.3, 0, 5.6, 460, 30, '2 tbsp (30 g)'],
  ['Butter', null, 'dairy', 717, 0.9, 0.1, 81.1, 0, 0.1, 11, 14, '1 tbsp (14 g)', ['unsalted butter']],
  ['Butter, salted', null, 'dairy', 717, 0.9, 0.1, 81.1, 0, 0.1, 643, 14, '1 tbsp (14 g)'],
  ['Heavy whipping cream', null, 'dairy', 340, 2.8, 2.8, 36.1, 0, 2.9, 27, 15, '1 tbsp (15 g)', ['double cream']],
  ['Half and half', null, 'dairy', 130, 3, 4.3, 11.5, 0, 4.3, 41, 30, '2 tbsp (30 g)'],
  ['Sour cream', null, 'dairy', 198, 2.4, 4.6, 19.4, 0, 3.5, 80, 30, '2 tbsp (30 g)'],
  ['Whipped cream, aerosol', null, 'dairy', 257, 3.2, 12.5, 22.2, 0, 12.5, 130, 8, '2 tbsp (8 g)'],
  ['Almond milk, unsweetened', null, 'dairy', 15, 0.6, 0.6, 1.1, 0.3, 0, 72, 240, '1 cup (240 g)', ['almondmilk']],
  ['Oat milk, original', null, 'dairy', 47, 1, 6.7, 1.5, 0.8, 3.3, 42, 240, '1 cup (240 g)', ['oatmilk']],
  ['Soy milk, unsweetened', null, 'dairy', 33, 2.8, 1.8, 1.6, 0.4, 0.5, 38, 240, '1 cup (240 g)', ['soymilk']],
  ['Coconut milk beverage', null, 'dairy', 20, 0.2, 1, 1.6, 0, 1, 40, 240, '1 cup (240 g)'],

  // ----------------------------------------------------------------- grains
  ['White rice, cooked', null, 'grains', 130, 2.7, 28.2, 0.3, 0.4, 0.1, 1, 158, '1 cup cooked (158 g)', ['rice']],
  ['Brown rice, cooked', null, 'grains', 123, 2.7, 25.6, 1, 1.6, 0.4, 4, 195, '1 cup cooked (195 g)'],
  ['Jasmine rice, cooked', null, 'grains', 129, 2.9, 28, 0.3, 0.5, 0.1, 1, 158, '1 cup cooked (158 g)'],
  ['Basmati rice, cooked', null, 'grains', 121, 3.5, 25.2, 0.4, 0.7, 0.1, 1, 158, '1 cup cooked (158 g)'],
  ['Wild rice, cooked', null, 'grains', 101, 4, 21.3, 0.3, 1.8, 0.7, 3, 164, '1 cup cooked (164 g)'],
  ['Quinoa, cooked', null, 'grains', 120, 4.4, 21.3, 1.9, 2.8, 0.9, 7, 185, '1 cup cooked (185 g)'],
  ['Oats, rolled, dry', null, 'grains', 379, 13.2, 67.7, 6.5, 10.1, 1, 6, 40, '1/2 cup dry (40 g)', ['oatmeal', 'porridge oats']],
  ['Oatmeal, cooked with water', null, 'grains', 71, 2.5, 12, 1.5, 1.7, 0.3, 4, 234, '1 cup cooked (234 g)'],
  ['Steel-cut oats, dry', null, 'grains', 375, 13, 68, 6, 10, 1, 5, 45, '1/4 cup dry (45 g)'],
  ['Whole wheat bread', null, 'grains', 254, 12.3, 43.1, 3.5, 6, 6, 450, 43, '2 slices (43 g)', ['brown bread', 'wheat bread']],
  ['White bread', null, 'grains', 266, 7.6, 49, 3.3, 2.4, 5.7, 490, 50, '2 slices (50 g)', ['bread']],
  ['Sourdough bread', null, 'grains', 289, 11.7, 56.3, 1.7, 2.4, 2.5, 570, 56, '2 slices (56 g)'],
  ['Rye bread', null, 'grains', 259, 8.5, 48.3, 3.3, 5.8, 3.9, 603, 64, '2 slices (64 g)'],
  ['Bagel, plain', null, 'grains', 257, 10, 50.5, 1.5, 2.2, 5.4, 480, 98, '1 medium bagel (98 g)'],
  ['English muffin', null, 'grains', 235, 7.7, 46, 1.8, 3.9, 3.9, 420, 57, '1 muffin (57 g)'],
  ['Pita bread, white', null, 'grains', 275, 9.1, 55.7, 1.2, 2.2, 1.2, 536, 60, '1 pita (60 g)'],
  ['Naan bread', null, 'grains', 310, 9, 50, 8, 2.2, 3.5, 420, 90, '1 naan (90 g)'],
  ['Flour tortilla', null, 'grains', 306, 8.2, 51.4, 7.4, 3.1, 2.5, 590, 45, '1 tortilla (45 g)', ['wrap']],
  ['Corn tortilla', null, 'grains', 218, 5.7, 44.6, 2.9, 4.5, 0.9, 45, 26, '1 tortilla (26 g)'],
  ['Pasta, cooked', null, 'grains', 158, 5.8, 30.9, 0.9, 1.8, 0.6, 1, 140, '1 cup cooked (140 g)', ['spaghetti', 'penne', 'noodles']],
  ['Whole wheat pasta, cooked', null, 'grains', 149, 6, 30, 1.3, 4.5, 1, 4, 140, '1 cup cooked (140 g)'],
  ['Soba noodles, cooked', null, 'grains', 99, 5.1, 21.4, 0.1, 1.5, 0.6, 60, 114, '1 cup cooked (114 g)', ['buckwheat noodles']],
  ['Ramen noodles, cooked', null, 'grains', 138, 3.5, 20, 5, 1, 0.5, 700, 150, '1 cup cooked (150 g)'],
  ['Couscous, cooked', null, 'grains', 112, 3.8, 23.2, 0.2, 1.4, 0.1, 5, 157, '1 cup cooked (157 g)'],
  ['Barley, cooked', null, 'grains', 123, 2.3, 28.2, 0.4, 3.8, 0.3, 3, 157, '1 cup cooked (157 g)'],
  ['Farro, cooked', null, 'grains', 130, 5, 26, 1, 3.5, 0.5, 4, 170, '1 cup cooked (170 g)'],
  ['Millet, cooked', null, 'grains', 119, 3.5, 23.7, 1, 1.3, 0.1, 2, 174, '1 cup cooked (174 g)'],
  ['Polenta, cooked', null, 'grains', 70, 1.6, 15, 0.3, 0.9, 0.2, 240, 240, '1 cup (240 g)', ['cornmeal']],
  ['Sweet potato, baked', null, 'grains', 90, 2, 20.7, 0.2, 3.3, 6.5, 36, 130, '1 medium (130 g)', ['yam', 'kumara']],
  ['Potato, baked with skin', null, 'grains', 93, 2.5, 21.2, 0.1, 2.2, 1.2, 10, 173, '1 medium (173 g)', ['baked potato']],
  ['Potato, boiled', null, 'grains', 87, 1.9, 20.1, 0.1, 1.8, 0.9, 4, 150, '1 medium (150 g)'],
  ['Mashed potatoes', null, 'grains', 113, 2, 16.9, 4.2, 1.5, 1.6, 317, 210, '1 cup (210 g)'],
  ['Hash browns', null, 'grains', 265, 3, 35, 13, 3, 0.5, 340, 100, '1 patty (100 g)'],
  ['Sweet corn, cooked', null, 'grains', 96, 3.2, 17.9, 1.3, 2.4, 4.5, 15, 154, '1 cup kernels (154 g)', ['corn']],
  ['Corn flakes cereal', null, 'grains', 357, 7.5, 84, 0.4, 3, 8.5, 729, 28, '1 cup (28 g)'],
  ['Toasted oat cereal', null, 'grains', 379, 12.1, 73.2, 6.7, 10, 4.4, 500, 28, '1 cup (28 g)', ['cheerios']],
  ['Frosted flakes cereal', null, 'grains', 375, 4, 90, 0.5, 2, 37, 480, 31, '1 cup (31 g)'],
  ['Granola cereal', null, 'grains', 471, 10, 64, 20, 7, 20, 90, 55, '1/2 cup (55 g)'],
  ['Bran flakes cereal', null, 'grains', 350, 10, 76, 2, 15, 18, 600, 30, '3/4 cup (30 g)'],
  ['Pancakes', null, 'grains', 227, 6.4, 28, 9.7, 1, 6, 439, 77, '2 pancakes (77 g)'],
  ['Waffle', null, 'grains', 291, 7.9, 32.9, 14.1, 1.9, 5.6, 511, 75, '1 waffle (75 g)'],
  ['French toast', null, 'grains', 229, 7.7, 25, 10.8, 1.2, 6, 350, 65, '1 slice (65 g)'],
  ['Croissant', null, 'grains', 406, 8.2, 45.8, 21, 2.6, 11.3, 458, 57, '1 medium (57 g)'],
  ['Rice cakes, plain', null, 'grains', 387, 8.2, 81.5, 2.8, 4.2, 0.6, 26, 9, '1 cake (9 g)'],
  ['Breadcrumbs, dry', null, 'grains', 395, 13.4, 71.9, 5.3, 4.5, 6.2, 732, 30, '1/4 cup (30 g)'],

  // ------------------------------------------------------------------ fruit
  ['Banana', null, 'fruit', 89, 1.1, 20.5, 0.3, 2.6, 12.2, 1, 118, '1 medium (118 g)', ['bananas']],
  ['Apple', null, 'fruit', 52, 0.3, 12.3, 0.2, 2.4, 10.4, 1, 182, '1 medium (182 g)', ['apples']],
  ['Orange', null, 'fruit', 47, 0.9, 10.6, 0.1, 2.4, 9.4, 0, 131, '1 medium (131 g)'],
  ['Clementine', null, 'fruit', 47, 0.9, 10.4, 0.2, 1.7, 9.2, 1, 74, '1 clementine (74 g)', ['mandarin', 'tangerine']],
  ['Grapefruit', null, 'fruit', 42, 0.8, 9.5, 0.1, 1.6, 6.9, 0, 123, '1/2 fruit (123 g)'],
  ['Lemon', null, 'fruit', 29, 1.1, 5.5, 0.3, 2.8, 2.5, 2, 58, '1 medium (58 g)'],
  ['Strawberries', null, 'fruit', 32, 0.7, 6.6, 0.3, 2, 4.9, 1, 152, '1 cup sliced (152 g)', ['strawberry']],
  ['Blueberries', null, 'fruit', 57, 0.7, 12.9, 0.3, 2.4, 10, 1, 148, '1 cup (148 g)', ['blueberry']],
  ['Raspberries', null, 'fruit', 52, 1.2, 10.2, 0.7, 6.5, 4.4, 1, 123, '1 cup (123 g)'],
  ['Blackberries', null, 'fruit', 43, 1.4, 8.2, 0.5, 5.3, 4.9, 1, 144, '1 cup (144 g)'],
  ['Grapes', null, 'fruit', 69, 0.7, 16.1, 0.2, 0.9, 16, 2, 151, '1 cup (151 g)'],
  ['Watermelon', null, 'fruit', 30, 0.6, 6.5, 0.2, 0.4, 6.2, 1, 152, '1 cup diced (152 g)'],
  ['Cantaloupe', null, 'fruit', 34, 0.8, 7.3, 0.2, 0.9, 7.9, 16, 160, '1 cup diced (160 g)', ['rockmelon']],
  ['Honeydew melon', null, 'fruit', 36, 0.5, 8.3, 0.1, 0.8, 8.1, 18, 170, '1 cup diced (170 g)'],
  ['Mango', null, 'fruit', 60, 0.8, 13.3, 0.4, 1.6, 13.7, 1, 165, '1 cup sliced (165 g)'],
  ['Pineapple', null, 'fruit', 50, 0.5, 11.8, 0.1, 1.4, 9.9, 1, 165, '1 cup chunks (165 g)'],
  ['Papaya', null, 'fruit', 43, 0.5, 9.6, 0.3, 1.7, 7.8, 8, 145, '1 cup cubed (145 g)'],
  ['Kiwi', null, 'fruit', 61, 1.1, 13, 0.5, 3, 9, 3, 76, '1 medium (76 g)', ['kiwifruit']],
  ['Avocado', null, 'fruit', 160, 2, 4.9, 14.7, 6.7, 0.7, 7, 100, '1/2 avocado (100 g)'],
  ['Peach', null, 'fruit', 39, 0.9, 8.2, 0.3, 1.5, 8.4, 0, 150, '1 medium (150 g)'],
  ['Nectarine', null, 'fruit', 44, 1.1, 9.2, 0.3, 1.7, 7.9, 0, 142, '1 medium (142 g)'],
  ['Pear', null, 'fruit', 57, 0.4, 13.6, 0.1, 3.1, 9.8, 1, 178, '1 medium (178 g)'],
  ['Plum', null, 'fruit', 46, 0.7, 10.1, 0.3, 1.4, 9.9, 0, 66, '1 medium (66 g)'],
  ['Apricot', null, 'fruit', 48, 1.4, 9.7, 0.4, 2, 9.2, 1, 35, '1 apricot (35 g)'],
  ['Cherries', null, 'fruit', 63, 1.1, 14.2, 0.2, 2.1, 12.8, 0, 138, '1 cup (138 g)', ['cherry']],
  ['Pomegranate arils', null, 'fruit', 83, 1.7, 16.4, 1.2, 4, 13.7, 3, 87, '1/2 cup (87 g)'],
  ['Fig, fresh', null, 'fruit', 74, 0.8, 17, 0.3, 2.9, 16.3, 1, 50, '1 medium (50 g)'],
  ['Cranberries, raw', null, 'fruit', 46, 0.4, 10.9, 0.1, 3.6, 4, 2, 100, '1 cup (100 g)'],
  ['Coconut, shredded raw', null, 'fruit', 354, 3.3, 9.8, 33.5, 9, 6.2, 20, 80, '1 cup (80 g)'],
  ['Dates, medjool', null, 'fruit', 277, 1.8, 67, 0.2, 6.7, 66.5, 1, 24, '1 date (24 g)'],
  ['Raisins', null, 'fruit', 299, 3.1, 70.5, 0.5, 3.7, 59.2, 11, 43, '1/4 cup (43 g)', ['sultanas']],
  ['Prunes', null, 'fruit', 240, 2.2, 56.9, 0.4, 7.1, 38.1, 2, 42, '5 prunes (42 g)', ['dried plums']],
  ['Dried apricots', null, 'fruit', 241, 3.4, 55.7, 0.5, 7.3, 53.4, 10, 40, '8 halves (40 g)'],
  ['Dried cranberries', null, 'fruit', 308, 0.1, 74.4, 1.1, 5.7, 65, 3, 40, '1/3 cup (40 g)', ['craisins']],
  ['Applesauce, unsweetened', null, 'fruit', 42, 0.2, 10.1, 0.1, 1.1, 9.4, 2, 122, '1/2 cup (122 g)'],

  // -------------------------------------------------------------- vegetable
  ['Broccoli, raw', null, 'vegetable', 34, 2.8, 4.8, 0.4, 2.6, 1.7, 33, 91, '1 cup chopped (91 g)', ['broccoli']],
  ['Broccoli, cooked', null, 'vegetable', 35, 2.4, 5.5, 0.4, 3.3, 1.4, 41, 156, '1 cup cooked (156 g)'],
  ['Spinach, raw', null, 'vegetable', 23, 2.9, 2, 0.4, 2.2, 0.4, 79, 30, '1 cup (30 g)', ['baby spinach']],
  ['Spinach, cooked', null, 'vegetable', 23, 3, 2.1, 0.3, 2.4, 0.4, 70, 180, '1 cup cooked (180 g)'],
  ['Kale, raw', null, 'vegetable', 35, 2.9, 2.5, 1.5, 4.1, 0.8, 53, 67, '1 cup chopped (67 g)'],
  ['Arugula', null, 'vegetable', 25, 2.6, 2.1, 0.7, 1.6, 2, 27, 20, '1 cup (20 g)', ['rocket']],
  ['Romaine lettuce', null, 'vegetable', 17, 1.2, 2.4, 0.3, 2.1, 1.2, 8, 47, '1 cup shredded (47 g)', ['lettuce', 'cos lettuce']],
  ['Swiss chard, cooked', null, 'vegetable', 20, 1.9, 2.9, 0.1, 2.1, 1.1, 179, 175, '1 cup cooked (175 g)'],
  ['Bok choy, cooked', null, 'vegetable', 12, 1.6, 1, 0.2, 1, 0.8, 34, 170, '1 cup cooked (170 g)', ['pak choi']],
  ['Carrots, raw', null, 'vegetable', 41, 0.9, 8.9, 0.2, 2.8, 4.7, 69, 128, '1 cup chopped (128 g)', ['carrot']],
  ['Bell pepper, red', null, 'vegetable', 31, 1, 6.1, 0.3, 2.1, 4.2, 4, 119, '1 medium (119 g)', ['capsicum', 'red pepper', 'sweet pepper']],
  ['Bell pepper, green', null, 'vegetable', 20, 0.9, 3.4, 0.2, 1.7, 2.4, 3, 119, '1 medium (119 g)'],
  ['Tomato', null, 'vegetable', 18, 0.9, 3.2, 0.2, 1.2, 2.6, 5, 123, '1 medium (123 g)', ['tomatoes']],
  ['Cherry tomatoes', null, 'vegetable', 18, 0.9, 3.2, 0.2, 1.2, 2.6, 5, 149, '1 cup (149 g)'],
  ['Cucumber', null, 'vegetable', 15, 0.7, 2.9, 0.1, 0.5, 1.7, 2, 104, '1 cup sliced (104 g)'],
  ['Zucchini', null, 'vegetable', 17, 1.2, 2.4, 0.3, 1, 2.5, 8, 124, '1 cup sliced (124 g)', ['courgette']],
  ['Cauliflower', null, 'vegetable', 25, 1.9, 3.7, 0.3, 2, 1.9, 30, 107, '1 cup chopped (107 g)'],
  ['Green beans, cooked', null, 'vegetable', 35, 1.9, 6.2, 0.3, 3.2, 3.3, 6, 125, '1 cup cooked (125 g)', ['string beans']],
  ['Asparagus, cooked', null, 'vegetable', 22, 2.4, 2.7, 0.2, 2, 1.3, 14, 180, '1 cup cooked (180 g)'],
  ['Mushrooms, white', null, 'vegetable', 24, 3.1, 2.2, 0.3, 1, 2, 5, 96, '1 cup sliced (96 g)', ['button mushrooms', 'mushroom']],
  ['Portobello mushroom, grilled', null, 'vegetable', 29, 3.3, 3.2, 0.6, 2.2, 2.5, 11, 84, '1 cap (84 g)'],
  ['Onion, raw', null, 'vegetable', 40, 1.1, 8.7, 0.1, 1.7, 4.2, 4, 110, '1 medium (110 g)', ['onions']],
  ['Green onion', null, 'vegetable', 32, 1.8, 5.8, 0.2, 2.6, 2.3, 16, 15, '2 tbsp chopped (15 g)', ['scallion', 'spring onion']],
  ['Garlic', null, 'vegetable', 149, 6.4, 29.7, 0.5, 2.1, 1, 17, 3, '1 clove (3 g)'],
  ['Brussels sprouts, cooked', null, 'vegetable', 36, 2.6, 5.3, 0.5, 2.6, 1.4, 21, 156, '1 cup cooked (156 g)'],
  ['Cabbage, raw', null, 'vegetable', 25, 1.3, 4.7, 0.1, 2.5, 3.2, 18, 89, '1 cup shredded (89 g)'],
  ['Red cabbage, raw', null, 'vegetable', 31, 1.4, 5.9, 0.2, 2.1, 3.8, 27, 89, '1 cup shredded (89 g)'],
  ['Peas, green cooked', null, 'vegetable', 84, 5.4, 15.2, 0.2, 5.5, 5.9, 3, 160, '1 cup cooked (160 g)'],
  ['Snap peas, raw', null, 'vegetable', 42, 2.8, 7.3, 0.2, 2.6, 4, 4, 98, '1 cup (98 g)', ['sugar snap peas']],
  ['Eggplant, cooked', null, 'vegetable', 35, 0.8, 7.5, 0.2, 2.5, 3.2, 1, 99, '1 cup cubed (99 g)', ['aubergine', 'brinjal']],
  ['Celery', null, 'vegetable', 16, 0.7, 2.9, 0.2, 1.6, 1.3, 80, 101, '1 cup chopped (101 g)'],
  ['Beets, cooked', null, 'vegetable', 44, 1.7, 8.9, 0.2, 2, 8, 77, 136, '1 cup sliced (136 g)', ['beetroot']],
  ['Butternut squash, cooked', null, 'vegetable', 40, 0.9, 8.9, 0.1, 2, 1.9, 4, 205, '1 cup cubed (205 g)'],
  ['Pumpkin, cooked', null, 'vegetable', 20, 0.7, 4.1, 0.1, 1.1, 2.1, 1, 245, '1 cup mashed (245 g)'],
  ['Radish', null, 'vegetable', 16, 0.7, 3.1, 0.1, 1.6, 1.9, 39, 116, '1 cup sliced (116 g)'],
  ['Turnip, cooked', null, 'vegetable', 22, 0.7, 4.6, 0.1, 2, 3, 16, 156, '1 cup cubed (156 g)'],
  ['Artichoke, cooked', null, 'vegetable', 53, 2.9, 9.7, 0.3, 5.7, 1, 60, 120, '1 medium (120 g)'],
  ['Okra, cooked', null, 'vegetable', 22, 1.9, 3.2, 0.2, 3.2, 1.5, 6, 160, '1 cup cooked (160 g)'],
  ['Jalapeno pepper', null, 'vegetable', 29, 0.9, 5.5, 0.4, 2.8, 4.1, 3, 14, '1 pepper (14 g)', ['jalapeño', 'chili pepper']],
  ['Kimchi', null, 'vegetable', 23, 1.7, 2.9, 0.5, 1.6, 1.1, 747, 150, '1 cup (150 g)'],
  ['Sauerkraut', null, 'vegetable', 19, 0.9, 3.6, 0.1, 2.9, 1.8, 661, 142, '1 cup (142 g)'],
  ['Dill pickle', null, 'vegetable', 12, 0.5, 1.8, 0.2, 1.2, 1.2, 1208, 65, '1 medium spear (65 g)', ['pickles', 'gherkin']],

  // ------------------------------------------------------------- nuts_seeds
  ['Almonds', null, 'nuts_seeds', 579, 21.2, 11.3, 49.9, 12.5, 4.4, 1, 28, '1 oz, about 23 nuts (28 g)', ['almond']],
  ['Peanuts, dry roasted', null, 'nuts_seeds', 587, 24.4, 10.5, 49.7, 8.4, 4.2, 6, 28, '1 oz (28 g)', ['peanut']],
  ['Cashews', null, 'nuts_seeds', 553, 18.2, 30.2, 43.8, 3.3, 5.9, 12, 28, '1 oz, about 18 nuts (28 g)'],
  ['Walnuts', null, 'nuts_seeds', 654, 15.2, 13.7, 65.2, 6.7, 2.6, 2, 28, '1 oz, about 14 halves (28 g)'],
  ['Pecans', null, 'nuts_seeds', 691, 9.2, 13.9, 72, 9.6, 4, 0, 28, '1 oz, about 19 halves (28 g)'],
  ['Pistachios', null, 'nuts_seeds', 560, 20.2, 27.2, 45.3, 10.6, 7.7, 1, 28, '1 oz, about 49 nuts (28 g)'],
  ['Macadamia nuts', null, 'nuts_seeds', 718, 7.9, 13.8, 75.8, 8.6, 4.6, 5, 28, '1 oz, about 11 nuts (28 g)'],
  ['Hazelnuts', null, 'nuts_seeds', 628, 15, 16.7, 60.8, 9.7, 4.3, 0, 28, '1 oz, about 21 nuts (28 g)', ['filberts']],
  ['Brazil nuts', null, 'nuts_seeds', 659, 14.3, 12.3, 67.1, 7.5, 2.3, 3, 28, '1 oz, about 6 nuts (28 g)'],
  ['Mixed nuts, roasted', null, 'nuts_seeds', 607, 20, 21, 54, 7, 4.5, 250, 28, '1 oz (28 g)'],
  ['Peanut butter', null, 'nuts_seeds', 588, 25.1, 20, 50.4, 6, 9.2, 17, 32, '2 tbsp (32 g)', ['pb', 'peanutbutter']],
  ['Almond butter', null, 'nuts_seeds', 614, 21, 18.8, 55.5, 10.3, 4.4, 7, 32, '2 tbsp (32 g)'],
  ['Sunflower seed butter', null, 'nuts_seeds', 617, 17.3, 23.3, 55.2, 8, 8, 5, 32, '2 tbsp (32 g)'],
  ['Tahini', null, 'nuts_seeds', 595, 17, 21.2, 53.8, 9.3, 0.5, 115, 15, '1 tbsp (15 g)', ['sesame paste']],
  ['Sunflower seeds', null, 'nuts_seeds', 584, 20.8, 20, 51.5, 8.6, 2.6, 9, 28, '1 oz (28 g)'],
  ['Pumpkin seeds', null, 'nuts_seeds', 559, 30.2, 10.7, 49.1, 6, 1.4, 7, 28, '1 oz (28 g)', ['pepitas']],
  ['Chia seeds', null, 'nuts_seeds', 486, 16.5, 42.1, 30.7, 34.4, 0, 16, 28, '2 tbsp (28 g)'],
  ['Flaxseed, ground', null, 'nuts_seeds', 534, 18.3, 28.9, 42.2, 27.3, 1.5, 30, 14, '2 tbsp (14 g)', ['linseed', 'flax']],
  ['Hemp seeds', null, 'nuts_seeds', 553, 31.6, 8.7, 48.8, 4, 1.5, 5, 30, '3 tbsp (30 g)', ['hemp hearts']],
  ['Trail mix', null, 'nuts_seeds', 462, 13.8, 44.9, 29.4, 5.5, 25, 220, 40, '1/4 cup (40 g)'],

  // -------------------------------------------------------------- fats_oils
  ['Olive oil', null, 'fats_oils', 884, 0, 0, 100, 0, 0, 2, 14, '1 tbsp (14 g)', ['extra virgin olive oil', 'evoo']],
  ['Coconut oil', null, 'fats_oils', 862, 0, 0, 99.1, 0, 0, 0, 14, '1 tbsp (14 g)'],
  ['Canola oil', null, 'fats_oils', 884, 0, 0, 100, 0, 0, 0, 14, '1 tbsp (14 g)', ['rapeseed oil']],
  ['Vegetable oil', null, 'fats_oils', 884, 0, 0, 100, 0, 0, 0, 14, '1 tbsp (14 g)', ['soybean oil']],
  ['Avocado oil', null, 'fats_oils', 884, 0, 0, 100, 0, 0, 0, 14, '1 tbsp (14 g)'],
  ['Sesame oil', null, 'fats_oils', 884, 0, 0, 100, 0, 0, 0, 14, '1 tbsp (14 g)'],
  ['Peanut oil', null, 'fats_oils', 884, 0, 0, 100, 0, 0, 0, 14, '1 tbsp (14 g)'],
  ['Ghee', null, 'fats_oils', 900, 0, 0, 99.8, 0, 0, 2, 14, '1 tbsp (14 g)', ['clarified butter']],
  ['Margarine', null, 'fats_oils', 717, 0.2, 0.7, 80.5, 0, 0, 700, 14, '1 tbsp (14 g)'],
  ['Mayonnaise', null, 'fats_oils', 680, 1, 0.6, 75, 0, 0.6, 635, 14, '1 tbsp (14 g)', ['mayo']],
  ['Mayonnaise, light', null, 'fats_oils', 238, 0.4, 6.7, 22.2, 0, 3.5, 800, 15, '1 tbsp (15 g)', ['light mayo']],
  ['Cooking spray', null, 'fats_oils', 884, 0, 0, 100, 0, 0, 0, 1, '1 second spray (1 g)', ['pam']],

  // -------------------------------------------------------------- beverages
  ['Water', null, 'beverages', 0, 0, 0, 0, 0, 0, 0, 240, '1 cup (240 g)'],
  ['Sparkling water', null, 'beverages', 0, 0, 0, 0, 0, 0, 2, 355, '1 can (355 g)', ['seltzer', 'club soda']],
  ['Coffee, black', null, 'beverages', 0, 0, 0, 0, 0, 0, 2, 240, '1 cup (240 g)', ['coffee', 'americano']],
  ['Espresso', null, 'beverages', 9, 0.1, 1.7, 0.2, 0, 0, 14, 30, '1 shot (30 g)'],
  ['Latte with whole milk', null, 'beverages', 56, 3, 4.4, 2.7, 0, 4.4, 40, 355, '1 medium, 12 oz (355 g)', ['caffe latte']],
  ['Latte with skim milk', null, 'beverages', 32, 3.2, 4.6, 0.2, 0, 4.6, 42, 355, '1 medium, 12 oz (355 g)', ['skinny latte']],
  ['Cappuccino', null, 'beverages', 40, 2.2, 3.2, 1.9, 0, 3.2, 32, 240, '1 small, 8 oz (240 g)'],
  ['Green tea, unsweetened', null, 'beverages', 0, 0, 0, 0, 0, 0, 1, 240, '1 cup (240 g)', ['tea']],
  ['Black tea, unsweetened', null, 'beverages', 0, 0, 0, 0, 0, 0, 3, 240, '1 cup (240 g)'],
  ['Iced tea, sweetened', null, 'beverages', 30, 0, 7.5, 0, 0, 7.4, 7, 355, '1 can (355 g)'],
  ['Cola', null, 'beverages', 42, 0, 10.6, 0, 0, 10.6, 4, 355, '1 can, 12 oz (355 g)', ['coke', 'soda', 'soft drink']],
  ['Diet cola', null, 'beverages', 0, 0, 0, 0, 0, 0, 12, 355, '1 can, 12 oz (355 g)', ['diet coke', 'zero sugar cola']],
  ['Lemon-lime soda', null, 'beverages', 41, 0, 10.4, 0, 0, 10.1, 15, 355, '1 can, 12 oz (355 g)', ['sprite']],
  ['Orange juice', null, 'beverages', 45, 0.7, 10.4, 0.2, 0.2, 8.4, 1, 248, '1 cup (248 g)', ['oj']],
  ['Apple juice', null, 'beverages', 46, 0.1, 11.3, 0.1, 0.2, 9.6, 4, 248, '1 cup (248 g)'],
  ['Lemonade', null, 'beverages', 40, 0.1, 10.2, 0, 0, 9.8, 4, 248, '1 cup (248 g)'],
  ['Coconut water', null, 'beverages', 19, 0.7, 3.7, 0.2, 1.1, 2.6, 105, 240, '1 cup (240 g)'],
  ['Sports drink', null, 'beverages', 26, 0, 6.4, 0, 0, 5.8, 41, 355, '1 bottle (355 g)', ['gatorade', 'powerade']],
  ['Energy drink', null, 'beverages', 45, 0.2, 11.2, 0, 0, 10.6, 40, 250, '1 can (250 g)', ['red bull']],
  ['Kombucha', null, 'beverages', 30, 0.2, 7, 0, 0, 5.5, 10, 240, '1 cup (240 g)'],
  ['Protein shake, ready to drink', null, 'beverages', 42, 6.3, 2.5, 0.6, 0.6, 1, 80, 325, '1 bottle (325 g)', ['protein drink']],
  ['Beer, regular', null, 'beverages', 43, 0.5, 3.6, 0, 0, 0, 4, 355, '1 can, 12 oz (355 g)', ['beer', 'lager']],
  ['Beer, light', null, 'beverages', 29, 0.2, 1.6, 0, 0, 0.1, 4, 355, '1 can, 12 oz (355 g)'],
  ['Wine, red', null, 'beverages', 85, 0.1, 2.6, 0, 0, 0.6, 4, 148, '1 glass, 5 oz (148 g)', ['red wine']],
  ['Wine, white', null, 'beverages', 82, 0.1, 2.6, 0, 0, 1, 5, 148, '1 glass, 5 oz (148 g)', ['white wine']],
  ['Champagne', null, 'beverages', 76, 0.1, 1.6, 0, 0, 0.8, 5, 148, '1 glass, 5 oz (148 g)', ['prosecco', 'sparkling wine']],
  ['Hard seltzer', null, 'beverages', 28, 0, 0.6, 0, 0, 0.6, 3, 355, '1 can, 12 oz (355 g)'],
  ['Vodka', null, 'beverages', 231, 0, 0, 0, 0, 0, 1, 42, '1 shot, 1.5 oz (42 g)', ['spirits', 'liquor']],
  ['Whiskey', null, 'beverages', 250, 0, 0, 0, 0, 0, 1, 42, '1 shot, 1.5 oz (42 g)', ['bourbon', 'scotch']],

  // ----------------------------------------------------------------- snacks
  ['Protein bar', null, 'snacks', 380, 30, 36, 10, 8, 5, 250, 60, '1 bar (60 g)'],
  ['Granola bar', null, 'snacks', 471, 8, 64.4, 20, 4.5, 24, 220, 42, '1 bar (42 g)'],
  ['Potato chips', null, 'snacks', 536, 6.6, 53, 34.6, 4.4, 0.3, 525, 28, '1 oz, about 15 chips (28 g)', ['crisps']],
  ['Tortilla chips', null, 'snacks', 489, 7, 63, 23.4, 4.4, 1.2, 400, 28, '1 oz, about 12 chips (28 g)'],
  ['Popcorn, air-popped', null, 'snacks', 387, 12.9, 77.8, 4.5, 14.5, 0.9, 8, 24, '3 cups popped (24 g)', ['popcorn']],
  ['Popcorn, buttered', null, 'snacks', 500, 8, 57, 27, 9.5, 0.5, 800, 30, '3 cups popped (30 g)'],
  ['Pretzels', null, 'snacks', 384, 10, 80, 3.5, 3, 2.2, 1200, 28, '1 oz (28 g)'],
  ['Saltine crackers', null, 'snacks', 418, 8.7, 72, 10, 2.8, 1.2, 1000, 16, '5 crackers (16 g)'],
  ['Graham crackers', null, 'snacks', 423, 6.7, 77, 10, 2.9, 24, 500, 28, '2 sheets (28 g)'],
  ['Cheese puffs', null, 'snacks', 557, 6.4, 54, 35, 1, 3, 1000, 28, '1 oz (28 g)'],
  ['Dark chocolate, 70%', null, 'snacks', 598, 7.8, 45.9, 42.6, 10.9, 24, 20, 28, '1 oz, about 3 squares (28 g)', ['dark chocolate']],
  ['Milk chocolate', null, 'snacks', 535, 7.6, 59.4, 29.7, 3.4, 51.5, 79, 43, '1 bar (43 g)', ['chocolate']],
  ['Chocolate chip cookie', null, 'snacks', 488, 5.4, 64.4, 24, 2.4, 36, 350, 30, '1 cookie (30 g)', ['cookie']],
  ['Brownie', null, 'snacks', 466, 6, 60, 22, 2.5, 41, 300, 56, '1 square (56 g)'],
  ['Donut, glazed', null, 'snacks', 452, 4.9, 51, 25, 1.5, 23, 373, 60, '1 donut (60 g)', ['doughnut']],
  ['Blueberry muffin', null, 'snacks', 377, 5.5, 51, 17, 1.7, 27, 340, 113, '1 large muffin (113 g)'],
  ['Banana bread', null, 'snacks', 326, 4.3, 54.6, 10.5, 1.5, 30, 302, 60, '1 slice (60 g)'],
  ['Toaster pastry', null, 'snacks', 400, 4, 71, 10, 1.5, 32, 350, 52, '1 pastry (52 g)', ['pop tart']],
  ['Rice crispy treat', null, 'snacks', 400, 2.5, 82, 8, 0.3, 38, 400, 22, '1 bar (22 g)'],
  ['Gummy candy', null, 'snacks', 350, 6.9, 77.4, 0.2, 0, 55, 40, 40, '1 pouch (40 g)', ['gummy bears']],
  ['Fruit snacks', null, 'snacks', 350, 0, 85, 0, 0, 55, 60, 26, '1 pouch (26 g)'],
  ['Ice cream, vanilla', null, 'snacks', 207, 3.5, 23.6, 11, 0.7, 21, 80, 66, '1/2 cup (66 g)', ['ice cream']],
  ['Ice cream, chocolate', null, 'snacks', 216, 3.8, 28.2, 11, 1.2, 25, 76, 66, '1/2 cup (66 g)'],
  ['Frozen yogurt', null, 'snacks', 159, 4, 24.2, 5.6, 0, 24, 87, 87, '1/2 cup (87 g)', ['froyo']],
  ['Cheesecake', null, 'snacks', 321, 5.5, 26, 22, 0.4, 22, 438, 125, '1 slice (125 g)'],
  ['Apple pie', null, 'snacks', 265, 2.4, 37, 12.5, 1.6, 17, 246, 125, '1 slice (125 g)'],

  // ------------------------------------------------------------- condiments
  ['Ketchup', null, 'condiments', 101, 1, 25, 0.1, 0.3, 21.8, 907, 17, '1 tbsp (17 g)', ['catsup']],
  ['Mustard, yellow', null, 'condiments', 66, 3.7, 5.3, 3.4, 3.3, 0.9, 1120, 5, '1 tsp (5 g)', ['mustard']],
  ['Soy sauce', null, 'condiments', 53, 8.1, 4.9, 0.1, 0.8, 0.4, 5493, 16, '1 tbsp (16 g)', ['shoyu']],
  ['Soy sauce, low sodium', null, 'condiments', 53, 8.1, 4.9, 0.1, 0.8, 0.4, 3000, 16, '1 tbsp (16 g)'],
  ['Sriracha', null, 'condiments', 93, 1.5, 19, 0.9, 2.2, 15, 2100, 9, '1 tsp (9 g)', ['rooster sauce']],
  ['Hot sauce', null, 'condiments', 12, 0.5, 1.8, 0.4, 0.6, 1.2, 2600, 5, '1 tsp (5 g)', ['tabasco']],
  ['Barbecue sauce', null, 'condiments', 172, 0.8, 40.8, 0.6, 0.8, 33, 1027, 32, '2 tbsp (32 g)', ['bbq sauce']],
  ['Ranch dressing', null, 'condiments', 430, 1, 6, 45, 0, 4, 1000, 30, '2 tbsp (30 g)', ['ranch']],
  ['Balsamic vinaigrette', null, 'condiments', 350, 0.3, 8, 35, 0, 7, 800, 30, '2 tbsp (30 g)'],
  ['Italian dressing', null, 'condiments', 292, 0.3, 11, 27, 0, 8, 1100, 30, '2 tbsp (30 g)'],
  ['Blue cheese dressing', null, 'condiments', 480, 2, 6, 50, 0, 3, 900, 30, '2 tbsp (30 g)'],
  ['Caesar dressing', null, 'condiments', 460, 2.5, 4.5, 48, 0, 2.5, 1100, 30, '2 tbsp (30 g)'],
  ['Balsamic vinegar', null, 'condiments', 72, 0.5, 17, 0, 0, 15, 23, 16, '1 tbsp (16 g)'],
  ['Salsa', null, 'condiments', 29, 1.5, 5, 0.2, 1.5, 3.3, 430, 32, '2 tbsp (32 g)', ['pico de gallo']],
  ['Salsa verde', null, 'condiments', 36, 1, 6.5, 0.5, 1.5, 4, 460, 32, '2 tbsp (32 g)'],
  ['Guacamole', null, 'condiments', 155, 2, 5, 14, 5, 0.8, 350, 30, '2 tbsp (30 g)'],
  ['Hummus', null, 'condiments', 166, 7.9, 14.3, 9.6, 6, 0.3, 379, 30, '2 tbsp (30 g)'],
  ['Tzatziki', null, 'condiments', 90, 2.5, 4, 7, 0.3, 3, 300, 30, '2 tbsp (30 g)'],
  ['Peanut sauce', null, 'condiments', 300, 8, 20, 20, 2, 14, 600, 30, '2 tbsp (30 g)'],
  ['Marinara sauce', null, 'condiments', 55, 1.6, 8, 1.8, 1.8, 5.5, 400, 125, '1/2 cup (125 g)', ['pasta sauce', 'tomato sauce']],
  ['Honey', null, 'condiments', 304, 0.3, 74, 0, 0.2, 74, 4, 21, '1 tbsp (21 g)'],
  ['Maple syrup', null, 'condiments', 260, 0, 64, 0, 0, 60, 12, 20, '1 tbsp (20 g)'],
  ['Sugar, granulated', null, 'condiments', 387, 0, 96, 0, 0, 96, 1, 4, '1 tsp (4 g)', ['white sugar']],
  ['Brown sugar', null, 'condiments', 380, 0, 94, 0, 0, 94, 28, 4, '1 tsp (4 g)'],
  ['Strawberry jam', null, 'condiments', 278, 0.4, 68, 0.1, 1, 49, 32, 20, '1 tbsp (20 g)', ['jelly', 'preserves']],
  ['Nutritional yeast', null, 'condiments', 385, 50, 36, 5, 20, 0, 30, 8, '2 tbsp (8 g)'],
  ['Salt', null, 'condiments', 0, 0, 0, 0, 0, 0, 38758, 6, '1 tsp (6 g)', ['table salt']],
  ['Black pepper, ground', null, 'condiments', 251, 10.4, 45, 3.3, 25.3, 0.6, 20, 2, '1 tsp (2 g)'],

  // --------------------------------------------------------------- prepared
  ['Pizza, cheese', null, 'prepared', 266, 11, 33, 10, 2.3, 3.6, 598, 107, '1 slice (107 g)', ['pizza']],
  ['Pizza, pepperoni', null, 'prepared', 296, 13, 31, 13, 2.3, 3.6, 700, 111, '1 slice (111 g)'],
  ['Cheeseburger, fast food', null, 'prepared', 275, 15, 25, 13, 1.5, 5, 620, 154, '1 burger (154 g)', ['cheese burger']],
  ['Hamburger, fast food', null, 'prepared', 254, 13.5, 29, 9.5, 1.5, 6, 500, 110, '1 burger (110 g)', ['burger']],
  ['French fries, fast food', null, 'prepared', 312, 3.4, 41, 15, 3.8, 0.3, 210, 117, '1 medium order (117 g)', ['fries', 'chips']],
  ['Chicken nuggets', null, 'prepared', 296, 15.5, 18, 18, 1, 0.3, 557, 96, '6 pieces (96 g)'],
  ['Grilled chicken sandwich', null, 'prepared', 205, 16, 22, 5.5, 1.5, 4, 700, 180, '1 sandwich (180 g)'],
  ['Turkey sandwich on wheat', null, 'prepared', 220, 13, 28, 6, 3, 4, 800, 200, '1 sandwich (200 g)'],
  ['Peanut butter and jelly sandwich', null, 'prepared', 330, 10.5, 46, 12, 3, 18, 450, 100, '1 sandwich (100 g)', ['pbj']],
  ['Egg and cheese breakfast sandwich', null, 'prepared', 250, 12, 24, 11.5, 1.2, 3, 750, 150, '1 sandwich (150 g)'],
  ['Burrito bowl with chicken', null, 'prepared', 145, 10, 15, 4.5, 3, 1.5, 400, 400, '1 bowl (400 g)'],
  ['Chicken burrito', null, 'prepared', 200, 10.5, 24, 6.5, 2.5, 1.5, 450, 350, '1 burrito (350 g)', ['burrito']],
  ['Beef taco', null, 'prepared', 217, 10, 20, 11, 2.5, 1.5, 400, 102, '1 taco (102 g)', ['tacos']],
  ['Cheese quesadilla', null, 'prepared', 300, 13, 25, 16, 1.8, 2, 650, 150, '1 quesadilla (150 g)'],
  ['Sushi roll, California', null, 'prepared', 150, 4.5, 25, 3.5, 1.5, 4, 400, 170, '1 roll, 6 pieces (170 g)', ['california roll', 'sushi']],
  ['Salmon nigiri', null, 'prepared', 160, 8, 24, 3, 0.5, 3, 220, 100, '4 pieces (100 g)'],
  ['Pad thai', null, 'prepared', 190, 8, 25, 6.5, 1.8, 7, 700, 300, '1 plate (300 g)'],
  ['Fried rice with chicken', null, 'prepared', 163, 7, 21, 5.5, 1.2, 1.5, 500, 200, '1 cup (200 g)'],
  ['Chicken stir fry with vegetables', null, 'prepared', 120, 11, 8, 4.5, 2, 3.5, 480, 250, '1 plate (250 g)'],
  ['Ramen, restaurant style', null, 'prepared', 90, 5, 10, 3.3, 0.8, 1, 700, 500, '1 bowl (500 g)'],
  ['Mac and cheese', null, 'prepared', 164, 6.5, 20, 6.4, 1, 3.5, 480, 200, '1 cup (200 g)', ['macaroni and cheese']],
  ['Spaghetti with marinara', null, 'prepared', 130, 4.4, 21, 2.9, 2, 4.5, 350, 250, '1 cup (250 g)'],
  ['Lasagna', null, 'prepared', 132, 8, 11.5, 5.5, 1.2, 3.5, 400, 250, '1 piece (250 g)'],
  ['Chili con carne', null, 'prepared', 110, 8, 9.5, 4.2, 2.6, 2, 450, 250, '1 cup (250 g)', ['chili']],
  ['Chicken noodle soup', null, 'prepared', 40, 2.6, 4.5, 1.2, 0.4, 0.6, 340, 245, '1 cup (245 g)'],
  ['Tomato soup', null, 'prepared', 65, 1.8, 11.5, 1.5, 1, 6, 460, 245, '1 cup (245 g)'],
  ['Caesar salad with chicken', null, 'prepared', 145, 9.5, 4.5, 10, 1.2, 1.5, 400, 300, '1 entree salad (300 g)'],
  ['Caesar salad', null, 'prepared', 178, 4.5, 6, 15, 1.5, 1.5, 380, 200, '1 side salad (200 g)'],
  ['Greek salad', null, 'prepared', 110, 3.5, 6, 8, 1.8, 3.5, 400, 250, '1 bowl (250 g)'],
  ['Falafel', null, 'prepared', 333, 13.3, 31.8, 17.8, 4.9, 0.5, 294, 51, '3 patties (51 g)'],
  ['Coleslaw', null, 'prepared', 152, 1.2, 14.4, 10.2, 1.7, 11, 220, 120, '1 cup (120 g)'],
  ['Egg roll, vegetable', null, 'prepared', 220, 6, 27, 9.5, 2, 3, 480, 89, '1 roll (89 g)', ['spring roll']],

  // ------------------------------------------------------------ supplements
  ['Whey protein isolate powder', null, 'supplements', 370, 86, 4, 1, 0, 2, 300, 30, '1 scoop (30 g)', ['whey isolate', 'protein powder']],
  ['Whey protein concentrate powder', null, 'supplements', 400, 75, 10, 5.5, 1, 5, 280, 31, '1 scoop (31 g)', ['whey protein']],
  ['Casein protein powder', null, 'supplements', 365, 80, 7, 1.5, 1, 3, 400, 33, '1 scoop (33 g)', ['casein']],
  ['Plant protein powder', null, 'supplements', 380, 75, 10, 5, 4, 2, 350, 33, '1 scoop (33 g)', ['pea protein', 'vegan protein']],
  ['Collagen peptides', null, 'supplements', 360, 90, 0, 0, 0, 0, 130, 20, '2 scoops (20 g)', ['collagen']],
  ['Mass gainer powder', null, 'supplements', 380, 20, 68, 4, 3, 20, 300, 165, '2 scoops (165 g)', ['weight gainer']],
  ['Creatine monohydrate', null, 'supplements', 0, 0, 0, 0, 0, 0, 0, 5, '1 scoop (5 g)', ['creatine']],
  ['Pre-workout powder', null, 'supplements', 0, 0, 0, 0, 0, 0, 150, 10, '1 scoop (10 g)', ['preworkout']],
  ['BCAA powder', null, 'supplements', 0, 0, 0, 0, 0, 0, 100, 10, '1 scoop (10 g)', ['bcaa', 'eaa']],
  ['Fish oil capsule', null, 'supplements', 900, 0, 0, 100, 0, 0, 0, 1, '1 capsule (1 g)', ['omega 3']],
  ['Meal replacement shake', null, 'supplements', 100, 8, 12, 2.5, 1.5, 6, 150, 325, '1 bottle (325 g)'],
  ['Greens powder', null, 'supplements', 300, 25, 40, 3, 15, 5, 200, 10, '1 scoop (10 g)'],
];

function rowToSeed(row: SeedRow): SeedFood {
  const [
    name,
    brand,
    category,
    calories,
    protein,
    carbs,
    fat,
    fiber,
    sugar,
    sodium,
    servingSizeG,
    servingLabel,
    aliases,
  ] = row;

  const seed: SeedFood = {
    name,
    brand,
    per100g: { calories, protein, carbs, fat, fiber, sugar, sodium },
    servingSizeG,
    servingLabel,
    category,
    barcode: null,
  };
  if (aliases && aliases.length > 0) seed.aliases = [...aliases];
  return seed;
}

export const SEED_FOODS: SeedFood[] = ROWS.map(rowToSeed);

/** Foods surfaced when the search box is empty. */
export const POPULAR_SEED_NAMES: readonly string[] = [
  'Chicken breast, cooked',
  'Egg, whole, raw',
  'Greek yogurt, plain nonfat',
  'Oats, rolled, dry',
  'Banana',
  'Apple',
  'White rice, cooked',
  'Brown rice, cooked',
  'Ground beef, 85% lean, cooked',
  'Salmon, Atlantic, cooked',
  'Whole wheat bread',
  'Peanut butter',
  'Almonds',
  'Milk, 2%',
  'Cheddar cheese',
  'Broccoli, raw',
  'Sweet potato, baked',
  'Avocado',
  'Olive oil',
  'Whey protein isolate powder',
  'Pasta, cooked',
  'Tuna, canned in water',
  'Cottage cheese, 2%',
  'Black beans, cooked',
  'Coffee, black',
];

/** Number of seed foods per category, useful for browse screens. */
export function countSeedFoodsByCategory(): Record<FoodCategory, number> {
  const counts = {} as Record<FoodCategory, number>;
  for (const category of FOOD_CATEGORIES) counts[category] = 0;
  for (const food of SEED_FOODS) counts[food.category] += 1;
  return counts;
}

export function getSeedFoodsByCategory(category: FoodCategory): SeedFood[] {
  return SEED_FOODS.filter((f) => f.category === category);
}

/**
 * Convert a seed record into the shape repositories expect when inserting a
 * `Food` row. Ids and timestamps are assigned by the repository layer.
 */
export function seedFoodToFoodInput(f: SeedFood): Partial<Food> & { name: string; per100g: Macros } {
  return {
    name: f.name,
    brand: f.brand,
    per100g: { ...f.per100g },
    servingSizeG: f.servingSizeG,
    servingLabel: f.servingLabel,
    barcode: f.barcode ?? null,
    source: 'seed',
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
  };
}
