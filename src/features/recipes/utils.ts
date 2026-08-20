import type { ISODate, MealType, Recipe, RecipeItem } from '@/types';
import { MEAL_TYPES } from '@/types/constants';
import { todayISO, roundTo, formatEnergy, formatMacroG, isValidISODate } from '@/domain';

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeDateParam(value: string | string[] | undefined): ISODate | null {
  // A timestamp is still a usable day, but the day itself must be real:
  // `2026-02-31` has the right shape and names no date the diary can reach.
  const candidate = firstParam(value)?.trim().slice(0, 10) ?? '';
  return isValidISODate(candidate) ? candidate : null;
}

export function normalizeMealParam(value: string | string[] | undefined): MealType | null {
  const raw = firstParam(value);
  return raw && (MEAL_TYPES as readonly string[]).includes(raw) ? (raw as MealType) : null;
}

export function defaultLogDate(date?: ISODate | null): ISODate {
  return date ?? todayISO();
}

export function safeServings(value: number | null | undefined, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function recipeLogFactor(recipe: Recipe, servings: number): number {
  const positiveServings = safeServings(servings, 0);
  if (positiveServings <= 0) return 0;
  return recipe.kind === 'recipe' ? positiveServings / safeServings(recipe.servings) : positiveServings;
}

export function recipeKindLabel(recipe: Pick<Recipe, 'kind' | 'servings'>): string {
  return recipe.kind === 'meal'
    ? 'Saved meal · logs as one usual meal'
    : `Recipe · ${safeServings(recipe.servings)} servings`;
}

export function recipeSummaryLine(recipe: Recipe): string {
  const itemCount = recipe.items.length;
  const count = `${itemCount} ingredient${itemCount === 1 ? '' : 's'}`;
  const logged = recipe.timesLogged > 0 ? ` · logged ${recipe.timesLogged}x` : '';
  return `${recipeKindLabel(recipe)} · ${count}${logged}`;
}

export function macroSummary(macros: { calories: number; protein: number; carbs: number; fat: number }): string {
  return `${formatEnergy(roundTo(macros.calories, 0))} · P ${formatMacroG(macros.protein)} · C ${formatMacroG(macros.carbs)} · F ${formatMacroG(macros.fat)}`;
}

export function sortedRecipeItems<T extends Pick<RecipeItem, 'sortOrder' | 'id'>>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
