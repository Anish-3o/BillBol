import type {
  Bill,
  BillItemInput,
  BillQuote,
  BillSummary,
  PaymentMode,
  StockWarning,
  VoiceDraft,
} from '../types/bill';
import { api } from './client';

// Totals for a cart, worked out by the server without saving anything.
export const quoteBill = (items: BillItemInput[]) => api<BillQuote>('/bills/quote', 'POST', { items });

// customerId is required for udhaar (the bill goes into that customer's khata).
export const createBill = (items: BillItemInput[], paymentMode: PaymentMode, customerId?: string) =>
  api<{ bill: Bill; stockWarnings: StockWarning[] }>('/bills', 'POST', { items, paymentMode, customerId });

export const listBills = (limit = 50) =>
  api<{ items: BillSummary[]; total: number }>(`/bills?limit=${limit}`);

export const getBill = (id: string) => api<Bill>(`/bills/${id}`);

// What the customer said -> a draft cart. The shopkeeper still checks it and confirms.
export const voiceDraft = (transcript: string) =>
  api<VoiceDraft>('/bills/voice-draft', 'POST', { transcript });

// Cancels a saved bill (stock goes back, udhaar is reversed). The bill stays in the records.
export const cancelBill = (id: string, reason: string) => api<Bill>(`/bills/${id}/cancel`, 'POST', { reason });
