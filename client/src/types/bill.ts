import type { Product } from './product';

// Mirrors server/src/services/bill.service.ts. Money in paise, quantities in thousandths.

export const PAYMENT_MODES = ['cash', 'upi', 'card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_LABELS: Record<PaymentMode, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' };

export type TaxMode = 'gst' | 'none';

type Amounts = { totalPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number };

export type BillLine = Amounts & {
  productId: string;
  name: string;
  unit: string;
  quantityMilli: number;
  unitPricePaise: number;
  gstRate: number;
};

export type StockWarning = {
  productId: string;
  name: string;
  unit: string;
  stockMilli: number;
  requestedMilli: number;
};

export type BillQuote = Amounts & { taxMode: TaxMode; lines: BillLine[]; stockWarnings: StockWarning[] };

export type Bill = Amounts & {
  id: string;
  number: string;
  taxMode: TaxMode;
  items: BillLine[];
  paymentMode: PaymentMode;
  createdByName: string;
  createdAt: string;
};

export type BillSummary = {
  id: string;
  number: string;
  totalPaise: number;
  paymentMode: PaymentMode;
  itemCount: number;
  createdByName: string;
  createdAt: string;
};

export type BillItemInput = { productId: string; quantityMilli: number };

// A voice order turned into draft cart lines by the server (nothing is saved yet).
export type VoiceDraft = {
  transcript: string;
  items: { product: Product; quantityMilli: number; heard: string }[];
  unmatched: string[];
};
