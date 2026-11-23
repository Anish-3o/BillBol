import { Types } from 'mongoose';
import type { SalesPeriod } from '../ai/localParser';
import { Bill, NOT_CANCELLED, type PaymentMode } from '../models/Bill';
import { Customer } from '../models/Customer';
import { LedgerEntry } from '../models/LedgerEntry';
import { COUNT_UNITS, Product } from '../models/Product';
import { listBills, type BillSummary } from './bill.service';

// Everything the dashboard, the morning briefing and the assistant say about the business is
// calculated here, in code (Rule 3). The LLM only ever turns these numbers into sentences.

// Kirana shops are in India, so "today" means the Indian day. A server in another timezone
// (CI, cloud) must not move yesterday's 11 pm sale into today. IST has no daylight saving,
// so a fixed offset is exact.
const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Midnight IST of the day `date` falls in, shifted by `addDays`, as a real (UTC) instant.
export function istDayStart(date: Date, addDays = 0): Date {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + addDays) - IST_OFFSET_MS);
}

function istMonthStart(date: Date): Date {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

// "2026-11-20" for the IST day of `date`.
export const istDateKey = (date: Date) => new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const oid = (id: string) => new Types.ObjectId(id); // aggregate() does not cast strings itself

export type PaymentSplit = { mode: PaymentMode; paise: number; bills: number };
export type TopProduct = { productId: string; name: string; unit: string; quantityMilli: number; salesPaise: number };

export type SalesSummary = {
  period: SalesPeriod;
  from: string;
  to: string;
  salesPaise: number;
  bills: number;
  avgBillPaise: number;
  paymentSplit: PaymentSplit[];
  topProducts: TopProduct[];
};

export function periodRange(period: SalesPeriod, now: Date): { from: Date; to: Date } {
  switch (period) {
    case 'yesterday':
      return { from: istDayStart(now, -1), to: istDayStart(now) };
    case 'last_7_days':
      return { from: istDayStart(now, -6), to: now };
    case 'this_month':
      return { from: istMonthStart(now), to: now };
    default:
      return { from: istDayStart(now), to: now };
  }
}

type SalesFacet = {
  totals: { paise: number; bills: number }[];
  byMode: { _id: PaymentMode; paise: number; bills: number }[];
  top: { _id: Types.ObjectId; name: string; unit: string; quantityMilli: number; salesPaise: number }[];
};

// Totals, payment split and best sellers for a period, in one database round trip.
export async function salesSummary(tenantId: string, period: SalesPeriod, now = new Date()): Promise<SalesSummary> {
  const { from, to } = periodRange(period, now);
  const [facet] = await Bill.aggregate<SalesFacet>([
    { $match: { tenantId: oid(tenantId), ...NOT_CANCELLED, createdAt: { $gte: from, $lt: to } } },
    {
      $facet: {
        totals: [{ $group: { _id: null, paise: { $sum: '$totalPaise' }, bills: { $sum: 1 } } }],
        byMode: [{ $group: { _id: '$paymentMode', paise: { $sum: '$totalPaise' }, bills: { $sum: 1 } } }],
        top: [
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.productId',
              name: { $last: '$items.name' },
              unit: { $last: '$items.unit' },
              quantityMilli: { $sum: '$items.quantityMilli' },
              salesPaise: { $sum: '$items.totalPaise' },
            },
          },
          { $sort: { salesPaise: -1, _id: 1 } },
          { $limit: 5 },
        ],
      },
    },
  ]);

  const salesPaise = facet.totals[0]?.paise ?? 0;
  const bills = facet.totals[0]?.bills ?? 0;
  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    salesPaise,
    bills,
    avgBillPaise: bills === 0 ? 0 : Math.round(salesPaise / bills),
    paymentSplit: facet.byMode
      .map((m) => ({ mode: m._id, paise: m.paise, bills: m.bills }))
      .sort((a, b) => b.paise - a.paise),
    topProducts: facet.top.map((t) => ({
      productId: t._id.toString(),
      name: t.name,
      unit: t.unit,
      quantityMilli: t.quantityMilli,
      salesPaise: t.salesPaise,
    })),
  };
}

export type DayPoint = { date: string; salesPaise: number; bills: number };

// Sales per day for the last `days` days, today included. Days without sales are 0, so the
// chart has no gaps.
export async function dailySales(tenantId: string, days: number, now = new Date()): Promise<DayPoint[]> {
  const from = istDayStart(now, -(days - 1));
  const rows = await Bill.aggregate<{ _id: string; paise: number; bills: number }>([
    { $match: { tenantId: oid(tenantId), ...NOT_CANCELLED, createdAt: { $gte: from, $lt: now } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } },
        paise: { $sum: '$totalPaise' },
        bills: { $sum: 1 },
      },
    },
  ]);
  const byDay = new Map(rows.map((r) => [r._id, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = istDateKey(new Date(from.getTime() + i * DAY_MS));
    const row = byDay.get(date);
    return { date, salesPaise: row?.paise ?? 0, bills: row?.bills ?? 0 };
  });
}

// The busiest hour of the day over the last 7 days (0-23, IST), or null with no sales.
export async function peakHour(tenantId: string, now = new Date()): Promise<number | null> {
  const rows = await Bill.aggregate<{ _id: number; bills: number }>([
    { $match: { tenantId: oid(tenantId), ...NOT_CANCELLED, createdAt: { $gte: istDayStart(now, -6), $lt: now } } },
    { $group: { _id: { $hour: { date: '$createdAt', timezone: TZ } }, bills: { $sum: 1 } } },
    { $sort: { bills: -1, _id: 1 } },
    { $limit: 1 },
  ]);
  return rows[0]?._id ?? null;
}

