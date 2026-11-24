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
  | { kind: 'customer'; customer: { id: string; name: string; phone: string | null; balancePaise: number } }
  | { kind: 'products'; products: Product[] }; // price and stock, for "Maggi hai?"

export type AssistantReply = {
  reply: string; // shown on screen
  speech: string; // spoken: Devanagari Hindi
  engine: 'claude' | 'local';
  draft: AssistantDraft | null;
  card: AssistantCard | null;
};

export type AssistantTurn = { role: 'user' | 'assistant'; text: string };

// 'sarvam': the server has a Sarvam key, so speech goes through it (more accurate, natural
// voices). 'browser': the browser's own speech recognition and voices.
export type VoiceEngine = 'sarvam' | 'browser';
export type AssistantStatus = { aiEnabled: boolean; voice: VoiceEngine };

// Mirrors CustomerLookup in server/src/services/assistant.service.ts.
export type CustomerLookup = {
  name: string | null;
  phone: string | null;
  customer: { id: string; name: string; phone: string | null; balancePaise: number } | null;
  candidates: { id: string; name: string; phone: string | null }[];
};
