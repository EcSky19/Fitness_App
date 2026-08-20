import { isValidBarcode } from '../barcode';

describe('isValidBarcode', () => {
  it('validates EAN-13, EAN-8, UPC-A and UPC-E check digits', () => {
    expect(isValidBarcode('4006381333931')).toBe(true);
    expect(isValidBarcode('73513537')).toBe(true);
    expect(isValidBarcode('036000291452')).toBe(true);
    expect(isValidBarcode('04210007')).toBe(true);
  });

  it('rejects structurally invalid and mistyped codes', () => {
    expect(isValidBarcode('4006381333932')).toBe(false);
    expect(isValidBarcode('73513536')).toBe(false);
    expect(isValidBarcode('036000291453')).toBe(false);
    expect(isValidBarcode('abc')).toBe(false);
    expect(isValidBarcode('12345')).toBe(false);
  });
});