export type RestockSuggestion = {
  productId: string;
  name: string;
  localName: string | null;
  unit: string;
  stockMilli: number;
  lowStockMilli: number;
  dailyMilli: number; // average sold per day over the last 14 days
  daysLeft: number | null; // at that rate; null if it has not sold recently
  suggestedMilli: number; // order this much to cover a week plus the safety level
  urgency: 'out' | 'critical' | 'low';
};

const VELOCITY_DAYS = 14;
const COVER_DAYS = 7;

// "Smart restock": which products will run out soon and how much to order. Uses how fast each
// product actually sells, not just the fixed low-stock level, so a product that sells 10 a day
// is flagged days before it hits its threshold. Simple and explainable on purpose; the
// average is easy to explain to a shopkeeper, which matters more here than a fancier model.
export async function restockSuggestions(tenantId: string, now = new Date(), limit = 8): Promise<RestockSuggestion[]> {
  const [products, sold] = await Promise.all([
    Product.find({ tenantId, isActive: true }),
    Bill.aggregate<{ _id: Types.ObjectId; quantityMilli: number }>([
      { $match: { tenantId: oid(tenantId), ...NOT_CANCELLED, createdAt: { $gte: istDayStart(now, -(VELOCITY_DAYS - 1)), $lt: now } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', quantityMilli: { $sum: '$items.quantityMilli' } } },
    ]),
  ]);
  const soldById = new Map(sold.map((s) => [s._id.toString(), s.quantityMilli]));

  const suggestions: RestockSuggestion[] = [];
  for (const p of products) {
    const dailyMilli = Math.round((soldById.get(p.id) ?? 0) / VELOCITY_DAYS);
    const daysLeft = dailyMilli > 0 ? Math.max(0, Math.round((p.stockMilli / dailyMilli) * 10) / 10) : null;
    const belowLevel = p.lowStockMilli > 0 && p.stockMilli <= p.lowStockMilli;
    const runningOut = daysLeft !== null && daysLeft < 3;
    if (!belowLevel && !runningOut && p.stockMilli > 0) continue;

    // Enough for a week of sales plus the safety level, rounded up to what can be bought:
    // whole pieces/packets, half-kilos for loose goods. Never suggest less than one unit.
    const step = (COUNT_UNITS as readonly string[]).includes(p.unit) ? 1000 : 500;
    const needed = dailyMilli * COVER_DAYS + p.lowStockMilli - p.stockMilli;
    const suggestedMilli = Math.max(1000, Math.ceil(needed / step) * step);

    const urgency =
      p.stockMilli <= 0 ? 'out' : (daysLeft !== null && daysLeft < 1) || p.stockMilli * 2 <= p.lowStockMilli ? 'critical' : 'low';
    suggestions.push({
      productId: p.id,
      name: p.name,
      localName: p.localName ?? null,
      unit: p.unit,
      stockMilli: p.stockMilli,
      lowStockMilli: p.lowStockMilli,
      dailyMilli,
      daysLeft,
      suggestedMilli,
      urgency,
    });
  }

  const rank = { out: 0, critical: 1, low: 2 } as const;
  return suggestions
    .sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.daysLeft ?? 99) - (b.daysLeft ?? 99) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export type UdhaarSummary = {
  totalOwedPaise: number;
  customersOwing: number;
  top: { id: string; name: string; phone: string | null; balancePaise: number; lastActivityAt: string }[];
};

export async function udhaarSummary(tenantId: string, limit = 5): Promise<UdhaarSummary> {
  const [totals, top] = await Promise.all([
    Customer.aggregate<{ totalOwedPaise: number; customersOwing: number }>([
      { $match: { tenantId: oid(tenantId), balancePaise: { $gt: 0 } } },
      { $group: { _id: null, totalOwedPaise: { $sum: '$balancePaise' }, customersOwing: { $sum: 1 } } },
    ]),
    Customer.find({ tenantId, balancePaise: { $gt: 0 } }).sort({ balancePaise: -1, name: 1 }).limit(limit),
  ]);
  // "Last entry" comes from the khata itself, not the customer document's updatedAt (which
  // also changes when, say, a phone number is edited).
  const last = await LedgerEntry.aggregate<{ _id: Types.ObjectId; at: Date }>([
    { $match: { tenantId: oid(tenantId), customerId: { $in: top.map((c) => c._id) } } },
    { $group: { _id: '$customerId', at: { $max: '$createdAt' } } },
  ]);
  const lastById = new Map(last.map((l) => [l._id.toString(), l.at]));
  return {
    totalOwedPaise: totals[0]?.totalOwedPaise ?? 0,
    customersOwing: totals[0]?.customersOwing ?? 0,
    top: top.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      balancePaise: c.balancePaise,
      lastActivityAt: (lastById.get(c.id) ?? c.updatedAt).toISOString(),
    })),
  };
}

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

// Everything the home screen shows, fetched in parallel.
export async function getDashboard(tenantId: string, now = new Date()): Promise<Dashboard> {
  const [today, yesterday, week, daily, peak, restock, udhaar, recent, productCount] = await Promise.all([
    salesSummary(tenantId, 'today', now),
    salesSummary(tenantId, 'yesterday', now),
    salesSummary(tenantId, 'last_7_days', now),
    dailySales(tenantId, 14, now),
    peakHour(tenantId, now),
    restockSuggestions(tenantId, now),
    udhaarSummary(tenantId),
    listBills(tenantId, { page: 1, limit: 6 }),
    Product.countDocuments({ tenantId, isActive: true }),
  ]);
  return {
    generatedAt: now.toISOString(),
    today,
    yesterday,
    week,
    daily,
    peakHour: peak,
    restock,
    udhaar,
    recentBills: recent.items,
    productCount,
  };
}
