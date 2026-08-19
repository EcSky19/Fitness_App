/**
 * Display-side weight formatting. Values arrive in KG and are converted here,
 * never in the hooks.
 */
import { formatWeight, roundTo, toDisplayWeight } from '@/domain';
import type { WeightUnit } from '@/types';

export const EM_DASH = '\u2014';

export function unitLabel(unit: WeightUnit): string {
  return unit === 'lb' ? 'lb' : 'kg';
}

/** Converts kg into the display unit without formatting it. */
export function displayValue(
  weightKg: number | null | undefined,
  unit: WeightUnit,
  decimals = 1
): number | null {
  if (weightKg == null || !Number.isFinite(weightKg)) return null;
  const converted = toDisplayWeight(weightKg, unit);
  return Number.isFinite(converted) ? roundTo(converted, decimals) : null;
}

/** `70.4 kg`, or an em dash when there is nothing to show. */
export function formatKg(
  weightKg: number | null | undefined,
  unit: WeightUnit,
  decimals = 1
): string {
  if (weightKg == null || !Number.isFinite(weightKg)) return EM_DASH;
  const formatted = formatWeight(weightKg, unit, decimals);
  if (typeof formatted === 'string' && formatted.length > 0) return formatted;
  const value = displayValue(weightKg, unit, decimals);
  return value == null ? EM_DASH : `${value.toFixed(decimals)} ${unitLabel(unit)}`;
}

/** Signed change, e.g. `-0.4 kg` / `+1.2 lb`. */
export function formatDelta(
  deltaKg: number | null | undefined,
  unit: WeightUnit,
  decimals = 1
): string {
  if (deltaKg == null || !Number.isFinite(deltaKg)) return EM_DASH;
  const magnitude = formatKg(Math.abs(deltaKg), unit, decimals);
  if (magnitude === EM_DASH) return EM_DASH;
  const value = displayValue(Math.abs(deltaKg), unit, decimals) ?? 0;
  if (value === 0) return `0 ${unitLabel(unit)}`;
  return `${deltaKg < 0 ? '-' : '+'}${magnitude}`;
}

/** Signed weekly rate, e.g. `-0.5 kg/wk`. */
export function formatRate(
  ratePerWeekKg: number | null | undefined,
  unit: WeightUnit,
  decimals = 2
): string {
  if (ratePerWeekKg == null || !Number.isFinite(ratePerWeekKg)) return EM_DASH;
  return `${formatDelta(ratePerWeekKg, unit, decimals)}/wk`;
}

/** Arrow glyph for a change; empty string when flat/unknown. */
export function deltaArrow(deltaKg: number | null | undefined, epsilon = 0.05): string {
  if (deltaKg == null || !Number.isFinite(deltaKg) || Math.abs(deltaKg) < epsilon) return '';
  return deltaKg < 0 ? '\u2193' : '\u2191';
}
