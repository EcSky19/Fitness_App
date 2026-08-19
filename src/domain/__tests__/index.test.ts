/**
 * Guards the public surface of `@/domain`. Screens and stores import from the
 * barrel, so an accidentally dropped re-export must fail loudly here.
 */
import * as domain from '../index';

const FUNCTIONS = [
  // nutrition
  'calcAge',
  'calcBMR',
  'calcTDEE',
  'emptyMacros',
  'sumMacros',
  'scaleMacros',
  'macrosToCalories',
  'inferCalories',
  'normalizeMacros',
  'buildDailySummary',
  // goals
  'calcCalorieTarget',
  'calcMacroTargets',
  'buildTargetsForProfile',
  'suggestRateKgPerWeek',
  'rateBounds',
  'describeGoal',
  // units
  'kgToLb',
  'lbToKg',
  'cmToInches',
  'inchesToCm',
  'ftInToCm',
  'cmToFtIn',
  'toDisplayWeight',
  'fromDisplayWeight',
  'formatWeight',
  'formatHeight',
  'gToOz',
  'ozToG',
  'formatEnergy',
  'formatMacroG',
  'roundTo',
  'clamp',
  // weight
  'computeEMA',
  'weightTrend',
  'projectGoalDate',
  'goalProgressPct',
  'bmi',
  'bmiCategory',
  // exercise
  'calcCaloriesBurned',
  'findActivity',
  'searchActivities',
  // dates
  'todayISO',
  'toISO',
  'isoToDate',
  'addDaysISO',
  'diffDaysISO',
  'formatDateLabel',
  'formatDateShort',
  'rangeISO',
  'startOfWeekISO',
  'lastNDaysISO',
  'isFutureISO',
] as const;

describe('domain barrel', () => {
  it.each(FUNCTIONS)('exports %s as a function', (name) => {
    expect(typeof (domain as Record<string, unknown>)[name]).toBe('function');
  });

  it('exports the data tables', () => {
    expect(Array.isArray(domain.MET_ACTIVITIES)).toBe(true);
    expect(typeof domain.MACRO_SPLITS).toBe('object');
  });

  it('is importable without any React Native or Expo runtime', () => {
    // Nothing in the engine may reach for a native module at import time.
    expect(domain.calcTDEE(domain.calcBMR({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 }), 'moderate')).toBe(2759);
  });
});
