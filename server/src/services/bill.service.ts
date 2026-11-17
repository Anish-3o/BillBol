import mongoose, { type ClientSession } from 'mongoose';
import { Bill, type BillDoc, type PaymentMode } from '../models/Bill';
import { Counter } from '../models/Counter';
import { COUNT_UNITS, Product } from '../models/Product';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { isObjectIdString } from '../utils/objectId';
import type {
  BillItemInput,
  CreateBillInput,
  ListBillsQuery,
  QuoteBillInput,
} from '../validators/bill.validator';
import { financialYear, lineAmounts, sumAmounts, type LineAmounts, type TaxMode } from './gst';

export type BillLine = LineAmounts & {
  productId: string;
  name: string;
  unit: string;
  quantityMilli: number;
  unitPricePaise: number;
  gstRate: number;
};

// Selling more than the recorded stock is allowed: the customer and the goods are physically
// at the counter, so the shelf is the truth and our number is what is wrong. We warn instead
// of blocking, and stock goes negative, which flags that a recount is needed.
export type StockWarning = {
  productId: string;
  name: string;
  unit: string;
  stockMilli: number; // stock before this sale
  requestedMilli: number;
};

export type BillQuote = LineAmounts & {
  taxMode: TaxMode;
  lines: BillLine[];
  stockWarnings: StockWarning[];
};

