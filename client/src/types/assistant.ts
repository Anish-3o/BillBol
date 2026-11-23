import type { BillQuote, PaymentMode } from './bill';
import type { RestockSuggestion, SalesSummary, UdhaarSummary } from './insights';
import type { Product } from './product';

// Mirrors server/src/services/assistant.service.ts.

export type AssistantDraft = {
  items: { product: Product; quantityMilli: number }[];
  unmatched: string[];
  paymentMode: PaymentMode;
  customer: { id: string; name: string; balancePaise: number } | null;
  quote: BillQuote | null;
};

export type AssistantCard =
  | { kind: 'sales'; summary: SalesSummary }
  | { kind: 'restock'; items: RestockSuggestion[] }
  | { kind: 'udhaar'; summary: UdhaarSummary }
  | { kind: 'customer'; customer: { id: string; name: string; phone: string | null; balancePaise: number } };

export type AssistantReply = {
  reply: string; // shown on screen
  speech: string; // spoken: Devanagari Hindi
  engine: 'claude' | 'local';
  draft: AssistantDraft | null;
  card: AssistantCard | null;
};

export type AssistantTurn = { role: 'user' | 'assistant'; text: string };
