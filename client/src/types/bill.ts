import type { Product } from './product';

// Mirrors server/src/services/bill.service.ts. Money in paise, quantities in thousandths.

export const PAYMENT_MODES = ['cash', 'upi', 'card', 'udhaar'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  udhaar: 'Udhaar',
};

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
  customer: { id: string; name: string } | null;
  createdByName: string;
  createdAt: string;
  status: BillStatus;
  cancelled: { at: string; byName: string; reason: string } | null;
  createdById: string;
};

// A cancelled bill stays in the records (with its number) but is not a sale any more.
export type BillStatus = 'active' | 'cancelled';

// Mirrors STAFF_CANCEL_WINDOW_MS on the server (the server is the one that enforces it).
export const STAFF_CANCEL_WINDOW_MS = 10 * 60_000;

export type BillSummary = {
  id: string;
  number: string;
  totalPaise: number;
  paymentMode: PaymentMode;
  customerName: string | null;
  itemCount: number;
  createdByName: string;
  createdAt: string;
  status: BillStatus;
};

export type BillItemInput = { productId: string; quantityMilli: number };

// A voice order turned into draft cart lines by the server (nothing is saved yet).
export type VoiceDraft = {
  transcript: string;
  items: { product: Product; quantityMilli: number; heard: string }[];
  unmatched: string[];
  // Who read the order: Claude, or the offline parser when AI is unavailable.
  engine: 'claude' | 'local';
};
