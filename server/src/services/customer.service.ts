import mongoose, { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { Customer, type CustomerDoc } from '../models/Customer';
import { LedgerEntry, type LedgerEntryDoc, type LedgerType } from '../models/LedgerEntry';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { isObjectIdString } from '../utils/objectId';
import type {
  CreateCustomerInput,
  LedgerQuery,
  ListCustomersQuery,
  PaymentInput,
  UpdateCustomerInput,
} from '../validators/customer.validator';

export type PublicCustomer = {
  id: string;
  name: string;
  phone: string | null;
  balancePaise: number;
  createdAt: string;
};

export type PublicLedgerEntry = {
  id: string;
  type: LedgerType;
  amountPaise: number;
  balanceAfterPaise: number;
  billId: string | null;
  billNumber: string | null;
  paymentMode: string | null;
  note: string | null;
  createdByName: string;
  createdAt: string;
};

type Auth = { userId: string; tenantId: string };

const NOT_FOUND = 'Customer not found';
const PHONE_TAKEN = { phone: ['Another customer already has this phone number'] };

export async function createCustomer(tenantId: string, input: CreateCustomerInput): Promise<PublicCustomer> {
  const customer = new Customer({ tenantId, name: input.name, phone: input.phone ?? undefined });
  return toPublicCustomer(await saveOr409(customer));
}

export async function updateCustomer(
  tenantId: string,
  id: string,
  input: UpdateCustomerInput,
): Promise<PublicCustomer> {
  if (Object.keys(input).length === 0) throw new AppError(400, 'Nothing to update');
  const customer = await findOwnedCustomer(tenantId, id);
  if (input.name !== undefined) customer.name = input.name;
  // null clears the phone; the balance is never editable here, only through the ledger.
  if (input.phone !== undefined) customer.phone = input.phone ?? undefined;
  return toPublicCustomer(await saveOr409(customer));
}

// The udhaar list: who owes the most first, plus the shop's total outstanding udhaar.
export async function listCustomers(tenantId: string, query: ListCustomersQuery) {
  const filter: FilterQuery<CustomerDoc> = { tenantId };
  if (query.q) {
    const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: pattern }, { phone: pattern }];
  }

  const [customers, total, owing] = await Promise.all([
    Customer.find(filter)
      .sort({ balancePaise: -1, name: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    Customer.countDocuments(filter),
    // aggregate() does not convert strings to ObjectIds the way find() does, so the
    // tenant id must be converted by hand or the $match silently matches nothing.
    Customer.aggregate<{ totalOwedPaise: number; customersOwing: number }>([
      { $match: { tenantId: new Types.ObjectId(tenantId), balancePaise: { $gt: 0 } } },
      { $group: { _id: null, totalOwedPaise: { $sum: '$balancePaise' }, customersOwing: { $sum: 1 } } },
    ]),
  ]);

  return {
    items: customers.map(toPublicCustomer),
    total,
    page: query.page,
    limit: query.limit,
    totalOwedPaise: owing[0]?.totalOwedPaise ?? 0,
    customersOwing: owing[0]?.customersOwing ?? 0,
  };
}

export async function getCustomer(tenantId: string, id: string): Promise<PublicCustomer> {
  return toPublicCustomer(await findOwnedCustomer(tenantId, id));
}

export async function listLedger(tenantId: string, customerId: string, query: LedgerQuery) {
  const customer = await findOwnedCustomer(tenantId, customerId);
  const filter = { tenantId, customerId: customer._id };
  const [entries, total] = await Promise.all([
    LedgerEntry.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    LedgerEntry.countDocuments(filter),
  ]);
  return { items: entries.map(toPublicEntry), total, page: query.page, limit: query.limit };
}

// A customer pays back (part of) their udhaar. The balance change and the ledger entry are
// one transaction: a balance that moved without an entry, or the other way round, would make
// the khata impossible to trust.
export async function recordPayment(auth: Auth, customerId: string, input: PaymentInput) {
  await findOwnedCustomer(auth.tenantId, customerId);
  const cashierName = await nameOf(auth);

  const session = await mongoose.startSession();
  try {
    let result: { customer: PublicCustomer; entry: PublicLedgerEntry } | undefined;
    await session.withTransaction(async () => {
      // Paying more than is owed is allowed: the balance goes negative (advance payment).
      const customer = await Customer.findOneAndUpdate(
        { _id: customerId, tenantId: auth.tenantId },
        { $inc: { balancePaise: -input.amountPaise } },
        { new: true, session },
      );
      if (!customer) throw new AppError(404, NOT_FOUND);
      const [entry] = await LedgerEntry.create(
        [
          {
            tenantId: auth.tenantId,
            customerId: customer._id,
            type: 'payment',
            amountPaise: input.amountPaise,
            balanceAfterPaise: customer.balancePaise,
            paymentMode: input.paymentMode,
            note: input.note,
            createdBy: auth.userId,
            createdByName: cashierName,
          },
        ],
        { session },
      );
      result = { customer: toPublicCustomer(customer), entry: toPublicEntry(entry) };
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

// Called by the billing service INSIDE its transaction for an udhaar bill: the bill, its
// stock changes, the customer's new balance and the ledger entry all commit together.
export async function chargeForBill(
  args: {
    tenantId: string;
    customerId: string;
    bill: { id: string; number: string; totalPaise: number };
    createdBy: string;
    createdByName: string;
  },
  session: ClientSession,
): Promise<void> {
  const customer = await Customer.findOneAndUpdate(
    { _id: args.customerId, tenantId: args.tenantId },
    { $inc: { balancePaise: args.bill.totalPaise } },
    { new: true, session },
  );
  if (!customer) throw new AppError(400, NOT_FOUND, { customerId: [NOT_FOUND] });
  await LedgerEntry.create(
    [
      {
        tenantId: args.tenantId,
        customerId: customer._id,
        type: 'credit_sale',
        amountPaise: args.bill.totalPaise,
        balanceAfterPaise: customer.balancePaise,
        billId: args.bill.id,
        billNumber: args.bill.number,
        createdBy: args.createdBy,
        createdByName: args.createdByName,
      },
    ],
    { session },
  );
}

// Called by the billing service INSIDE its transaction when an udhaar bill is cancelled: the
// amount comes off the customer's balance and a reversing line goes into the khata. The
// original credit_sale line stays, so the history still explains every rupee. If the customer
// had already paid, the balance can go negative, which correctly shows the shop owes them.
export async function reverseBillCharge(
  args: {
    tenantId: string;
    customerId: string;
    bill: { id: string; number: string; totalPaise: number };
    reason: string;
    createdBy: string;
    createdByName: string;
  },
  session: ClientSession,
): Promise<void> {
  const customer = await Customer.findOneAndUpdate(
    { _id: args.customerId, tenantId: args.tenantId },
    { $inc: { balancePaise: -args.bill.totalPaise } },
    { new: true, session },
  );
  // The customer is never deleted while bills point at them, so this means data is broken.
  if (!customer) throw new Error(`Customer ${args.customerId} of bill ${args.bill.id} is missing`);
  await LedgerEntry.create(
    [
      {
        tenantId: args.tenantId,
        customerId: customer._id,
        type: 'bill_cancelled',
        amountPaise: args.bill.totalPaise,
        balanceAfterPaise: customer.balancePaise,
        billId: args.bill.id,
        billNumber: args.bill.number,
        note: args.reason,
        createdBy: args.createdBy,
        createdByName: args.createdByName,
      },
    ],
    { session },
  );
}

// Used by billing to check the customer and copy their name onto the bill.
export async function findCustomerForBill(
  tenantId: string,
  customerId: string,
  session?: ClientSession,
): Promise<CustomerDoc> {
  if (!isObjectIdString(customerId)) throw new AppError(400, NOT_FOUND, { customerId: [NOT_FOUND] });
  const customer = await Customer.findOne({ _id: customerId, tenantId }).session(session ?? null);
  if (!customer) throw new AppError(400, NOT_FOUND, { customerId: [NOT_FOUND] });
  return customer;
}

// Another shop's customer id gives 404, not 403, so its existence is not revealed.
async function findOwnedCustomer(tenantId: string, id: string): Promise<CustomerDoc> {
  if (!isObjectIdString(id)) throw new AppError(404, NOT_FOUND);
  const customer = await Customer.findOne({ _id: id, tenantId });
  if (!customer) throw new AppError(404, NOT_FOUND);
  return customer;
}

async function nameOf(auth: Auth): Promise<string> {
  const user = await User.findOne({ _id: auth.userId, tenantId: auth.tenantId });
  if (!user) throw new AppError(401, 'Session expired, please log in again');
  return user.name;
}

async function saveOr409(customer: CustomerDoc): Promise<CustomerDoc> {
  try {
    return await customer.save();
  } catch (err) {
    if ((err as { code?: unknown }).code === 11000) {
      throw new AppError(409, 'Another customer already has this phone number', PHONE_TAKEN);
    }
    throw err;
  }
}

export function toPublicCustomer(c: CustomerDoc): PublicCustomer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone ?? null,
    balancePaise: c.balancePaise,
    createdAt: c.createdAt.toISOString(),
  };
}

function toPublicEntry(e: LedgerEntryDoc): PublicLedgerEntry {
  return {
    id: e.id,
    type: e.type,
    amountPaise: e.amountPaise,
    balanceAfterPaise: e.balanceAfterPaise,
    billId: e.billId?.toString() ?? null,
    billNumber: e.billNumber ?? null,
    paymentMode: e.paymentMode ?? null,
    note: e.note ?? null,
    createdByName: e.createdByName,
    createdAt: e.createdAt.toISOString(),
  };
}
