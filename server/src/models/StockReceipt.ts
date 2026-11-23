import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped';

const int = { type: Number, required: true, validate: Number.isInteger };

// Goods that came into the shop (a delivery from the wholesaler, a box from the market).
// Like a bill, it is a record that is never edited: it explains why stock went up, and who
// counted it in. Lines are snapshots of the product name and unit at that moment.
const receiptLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    unit: { type: String, required: true },
    quantityMilli: int,
  },
  { _id: false },
);

const stockReceiptSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    items: {
      type: [receiptLineSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: 'A receipt needs items' },
    },
    // Who supplied it, as the shopkeeper calls them ("Gupta Traders"). Optional.
    supplier: { type: String, trim: true },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);

stockReceiptSchema.plugin(tenantScoped);
stockReceiptSchema.index({ tenantId: 1, createdAt: -1 });

export type StockReceiptDoc = HydratedDocument<InferSchemaType<typeof stockReceiptSchema>>;

export const StockReceipt = model('StockReceipt', stockReceiptSchema);
