// Builds the ready-to-demo shop "Sharma Kirana Store" with a month of realistic history.
// Used by two callers:
//   - npm run seed:demo           (src/scripts/seedDemo.ts), for a local database
//   - the daily cron on Vercel    (src/routes/cron.routes.ts), so the shared live demo goes back
//                                 to a clean state every night whatever visitors did to it
//
// Log in with phone 9000000001 / password demo@1234 (public on purpose; see client/src/lib/demo.ts).
// Each run wipes and rebuilds ONLY the demo shop (found by its phone number); no other shop is
// touched. Bills come from a fixed random seed, so every run gives the same shape of data,
// ending at the current time.
//
// History is written straight to the collections (bypassing the billing service) because the
// service always stamps bills with "now"; the amounts still come from the same GST functions
// (lineAmounts / sumAmounts), so the numbers are exactly what real billing would produce.
import { Types } from 'mongoose';
import { Bill, type PaymentMode } from '../models/Bill';
import { Counter } from '../models/Counter';
import { Customer } from '../models/Customer';
import { LedgerEntry } from '../models/LedgerEntry';
import { Product } from '../models/Product';
import { RefreshToken } from '../models/RefreshToken';
import { StockReceipt } from '../models/StockReceipt';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { register } from './auth.service';
import { financialYear, lineAmounts, sumAmounts } from './gst';
import { createProduct } from './product.service';
import { registerSchema } from '../validators/auth.validator';
import { createProductSchema } from '../validators/product.validator';
import { CATALOGUE, seedBarcode, toMilli, toPaise } from '../scripts/seedProducts';

export const DEMO = {
  shopName: 'Sharma Kirana Store',
  ownerName: 'Ramesh Sharma',
  phone: '9000000001',
  email: 'demo@billbol.app',
  state: 'Maharashtra',
  gstin: '27AAPFU0939F1ZV',
  password: 'demo@1234',
};

const DAYS = 30;
const IST_OFFSET_MS = 330 * 60_000;

// Small deterministic random generator (mulberry32): same seed, same "random" month.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Re-created at the start of every reset (see resetDemoShop), so each run is identical.
const SEED = 20261120;
let random = rng(SEED);
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = random() * total;
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[items.length - 1][0];
}

// How often each product is bought, roughly like a neighbourhood shop.
const POPULARITY: [RegExp, number][] = [
  [/Milk/, 12], [/Maggi/, 9], [/Parle/, 8], [/Eggs/, 7], [/Bread/, 6], [/Sugar/, 6],
  [/Atta/, 4], [/Rice/, 4], [/Oil 1L/, 4], [/Tea/, 4], [/Bhujia/, 4], [/Coca/, 4], [/Soap/, 4],
  [/Toor/, 3], [/Salt/, 3], [/Poha/, 3], [/Butter/, 3], [/Toothpaste/, 3], [/Surf/, 3], [/Match/, 3], [/Agarbatti/, 3],
  [/Moong/, 2], [/Besan/, 2], [/Turmeric/, 2], [/Chilli/, 2], [/Coconut/, 2],
];

function quantityFor(name: string, unit: string): number {
  if (unit === 'kg') return /Dal/.test(name) ? pick([0.5, 0.5, 1, 1, 2]) : pick([0.5, 1, 1, 1, 2, 5]);
  if (/Eggs/.test(name)) return pick([6, 6, 12, 12, 30]);
  if (/Milk/.test(name)) return pick([1, 2, 2, 2, 4]);
  return weighted([[1, 7], [2, 3], [3, 1]]);
}

// Customers come in the morning and the evening; afternoons are quiet. IST hours.
const HOURS: [number, number][] = [
  [7, 6], [8, 9], [9, 8], [10, 6], [11, 4], [12, 3], [13, 3], [14, 2], [15, 3], [16, 4],
  [17, 6], [18, 9], [19, 10], [20, 8], [21, 5],
];

