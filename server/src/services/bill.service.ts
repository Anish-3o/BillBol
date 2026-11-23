import mongoose, { type ClientSession } from 'mongoose';
import { Bill, type BillDoc, type BillStatus, type PaymentMode } from '../models/Bill';
import type { Role } from '../models/User';
import { Counter } from '../models/Counter';
import { COUNT_UNITS, Product } from '../models/Product';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { isObjectIdString } from '../utils/objectId';
import type {
  BillItemInput,
  CancelBillInput,
  CreateBillInput,
  ListBillsQuery,
  QuoteBillInput,
} from '../validators/bill.validator';
import { chargeForBill, findCustomerForBill, reverseBillCharge } from './customer.service';
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
  customer: { id: string; name: string } | null;
  createdByName: string;
  createdAt: string;
  status: BillStatus;
  cancelled: { at: string; byName: string; reason: string } | null;
  createdById: string; // lets the app show "Cancel" to staff only on their own bills
};

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

type Auth = { userId: string; tenantId: string };

// Staff can undo their own mistake while the customer is still at the counter; after that only
// the owner can cancel. Otherwise a cashier could take cash for a bill, cancel it at night and
// keep the money: the classic till fraud that cancel permissions exist to stop.
export const STAFF_CANCEL_WINDOW_MS = 10 * 60_000;

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
      // Must be one of this shop's customers (checked here, inside the transaction).
      const customer = input.customerId
        ? await findCustomerForBill(auth.tenantId, input.customerId, session)
        : null;

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
            customerId: customer?._id,
            customerName: customer?.name,
            createdBy: cashier._id,
            createdByName: cashier.name,
          },
        ],
        { session },
      );

      // Udhaar: write the bill into the customer's khata in the same transaction, so the bill
      // and the amount the customer owes can never disagree.
      if (input.paymentMode === 'udhaar') {
        if (!customer) throw new AppError(400, 'Choose the customer for udhaar');
        await chargeForBill(
          {
            tenantId: auth.tenantId,
            customerId: customer.id,
            bill: { id: saved!.id, number: saved!.number, totalPaise: saved!.totalPaise },
            createdBy: auth.userId,
            createdByName: cashier.name,
          },
          session,
        );
      }

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
      customerName: b.customerName ?? null,
      itemCount: b.items.length,
      createdByName: b.createdByName,
      createdAt: b.createdAt.toISOString(),
      status: b.status ?? 'active',
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

// Cancels a bill: marks it cancelled, puts the items back in stock and, for udhaar, takes the
// amount off the customer's khata. One transaction, for the same reason as createBill: a bill
// marked cancelled whose stock never came back would leave the shelf count wrong for good.
export async function cancelBill(
  auth: Auth & { role: Role },
  id: string,
  input: CancelBillInput,
): Promise<PublicBill> {
  if (!isObjectIdString(id)) throw new AppError(404, 'Bill not found');
  const user = await User.findOne({ _id: auth.userId, tenantId: auth.tenantId });
  if (!user) throw new AppError(401, 'Session expired, please log in again');

  const session = await mongoose.startSession();
  try {
    let cancelled: BillDoc | null = null;
    await session.withTransaction(async () => {
      const bill = await Bill.findOne({ _id: id, tenantId: auth.tenantId }).session(session);
      if (!bill) throw new AppError(404, 'Bill not found');
      if (bill.status === 'cancelled') throw new AppError(409, 'This bill is already cancelled');

      if (auth.role !== 'owner') {
        const own = bill.createdBy.toString() === auth.userId;
        const recent = Date.now() - bill.createdAt.getTime() <= STAFF_CANCEL_WINDOW_MS;
        if (!own || !recent) {
          throw new AppError(403, 'Only the owner can cancel this bill. Staff can cancel their own bills for 10 minutes.');
        }
      }

      // The status condition makes a double cancel impossible even if two requests race:
      // only one update can match a bill that is not cancelled yet (the other gets null).
      cancelled = await Bill.findOneAndUpdate(
        { _id: bill._id, tenantId: auth.tenantId, status: { $ne: 'cancelled' } },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelledBy: user._id,
            cancelledByName: user.name,
            cancelReason: input.reason,
          },
        },
        { new: true, session },
      );
      if (!cancelled) throw new AppError(409, 'This bill is already cancelled');

      // Back on the shelf. No isActive filter: a product archived since the sale still gets
      // its stock back, so restoring it later shows the right count.
      for (const item of bill.items) {
        await Product.updateOne(
          { _id: item.productId, tenantId: auth.tenantId },
          { $inc: { stockMilli: item.quantityMilli } },
          { session },
        );
      }

      if (bill.paymentMode === 'udhaar' && bill.customerId) {
        await reverseBillCharge(
          {
            tenantId: auth.tenantId,
            customerId: bill.customerId.toString(),
            bill: { id: bill.id, number: bill.number, totalPaise: bill.totalPaise },
            reason: input.reason,
            createdBy: auth.userId,
            createdByName: user.name,
          },
          session,
        );
      }
    });
    return toPublicBill(cancelled!);
  } finally {
    await session.endSession();
  }
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
    customer: b.customerId ? { id: b.customerId.toString(), name: b.customerName ?? '' } : null,
    createdByName: b.createdByName,
    createdAt: b.createdAt.toISOString(),
    status: b.status ?? 'active',
    cancelled:
      b.status === 'cancelled'
        ? { at: b.cancelledAt!.toISOString(), byName: b.cancelledByName ?? '', reason: b.cancelReason ?? '' }
        : null,
    createdById: b.createdBy.toString(),
  };
}