export type PublicBill = LineAmounts & {
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

type Auth = { userId: string; tenantId: string };

// Works out a bill without saving anything. The counter screen calls this as items are added,
// so the totals the shopkeeper sees are always the server's numbers (Rule 3); voice billing
// will use it too, to show a draft for a human to confirm (Rule 2).
export async function quoteBill(tenantId: string, input: QuoteBillInput): Promise<BillQuote> {
  return buildQuote(tenantId, await taxModeOf(tenantId), input.items);
}

// Confirms a bill: saves it, gives it the next number and takes the items out of stock.
// These writes must succeed or fail together. Without a transaction, a crash halfway could
// leave a bill with no stock change, stock taken for a bill that does not exist, or a gap
// in the bill numbers. withTransaction() commits all of them or none, and retries
// automatically on transient conflicts (e.g. two bills taking the next number at once).
export async function createBill(
  auth: Auth,
  input: CreateBillInput,
): Promise<{ bill: PublicBill; stockWarnings: StockWarning[] }> {
  const taxMode = await taxModeOf(auth.tenantId);
  const cashier = await User.findOne({ _id: auth.userId, tenantId: auth.tenantId });
  if (!cashier) throw new AppError(401, 'Session expired, please log in again');

  const fy = financialYear(new Date());
  const counterKey = `bill:${fy}`;
  await ensureCounter(auth.tenantId, counterKey);

  const session = await mongoose.startSession();
  try {
    let saved: BillDoc | undefined;
    let quote: BillQuote | undefined;

    await session.withTransaction(async () => {
      // Read prices and stock inside the transaction, so the bill is based on a consistent view.
      quote = await buildQuote(auth.tenantId, taxMode, input.items, session);

      const counter = await Counter.findOneAndUpdate(
        { tenantId: auth.tenantId, key: counterKey },
        { $inc: { seq: 1 } },
        { new: true, session },
      );
      if (!counter) throw new Error(`Counter ${counterKey} missing for tenant ${auth.tenantId}`);

      [saved] = await Bill.create(
        [
          {
            tenantId: auth.tenantId,
            number: `${fy}/${String(counter.seq).padStart(4, '0')}`,
            financialYear: fy,
            seq: counter.seq,
            taxMode,
            items: quote.lines,
            totalPaise: quote.totalPaise,
            taxablePaise: quote.taxablePaise,
            cgstPaise: quote.cgstPaise,
            sgstPaise: quote.sgstPaise,
            paymentMode: input.paymentMode,
            createdBy: cashier._id,
            createdByName: cashier.name,
          },
        ],
        { session },
      );

      // $inc is atomic, so two counters billing sugar at the same moment both subtract.
      // One updateOne per line (not bulkWrite) so the tenantScoped plugin checks each one.
      for (const line of quote.lines) {
        await Product.updateOne(
          { _id: line.productId, tenantId: auth.tenantId },
          { $inc: { stockMilli: -line.quantityMilli } },
          { session },
        );
      }
    });

    return { bill: toPublicBill(saved!), stockWarnings: quote!.stockWarnings };
  } finally {
    await session.endSession();
  }
}

export async function listBills(
  tenantId: string,
  query: ListBillsQuery,
): Promise<{ items: BillSummary[]; total: number; page: number; limit: number }> {
  const filter = { tenantId };
  const [bills, total] = await Promise.all([
    Bill.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    Bill.countDocuments(filter),
  ]);
  return {
    items: bills.map((b) => ({
      id: b.id,
      number: b.number,
      totalPaise: b.totalPaise,
      paymentMode: b.paymentMode,
      itemCount: b.items.length,
      createdByName: b.createdByName,
      createdAt: b.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getBill(tenantId: string, id: string): Promise<PublicBill> {
  // Another shop's bill id gives 404, not 403, so its existence is not revealed.
  if (!isObjectIdString(id)) throw new AppError(404, 'Bill not found');
  const bill = await Bill.findOne({ _id: id, tenantId });
  if (!bill) throw new AppError(404, 'Bill not found');
  return toPublicBill(bill);
}

async function buildQuote(
  tenantId: string,
  taxMode: TaxMode,
  items: BillItemInput[],
  session?: ClientSession,
): Promise<BillQuote> {
  const wanted = mergeSameProduct(items);
  const products = await Product.find({
    tenantId,
    _id: { $in: [...wanted.keys()] },
    isActive: true,
  }).session(session ?? null);
  const byId = new Map(products.map((p) => [p.id as string, p]));

  const errors: string[] = [];
  const lines: BillLine[] = [];
  const stockWarnings: StockWarning[] = [];

  for (const [productId, quantityMilli] of wanted) {
    const product = byId.get(productId);
    // Archived, deleted, or another shop's product: all look the same to the caller.
    if (!product) {
      errors.push('One of the items is no longer available. Remove it and add it again.');
      continue;
    }
    if ((COUNT_UNITS as readonly string[]).includes(product.unit) && quantityMilli % 1000 !== 0) {
      errors.push(`${product.name}: quantity must be a whole number of ${product.unit}s`);
      continue;
    }
    lines.push({
      productId,
      name: product.name,
      unit: product.unit,
      quantityMilli,
      unitPricePaise: product.pricePaise,
      gstRate: product.gstRate,
      ...lineAmounts(product.pricePaise, quantityMilli, product.gstRate, taxMode),
    });
    if (product.stockMilli < quantityMilli) {
      stockWarnings.push({
        productId,
        name: product.name,
        unit: product.unit,
        stockMilli: product.stockMilli,
        requestedMilli: quantityMilli,
      });
    }
  }

  if (errors.length > 0) throw new AppError(400, errors[0], { items: errors });
  return { taxMode, lines, stockWarnings, ...sumAmounts(lines) };
}

// The same product added twice becomes one line with the quantities added together,
// keeping the order in which items were first added.
function mergeSameProduct(items: BillItemInput[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const { productId, quantityMilli } of items) {
    const id = productId.toLowerCase();
    merged.set(id, (merged.get(id) ?? 0) + quantityMilli);
  }
  return merged;
}

async function taxModeOf(tenantId: string): Promise<TaxMode> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new AppError(401, 'Session expired, please log in again');
  return tenant.gstin ? 'gst' : 'none';
}

// Creates the year's counter at 0 if it does not exist yet. This happens outside the
// transaction on purpose: two first-bills-of-the-year racing to insert the same counter would
// fail with a duplicate-key error, which withTransaction does not retry. Out here we simply
// ignore that error (the other request created it); inside, only a plain $inc remains, and
// conflicts on that are retried automatically.
async function ensureCounter(tenantId: string, key: string): Promise<void> {
  try {
    await Counter.updateOne({ tenantId, key }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  } catch (err) {
    if ((err as { code?: unknown }).code !== 11000) throw err;
  }
}

function toPublicBill(b: BillDoc): PublicBill {
  return {
    id: b.id,
    number: b.number,
    taxMode: b.taxMode,
    items: b.items.map((i) => ({
      productId: i.productId.toString(),
      name: i.name,
      unit: i.unit,
      quantityMilli: i.quantityMilli,
      unitPricePaise: i.unitPricePaise,
      gstRate: i.gstRate,
      totalPaise: i.totalPaise,
      taxablePaise: i.taxablePaise,
      cgstPaise: i.cgstPaise,
      sgstPaise: i.sgstPaise,
    })),
    totalPaise: b.totalPaise,
    taxablePaise: b.taxablePaise,
    cgstPaise: b.cgstPaise,
    sgstPaise: b.sgstPaise,
    paymentMode: b.paymentMode,
    createdByName: b.createdByName,
    createdAt: b.createdAt.toISOString(),
  };
}