const CUSTOMERS = [
  { name: 'Suresh Patil', phone: '9822334455' },
  { name: 'Anita Deshmukh', phone: '9823456712' },
  { name: 'Mohammed Shaikh', phone: '9890011223' },
  { name: 'Priya Kulkarni', phone: '9765432109' },
  { name: 'Rajesh Gupta', phone: '9811122233' },
  { name: 'Sunita Jadhav', phone: '9850098500' },
  { name: 'Vikram Singh', phone: '9922001122' },
  { name: 'Kavita Joshi', phone: '9604455667' },
];

// Midnight IST, `daysAgo` days before `now`, as a real instant.
function istMidnight(now: Date, daysAgo: number): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo) - IST_OFFSET_MS);
}

async function wipeDemoShop(): Promise<boolean> {
  const owner = await User.findOne({ phone: DEMO.phone });
  if (!owner) return false;
  const tenantId = owner.tenantId;
  // Raw collection deletes: the tenantScoped plugin is for app queries; here we delete by
  // tenantId explicitly, which is exactly what it would enforce.
  await Promise.all(
    [Bill, Product, Customer, LedgerEntry, Counter, RefreshToken, StockReceipt, User].map((m) => m.collection.deleteMany({ tenantId })),
  );
  await Tenant.collection.deleteOne({ _id: tenantId });
  return true;
}

export type DemoShopSummary = {
  replacedOld: boolean;
  tenantId: string;
  products: number;
  customers: number;
  bills: number;
  totalPaise: number;
};

