import type { BarcodeProduct } from '@/services/barcode';
import type { Food, Macros } from '@/types';

export type { BarcodeProduct } from '@/services/barcode';

export function productServingLabel(product: BarcodeProduct): string {
  const grams = product.servingSizeG && product.servingSizeG > 0 ? product.servingSizeG : 100;
  return `${grams} g`;
}

export function productToFoodInput(product: BarcodeProduct): Partial<Food> & {
  name: string;
  per100g: Macros;
} {
  const servingSizeG = product.servingSizeG && product.servingSizeG > 0 ? product.servingSizeG : 100;
  return {
    name: product.name.trim(),
    brand: product.brand,
    per100g: product.per100g,
    servingSizeG,
    servingLabel: productServingLabel(product),
    barcode: product.barcode,
    source: 'custom',
  };
}
