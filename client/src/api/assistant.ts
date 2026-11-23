import type { AssistantReply, AssistantTurn } from '../types/assistant';
import type { PaymentMode } from '../types/bill';
import { api } from './client';

export type DraftInput = {
  items: { productId: string; quantityMilli: number }[];
  paymentMode?: PaymentMode;
  customerId?: string;
} | null;

// One thing the shopkeeper said. The app owns the conversation and the draft and sends them
// each time; the server answers and returns the new draft. It never saves a bill.
export const askAssistant = (body: {
  message: string;
  history: AssistantTurn[];
  draft: DraftInput;
  assistantName: string;
  language: 'hi' | 'mr' | 'en';
}) => api<AssistantReply>('/assistant/message', 'POST', body);

export const getAssistantStatus = () => api<{ aiEnabled: boolean }>('/assistant/status');