// Wipes the demo shop (if any) and builds it again. Needs an open database connection.
export async function resetDemoShop(): Promise<DemoShopSummary> {
  random = rng(SEED);
  const replacedOld = await wipeDemoShop();
  const { user, tenant } = await register(registerSchema.parse(DEMO));
  const tenantId = tenant.id;
  const ownerId = new Types.ObjectId(user.id);

  // --- Products (through the real service, so they obey the same rules) ---
  // A few stock levels are set low on purpose, so restock suggestions have something to say.
  const lowOnPurpose: Record<string, number> = { 'Amul Milk 500ml': 14, 'Brown Bread': 3, 'Sugar (loose)': 6, 'Parle-G 250g': 9 };
  for (const [index, seed] of CATALOGUE.entries()) {
    await createProduct(
      tenantId,
      createProductSchema.parse({
        name: seed.name,
        localName: seed.localName,
        unit: seed.unit,
        pricePaise: toPaise(seed.price),
        mrpPaise: seed.mrp === undefined ? null : toPaise(seed.mrp),
        gstRate: seed.gstRate,
        hsn: seed.hsn,
        barcode: seedBarcode(seed, index),
        stockMilli: toMilli(lowOnPurpose[seed.name] ?? seed.stock * 2),
        lowStockMilli: toMilli(seed.lowStock),
      }),
    );
  }
  const products = await Product.find({ tenantId, isActive: true });
  const productWeights: [(typeof products)[number], number][] = products.map((p) => [
    p,
    POPULARITY.find(([re]) => re.test(p.name))?.[1] ?? 2,
  ]);

  const customers = await Customer.insertMany(CUSTOMERS.map((c) => ({ tenantId, ...c })));

  // --- A month of bills ---
  const now = new Date();
  type Draft = { createdAt: Date; doc: Record<string, unknown>; customerIdx: number | null; totalPaise: number };
  const drafts: Draft[] = [];
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const midnight = istMidnight(now, daysAgo);
    const weekday = new Date(midnight.getTime() + IST_OFFSET_MS).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    // Business grows a little over the month: a nicer story on the chart, and true to life
    // for a shop that started billing digitally.
    const base = (weekend ? 34 : 26) + Math.round((DAYS - daysAgo) * 0.25);
    const count = base + Math.floor(random() * 8) - 3;

    for (let b = 0; b < count; b++) {
      const hour = weighted(HOURS);
      const createdAt = new Date(midnight.getTime() + (hour * 60 + Math.floor(random() * 60)) * 60_000 + Math.floor(random() * 60_000));
      if (createdAt > now) continue; // today: only up to the current time

      const lineCount = weighted([[1, 3], [2, 4], [3, 3], [4, 2], [5, 1], [6, 1]]);
      const chosen = new Map<string, { product: (typeof products)[number]; qty: number }>();
      for (let i = 0; i < lineCount; i++) {
        const product = weighted(productWeights);
        if (!chosen.has(product.id)) chosen.set(product.id, { product, qty: quantityFor(product.name, product.unit) });
      }
      const items = [...chosen.values()].map(({ product, qty }) => {
        const quantityMilli = toMilli(qty);
        return {
          productId: product._id,
          name: product.name,
          unit: product.unit,
          quantityMilli,
          unitPricePaise: product.pricePaise,
          gstRate: product.gstRate,
          ...lineAmounts(product.pricePaise, quantityMilli, product.gstRate, 'gst'),
        };
      });
      const paymentMode = weighted<PaymentMode>([['cash', 45], ['upi', 40], ['card', 5], ['udhaar', 10]]);
      const customerIdx = paymentMode === 'udhaar' ? Math.floor(random() * customers.length) : null;
      const totals = sumAmounts(items);
      drafts.push({
        createdAt,
        customerIdx,
        totalPaise: totals.totalPaise,
        doc: {
          tenantId: new Types.ObjectId(tenantId),
          taxMode: 'gst',
          items,
          ...totals,
          paymentMode,
          ...(customerIdx !== null ? { customerId: customers[customerIdx]._id, customerName: customers[customerIdx].name } : {}),
          createdBy: ownerId,
          createdByName: user.name,
        },
      });
    }
  }

  // Bill numbers run in time order within the financial year, as real billing would give.
  drafts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seqByYear = new Map<string, number>();
  const bills = drafts.map((d) => {
    const fy = financialYear(d.createdAt);
    const seq = (seqByYear.get(fy) ?? 0) + 1;
    seqByYear.set(fy, seq);
    return {
      _id: new Types.ObjectId(),
      ...d.doc,
      number: `${fy}/${String(seq).padStart(4, '0')}`,
      financialYear: fy,
      seq,
      createdAt: d.createdAt,
      updatedAt: d.createdAt,
    };
  });
  await Bill.collection.insertMany(bills);
  await Counter.collection.insertMany(
    [...seqByYear].map(([fy, seq]) => ({ tenantId: new Types.ObjectId(tenantId), key: `bill:${fy}`, seq })),
  );

  // --- Udhaar khata: credit sales from the bills, plus customers paying some back ---
  const balances = customers.map(() => 0);
  const entries: Record<string, unknown>[] = [];
  bills.forEach((bill, i) => {
    const d = drafts[i];
    if (d.customerIdx === null) return;
    const c = d.customerIdx;
    balances[c] += d.totalPaise;
    entries.push({
      tenantId: new Types.ObjectId(tenantId),
      customerId: customers[c]._id,
      type: 'credit_sale',
      amountPaise: d.totalPaise,
      balanceAfterPaise: balances[c],
      billId: bill._id,
      billNumber: bill.number,
      createdBy: ownerId,
      createdByName: user.name,
      createdAt: d.createdAt,
      updatedAt: d.createdAt,
    });
    // Now and then the customer clears part of their khata, a day later. Some never do,
    // which is what makes reminders useful.
    if (c % 3 !== 0 && random() < 0.35 && balances[c] > 20000) {
      const paid = Math.round((balances[c] * (0.5 + random() * 0.5)) / 1000) * 1000;
      const at = new Date(d.createdAt.getTime() + 26 * 3600_000);
      if (at < now && paid > 0) {
        balances[c] -= paid;
        entries.push({
          tenantId: new Types.ObjectId(tenantId),
          customerId: customers[c]._id,
          type: 'payment',
          amountPaise: paid,
          balanceAfterPaise: balances[c],
          paymentMode: pick(['cash', 'upi'] as const),
          note: 'Part payment',
          createdBy: ownerId,
          createdByName: user.name,
          createdAt: at,
          updatedAt: at,
        });
      }
    }
  });
  if (entries.length) await LedgerEntry.collection.insertMany(entries);
  await Promise.all(customers.map((c, i) => Customer.updateOne({ _id: c._id, tenantId }, { $set: { balancePaise: balances[i] } })));

  const total = drafts.reduce((sum, d) => sum + d.totalPaise, 0);
  return { replacedOld, tenantId, products: products.length, customers: customers.length, bills: bills.length, totalPaise: total };
}
