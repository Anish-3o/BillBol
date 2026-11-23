import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped';

// 'udhaar': the customer takes the goods now and pays later; the bill is charged to their
// account in the ledger (see customer.service chargeForBill).
export const PAYMENT_MODES = ['cash', 'upi', 'card', 'udhaar'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const int = { type: Number, required: true, validate: Number.isInteger };

// Each line is a snapshot: name, unit, price and GST rate are copied from the product at the
// moment of sale. If the owner later changes the price of sugar, last week's bill must still
// show what the customer actually paid.
const billItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    unit: { type: String, required: true },
    quantityMilli: int,
    unitPricePaise: int,
    gstRate: { type: Number, required: true },
    totalPaise: int,
    taxablePaise: int,
    cgstPaise: int,
    sgstPaise: int,
  },
  { _id: false },
);

// Bills are never edited after they are saved; that is what makes them trustworthy records.
// A mistake is fixed by cancelling the bill (and making a corrected one), not by changing it.
// A cancelled bill stays in the list with its number: GST rules expect invoice numbers to run
// without silent gaps, and the owner can see who cancelled what, when and why.
export const BILL_STATUSES = ['active', 'cancelled'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

const billSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    // "2026-27/0001": financial year + sequence, unique per shop (see Counter).
    number: { type: String, required: true },
    financialYear: { type: String, required: true },
    seq: int,
    // Copied from the shop at sale time: a shop that registers for GST later must not
    // change how its old bills read.
    taxMode: { type: String, enum: ['gst', 'none'], required: true },
    items: {
      type: [billItemSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: 'A bill needs items' },
    },
    totalPaise: int,
    taxablePaise: int,
    cgstPaise: int,
    sgstPaise: int,
    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },
    // Required for udhaar bills, optional otherwise. The name is a snapshot, like item names.
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },

    // Older documents (and the demo seed, which writes straight to the collection) have no
    // status, so queries for sales use `status: { $ne: 'cancelled' }`: missing means active.
    status: { type: String, enum: BILL_STATUSES, required: true, default: 'active' },
    cancelledAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledByName: { type: String },
    cancelReason: { type: String },
  },
  { timestamps: true },
);

// The one filter every sales number must use, so a cancelled bill never counts as a sale.
export const NOT_CANCELLED = { status: { $ne: 'cancelled' } } as const;

billSchema.plugin(tenantScoped);
billSchema.index({ tenantId: 1, number: 1 }, { unique: true });
// "Latest bills first" for the bills list.
billSchema.index({ tenantId: 1, createdAt: -1 });

export type BillDoc = HydratedDocument<InferSchemaType<typeof billSchema>>;

export const Bill = model('Bill', billSchema);
