/**
 * Unit conversion + formatting helpers.
 *
 * Pure TypeScript: no React Native, no Expo, no I/O. Safe to run in plain Node.
 * Every helper is NaN / Infinity safe — invalid input degrades to a sane
 * fallback instead of poisoning downstream math with `NaN`.
 */
import { CM_PER_IN, KG_PER_LB } from '@/types/constants';
import type { HeightUnit, WeightUnit } from '@/types';

/** Grams in one ounce (international avoirdupois). */
export const G_PER_OZ = 28.349523125;

/** Kilojoules in one kilocalorie. */
export const KJ_PER_KCAL = 4.184;

/**
 * Coerce anything into a finite number.
 * `NaN`, `Infinity`, `null`, `undefined` and non-numeric strings become `fallback`.
 */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Round `n` to `dp` decimal places (half away from zero, float-noise tolerant). */
export function roundTo(n: number, dp = 0): number {
  const value = toFiniteNumber(n);
  const places = Math.max(0, Math.min(15, Math.trunc(toFiniteNumber(dp))));
  const factor = 10 ** places;
  const scaled = value * factor;
  const nudged = scaled + (scaled >= 0 ? 1e-9 : -1e-9);
  const out = Math.round(nudged) / factor;
  return Object.is(out, -0) ? 0 : out;
}

/** Constrain `n` to the inclusive `[min, max]` range. Swapped bounds are tolerated. */
export function clamp(n: number, min: number, max: number): number {
  const value = toFiniteNumber(n);
  const lo = toFiniteNumber(min, Number.NEGATIVE_INFINITY);
  const hi = toFiniteNumber(max, Number.POSITIVE_INFINITY);
  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);
  if (value < low) return low;
  if (value > high) return high;
  return Object.is(value, -0) ? 0 : value;
}

export function kgToLb(n: number): number {
  return toFiniteNumber(n) / KG_PER_LB;
}

export function lbToKg(n: number): number {
  return toFiniteNumber(n) * KG_PER_LB;
}

export function cmToInches(n: number): number {
  return toFiniteNumber(n) / CM_PER_IN;
}

export function inchesToCm(n: number): number {
  return toFiniteNumber(n) * CM_PER_IN;
}

export function ftInToCm(feet: number, inches: number): number {
  const totalInches = toFiniteNumber(feet) * 12 + toFiniteNumber(inches);
  return inchesToCm(totalInches);
}

/** Split centimetres into whole feet + whole inches (inches rounded, carrying at 12). */
export function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalInches = Math.round(cmToInches(cm));
  let ft = Math.trunc(totalInches / 12);
  let inches = totalInches - ft * 12;
  if (inches >= 12) {
    ft += 1;
    inches -= 12;
  }
  return { ft, in: inches };
}

/** Convert canonical kilograms into the user's display unit. */
export function toDisplayWeight(kg: number, u: WeightUnit): number {
  return u === 'lb' ? kgToLb(kg) : toFiniteNumber(kg);
}

/** Convert a value typed by the user (in their unit) back to canonical kilograms. */
export function fromDisplayWeight(v: number, u: WeightUnit): number {
  return u === 'lb' ? lbToKg(v) : toFiniteNumber(v);
}

/** e.g. `formatWeight(75, 'lb')` -> `"165.3 lb"`. */
export function formatWeight(kg: number, u: WeightUnit, decimals = 1): string {
  const dp = Math.max(0, Math.min(6, Math.trunc(toFiniteNumber(decimals))));
  const value = roundTo(toDisplayWeight(kg, u), dp);
  return `${value.toFixed(dp)} ${u}`;
}

/** e.g. `formatHeight(180, 'ft_in')` -> `5'11"`, `formatHeight(180, 'cm')` -> `"180 cm"`. */
export function formatHeight(cm: number, u: HeightUnit): string {
  if (u === 'ft_in') {
    const { ft, in: inches } = cmToFtIn(cm);
    return `${ft}'${inches}"`;
  }
  return `${Math.round(toFiniteNumber(cm))} cm`;
}

export function gToOz(n: number): number {
  return toFiniteNumber(n) / G_PER_OZ;
}

export function ozToG(n: number): number {
  return toFiniteNumber(n) * G_PER_OZ;
}

/** Insert thousands separators without relying on `Intl` (deterministic across runtimes). */
function withThousands(n: number): string {
  const rounded = Math.round(toFiniteNumber(n));
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** e.g. `formatEnergy(1850)` -> `"1,850 kcal"`. */
export function formatEnergy(kcal: number, u: 'kcal' | 'kJ' = 'kcal'): string {
  const value = u === 'kJ' ? toFiniteNumber(kcal) * KJ_PER_KCAL : toFiniteNumber(kcal);
  return `${withThousands(value)} ${u}`;
}

/** e.g. `formatMacroG(25)` -> `"25 g"`, `formatMacroG(25.44)` -> `"25.4 g"`. */
export function formatMacroG(g: number): string {
  const value = roundTo(toFiniteNumber(g), 1);
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${text} g`;
}
