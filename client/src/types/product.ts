// Mirrors PublicProduct in server/src/services/product.service.ts.
// Money is in paise and quantities in thousandths of the unit; see src/lib.

export const GST_RATES = [0, 5, 18, 28, 40] as const;

export type Product = {
  id: string;
  name: string;
  localName: string | null;
  unit: string;
  pricePaise: number;
  mrpPaise: number | null;
  gstRate: number;
  hsn: string | null;
  stockMilli: number;
  lowStockMilli: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductList = { items: Product[]; total: number; page: number; limit: number };

export type ProductInput = {
  name: string;
  localName: string | null;
  unit: string;
  pricePaise: number;
  mrpPaise: number | null;
  gstRate: number;
  hsn: string | null;
  stockMilli: number;
  lowStockMilli: number;
};

export function isLowStock(p: Product): boolean {
  return p.lowStockMilli > 0 && p.stockMilli <= p.lowStockMilli;
}
