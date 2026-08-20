import type { Macros, RecipeItem } from '@/types';
import { emptyMacros, sumMacros } from './nutrition';
import { roundTo, toFiniteNumber } from './units';

function nonNegative(value: unknown): number {
  return Math.max(0, toFiniteNumber(value));
}

function safeFactor(value: unknown): number {
  return nonNegative(value);
}

function scaleMacrosSafe(macros: Macros, factor: number): Macros {
  const scaled: Macros = {
    calories: roundTo(nonNegative(macros?.calories) * factor, 2),
    protein: roundTo(nonNegative(macros?.protein) * factor, 2),
    carbs: roundTo(nonNegative(macros?.carbs) * factor, 2),
    fat: roundTo(nonNegative(macros?.fat) * factor, 2),
  };
  if (macros?.fiber !== undefined) scaled.fiber = roundTo(nonNegative(macros.fiber) * factor, 2);
  if (macros?.sugar !== undefined) scaled.sugar = roundTo(nonNegative(macros.sugar) * factor, 2);
  if (macros?.sodium !== undefined) scaled.sodium = roundTo(nonNegative(macros.sodium) * factor, 2);
  return scaled;
}

export function recipeTotals(
  items: Array<Pick<RecipeItem, 'macros' | 'gramsTotal'>>
): { macros: Macros; grams: number } {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  return {
    macros: sumMacros(safeItems.map((item) => item.macros ?? emptyMacros())),
    grams: roundTo(
      safeItems.reduce((sum, item) => sum + nonNegative(item.gramsTotal), 0),
      2
    ),
  };
}

export function perServing(
  totals: Macros,
  grams: number,
  servings: number
): { macros: Macros; grams: number } {
  const divisor = nonNegative(servings);
  if (divisor <= 0) return { macros: emptyMacros(), grams: 0 };
  return {
    macros: scaleMacrosSafe(totals ?? emptyMacros(), 1 / divisor),
    grams: roundTo(nonNegative(grams) / divisor, 2),
  };
}

export function scaleRecipeItems(items: RecipeItem[], factor: number): RecipeItem[] {
  const scale = safeFactor(factor);
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    quantity: roundTo(nonNegative(item.quantity) * scale, 2),
    gramsTotal: roundTo(nonNegative(item.gramsTotal) * scale, 2),
    macros: scaleMacrosSafe(item.macros ?? emptyMacros(), scale),
  }));
}
