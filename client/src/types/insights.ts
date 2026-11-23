import type { BillSummary, PaymentMode } from './bill';

// Mirrors server/src/services/insights.service.ts. Money in paise, quantities in thousandths.

export type SalesPeriod = 'today' | 'yesterday' | 'last_7_days' | 'this_month';

export type SalesSummary = {
  period: SalesPeriod;
  from: string;
  to: string;
  salesPaise: number;
  bills: number;
  avgBillPaise: number;
  paymentSplit: { mode: PaymentMode; paise: number; bills: number }[];
  topProducts: { productId: string; name: string; unit: string; quantityMilli: number; salesPaise: number }[];
};

export type DayPoint = { date: string; salesPaise: number; bills: number };

export type RestockSuggestion = {
  productId: string;
  name: string;
  localName: string | null;
  unit: string;
  stockMilli: number;
  lowStockMilli: number;
  dailyMilli: number;
  daysLeft: number | null;
  suggestedMilli: number;
  urgency: 'out' | 'critical' | 'low';
};

export type UdhaarSummary = {
  totalOwedPaise: number;
  customersOwing: number;
  top: { id: string; name: string; phone: string | null; balancePaise: number; lastActivityAt: string }[];
};

export type Dashboard = {
  generatedAt: string;
  today: SalesSummary;
  yesterday: SalesSummary;
  week: SalesSummary;
  daily: DayPoint[];
  peakHour: number | null;
  restock: RestockSuggestion[];
  udhaar: UdhaarSummary;
  recentBills: BillSummary[];
  productCount: number;
};

export type WriterLanguage = 'en' | 'hi' | 'hinglish' | 'mr';
export type WrittenText = { text: string; source: 'ai' | 'template'; generatedAt: string };
export type ReminderDraft = WrittenText & { whatsappUrl: string | null; balancePaise: number };
