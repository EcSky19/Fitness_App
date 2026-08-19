import {
  clamp,
  cmToFtIn,
  cmToInches,
  formatEnergy,
  formatHeight,
  formatMacroG,
  formatWeight,
  fromDisplayWeight,
  ftInToCm,
  gToOz,
  inchesToCm,
  kgToLb,
  lbToKg,
  ozToG,
  roundTo,
  toDisplayWeight,
  toFiniteNumber,
} from '../units';

describe('units — weight conversion', () => {
  it('converts kg to lb with the exact NIST factor', () => {
    expect(kgToLb(1)).toBeCloseTo(2.20462262, 6);
    expect(kgToLb(75)).toBeCloseTo(165.3467, 3);
  });

  it('converts lb to kg', () => {
    expect(lbToKg(1)).toBeCloseTo(0.45359237, 8);
    expect(lbToKg(165)).toBeCloseTo(74.8427, 3);
  });

  it('round-trips kg -> lb -> kg', () => {
    for (const kg of [0, 0.5, 45.36, 72.5, 120, 250]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 10);
    }
  });

  it('round-trips lb -> kg -> lb', () => {
    for (const lb of [1, 100, 165.3, 300]) {
      expect(kgToLb(lbToKg(lb))).toBeCloseTo(lb, 10);
    }
  });
});

describe('units — height conversion', () => {
  it('converts cm to inches and back', () => {
    expect(cmToInches(2.54)).toBeCloseTo(1, 10);
    expect(inchesToCm(1)).toBeCloseTo(2.54, 10);
    for (const cm of [0, 150, 165.5, 180, 200]) {
      expect(inchesToCm(cmToInches(cm))).toBeCloseTo(cm, 10);
    }
  });

  it('converts feet + inches to cm', () => {
    expect(ftInToCm(5, 11)).toBeCloseTo(180.34, 10);
    expect(ftInToCm(6, 0)).toBeCloseTo(182.88, 10);
    expect(ftInToCm(0, 0)).toBe(0);
  });

  it('splits cm into ft/in and carries at 12 inches', () => {
    expect(cmToFtIn(180)).toEqual({ ft: 5, in: 11 });
    expect(cmToFtIn(182.88)).toEqual({ ft: 6, in: 0 });
    // 71.6" rounds to 72" which must carry into 6'0" rather than 5'12".
    expect(cmToFtIn(181.9)).toEqual({ ft: 6, in: 0 });
    expect(cmToFtIn(0)).toEqual({ ft: 0, in: 0 });
  });

  it('round-trips ft/in -> cm -> ft/in', () => {
    for (const [ft, inches] of [
      [5, 0],
      [5, 7],
      [5, 11],
      [6, 3],
    ]) {
      expect(cmToFtIn(ftInToCm(ft, inches))).toEqual({ ft, in: inches });
    }
  });
});

describe('units — display helpers', () => {
  it('maps canonical kg into the display unit and back', () => {
    expect(toDisplayWeight(75, 'kg')).toBe(75);
    expect(toDisplayWeight(75, 'lb')).toBeCloseTo(165.3467, 3);
    expect(fromDisplayWeight(165.3467, 'lb')).toBeCloseTo(75, 3);
    expect(fromDisplayWeight(75, 'kg')).toBe(75);
    expect(fromDisplayWeight(toDisplayWeight(82.4, 'lb'), 'lb')).toBeCloseTo(82.4, 10);
  });

  it('formats weight', () => {
    expect(formatWeight(75, 'lb')).toBe('165.3 lb');
    expect(formatWeight(75, 'kg')).toBe('75.0 kg');
    expect(formatWeight(75, 'kg', 0)).toBe('75 kg');
    expect(formatWeight(75.456, 'kg', 2)).toBe('75.46 kg');
  });

  it('formats height', () => {
    expect(formatHeight(180, 'ft_in')).toBe('5\'11"');
    expect(formatHeight(180, 'cm')).toBe('180 cm');
    expect(formatHeight(165.4, 'cm')).toBe('165 cm');
  });

  it('formats energy with thousands separators', () => {
    expect(formatEnergy(1850)).toBe('1,850 kcal');
    expect(formatEnergy(950)).toBe('950 kcal');
    expect(formatEnergy(0)).toBe('0 kcal');
    expect(formatEnergy(1000, 'kJ')).toBe('4,184 kJ');
  });

  it('formats macro grams', () => {
    expect(formatMacroG(25)).toBe('25 g');
    expect(formatMacroG(25.44)).toBe('25.4 g');
    expect(formatMacroG(0)).toBe('0 g');
  });
});

describe('units — mass conversion', () => {
  it('converts grams and ounces', () => {
    expect(ozToG(1)).toBeCloseTo(28.349523125, 9);
    expect(gToOz(100)).toBeCloseTo(3.5274, 4);
    for (const g of [0, 28.35, 100, 453.6]) {
      expect(ozToG(gToOz(g))).toBeCloseTo(g, 10);
    }
  });
});

describe('units — numeric primitives', () => {
  it('rounds to a decimal place, half away from zero', () => {
    expect(roundTo(2.345, 2)).toBe(2.35);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.5)).toBe(3);
    expect(roundTo(-2.5)).toBe(-3);
    expect(roundTo(1234.5678, 1)).toBe(1234.6);
    expect(roundTo(10, 2)).toBe(10);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundTo(-0.0001, 2), 0)).toBe(true);
  });

  it('clamps, tolerating swapped bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(30, 0, 10)).toBe(10);
    expect(clamp(5, 10, 0)).toBe(5);
  });

  it('is NaN / Infinity safe everywhere', () => {
    expect(toFiniteNumber(Number.NaN)).toBe(0);
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toFiniteNumber(undefined, 7)).toBe(7);
    expect(toFiniteNumber('12.5')).toBe(12.5);
    expect(roundTo(Number.NaN, 2)).toBe(0);
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
    expect(kgToLb(Number.NaN)).toBe(0);
    expect(lbToKg(Number.POSITIVE_INFINITY)).toBe(0);
    expect(cmToFtIn(Number.NaN)).toEqual({ ft: 0, in: 0 });
    expect(formatWeight(Number.NaN, 'kg')).toBe('0.0 kg');
    expect(formatEnergy(Number.NaN)).toBe('0 kcal');
    expect(formatMacroG(Number.NaN)).toBe('0 g');
  });
});
