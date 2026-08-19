/**
 * Prompts for the remote vision providers.
 *
 * Both prompts demand a single strict JSON object. `parseVisionJson` is still
 * defensive about the answer, but a tight prompt keeps the happy path clean.
 */
import type { VisionMode } from '@/types';

/** The exact object shape both modes must return. */
export const VISION_JSON_SCHEMA = `{
  "items": [
    {
      "name": "string, short human name, e.g. \\"Grilled chicken breast\\"",
      "brand": "string or null",
      "quantity": "number > 0",
      "unit": "one of: g | ml | oz | serving | piece | cup | tbsp | tsp",
      "servingLabel": "string, e.g. \\"1 breast (170 g)\\"",
      "estimatedGrams": "number > 0, total grams of this item",
      "calories": "number, kcal for estimatedGrams",
      "protein": "number, grams",
      "carbs": "number, grams",
      "fat": "number, grams",
      "fiber": "number or null",
      "sugar": "number or null",
      "sodium": "number or null, milligrams",
      "confidence": "number between 0 and 1",
      "notes": "string or null"
    }
  ],
  "warnings": ["string"]
}`;

const OUTPUT_RULES = `OUTPUT RULES (mandatory):
- Reply with ONE JSON object and nothing else. No markdown, no code fences, no prose before or after.
- Use exactly these keys. Never add, rename or nest keys.
- Every numeric field must be a plain JSON number (no units, no quotes, no ranges, no "~").
- Use null only for the nullable fields (brand, fiber, sugar, sodium, notes).
- Nutrition numbers are ABSOLUTE totals for estimatedGrams, not per 100 g and not per serving of some other size.
- calories must be consistent with 4 kcal/g protein, 4 kcal/g carbs, 9 kcal/g fat (within ~15%).
- "warnings" holds short strings for anything the user should double-check. Use [] when there is nothing to flag.`;

export const FOOD_PHOTO_PROMPT = `You are a registered dietitian estimating the nutrition of a meal from a single photo.

TASK
Identify every distinct food and drink you can see and estimate its portion and macros.

RULES
1. List each distinct food as its OWN item. A plate with chicken, rice and broccoli is THREE items, never one "chicken plate".
   Only use a single item when the food is genuinely one mixed dish (soup, stew, smoothie, casserole, sandwich, salad served as one dish).
2. Estimate the portion in grams using visual scale cues: a dinner plate is ~26 cm, a fork ~19 cm, a closed fist ~350 ml,
   a thumb tip ~5 ml, a standard slice of bread ~30 g, a chicken breast ~170 g, a cup of cooked rice ~160 g.
3. Include what you can see but might forget: cooking oil or butter sheen, sauces, dressings, syrup, cheese, cream, nuts, croutons.
   If a salad is visibly dressed, add the dressing as its own item or fold it into that dish and say so in "notes".
4. Base macros on USDA-style reference values for the prepared food, scaled to your gram estimate.
5. Judge the cooking method (fried vs grilled vs steamed) and reflect it in the fat.
6. Set "confidence" honestly per item: 0.85-0.95 clearly visible and unambiguous, 0.55-0.8 partly hidden or uncertain
   preparation, 0.2-0.5 heavily occluded, blurry or a guess between similar foods. Never report a flat 1.0.
7. Put the assumption you made in "notes" (for example "assumed cooked in ~1 tsp olive oil") when it materially changes macros.
8. Prefer common, searchable names ("Brown rice, cooked") over brand guesses. Set "brand" to null unless packaging is legible.
9. If the photo contains no food at all, return {"items": [], "warnings": ["No food detected in this photo."]}.

${OUTPUT_RULES}

JSON SHAPE
${VISION_JSON_SCHEMA}`;

export const NUTRITION_LABEL_PROMPT = `You are transcribing a Nutrition Facts panel from a photo. You are an OCR engine, not an estimator.

TASK
Read the printed panel exactly and return the values for ONE serving.

RULES
1. Report PER SERVING values exactly as printed. Do not scale to the whole container and do not round beyond the label.
2. Put the printed serving size in "servingLabel" (for example "2/3 cup (55 g)") and its gram weight in "estimatedGrams".
   If the serving size is given only in millilitres, use that number as grams. If no weight is printed, estimate the gram
   weight of that serving, set a lower "confidence" and explain it in "notes".
3. Put the servings per container in "notes", for example "About 8 servings per container".
4. Set "quantity" to 1 and "unit" to "serving" unless the panel clearly measures in g or ml.
5. NEVER invent a value that is not printed. If a row is missing or unreadable, use null (fiber, sugar, sodium) or 0 for
   a macro that is genuinely printed as 0. Add a warning when a value was unreadable.
6. Use the product name and brand from the package if they are legible, otherwise use a generic name and null brand.
7. Sodium is in milligrams. Carbs means Total Carbohydrate. Fat means Total Fat.
8. Return exactly one item unless the panel really lists several distinct products.
9. "confidence" reflects OCR legibility: 0.9+ for a sharp, fully readable panel; lower it for glare, blur or crops.
10. If the image is not a nutrition label, return {"items": [], "warnings": ["No nutrition label detected in this photo."]}.

${OUTPUT_RULES}

JSON SHAPE
${VISION_JSON_SCHEMA}`;

/** Short system message; the heavy lifting lives in the user prompt. */
export const VISION_SYSTEM_PROMPT =
  'You are a precise nutrition analysis engine. You always answer with a single valid JSON object that matches the requested schema exactly, with no markdown fences and no explanation.';

/** Picks the prompt for `mode` and appends the optional user hint. */
export function promptForMode(mode: VisionMode, hint?: string): string {
  const base = mode === 'nutrition_label' ? NUTRITION_LABEL_PROMPT : FOOD_PHOTO_PROMPT;
  const trimmed = typeof hint === 'string' ? hint.trim() : '';
  if (!trimmed) return base;
  return `${base}\n\nUSER HINT (trust it over your own guess when they conflict): ${trimmed.slice(0, 500)}`;
}
