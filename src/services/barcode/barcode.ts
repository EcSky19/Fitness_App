function digitsOnly(code: string): string {
  return typeof code === 'string' ? code.trim().replace(/\s+/g, '') : '';
}

function allDigits(code: string): boolean {
  return /^\d+$/.test(code);
}

function gtinCheckDigit(payload: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = payload.length - 1; i >= 0; i -= 1) {
    sum += Number(payload[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

function hasGtinCheckDigit(code: string): boolean {
  return gtinCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

function expandUpcE(code: string): string | null {
  if (code.length !== 8 || !/^[01]/.test(code)) return null;
  const ns = code[0];
  const d = code.slice(1, 7);
  const check = code[7];
  const last = d[5];

  let manufacturer: string;
  let product: string;
  if (last === '0' || last === '1' || last === '2') {
    manufacturer = `${d.slice(0, 2)}${last}00`;
    product = `00${d.slice(2, 5)}`;
  } else if (last === '3') {
    manufacturer = `${d.slice(0, 3)}00`;
    product = `000${d.slice(3, 5)}`;
  } else if (last === '4') {
    manufacturer = `${d.slice(0, 4)}0`;
    product = `0000${d[4]}`;
  } else {
    manufacturer = d.slice(0, 5);
    product = `0000${last}`;
  }

  return `${ns}${manufacturer}${product}${check}`;
}

export function normalizeBarcode(code: string): string {
  return digitsOnly(code);
}

export function gtin13FromGtin14(code: string): string | null {
  const digits = digitsOnly(code);
  if (digits.length !== 14 || !allDigits(digits) || !hasGtinCheckDigit(digits)) return null;
  const payload = digits.slice(1, 13);
  return `${payload}${gtinCheckDigit(payload)}`;
}

export function isValidBarcode(code: string): boolean {
  const digits = digitsOnly(code);
  if (!allDigits(digits)) return false;
  if (digits.length === 8 || digits.length === 12 || digits.length === 13 || digits.length === 14) {
    if (digits.length === 8) {
      const expanded = expandUpcE(digits);
      if (expanded && hasGtinCheckDigit(expanded)) return true;
    }
    return hasGtinCheckDigit(digits);
  }
  return false;
}
