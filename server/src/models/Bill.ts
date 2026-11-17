import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped';

export const PAYMENT_MODES = ['cash', 'upi', 'card'] as const;
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
// Mistakes will be corrected by cancelling the bill (a later feature), not by changing it.
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
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);

billSchema.plugin(tenantScoped);
billSchema.index({ tenantId: 1, number: 1 }, { unique: true });
// "Latest bills first" for the bills list.
billSchema.index({ tenantId: 1, createdAt: -1 });

export type BillDoc = HydratedDocument<InferSchemaType<typeof billSchema>>;

export const Bill = model('Bill', billSchema);
