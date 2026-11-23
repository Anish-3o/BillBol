import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped';

// A shop's regular customer, mainly for udhaar (buying on credit, paying later).
const customerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true },
    // Optional, but needed later for WhatsApp payment reminders. Normalised to 10 digits.
    phone: { type: String, trim: true },
    // What the customer owes the shop, in paise. Negative means they paid in advance.
    // This is a running total kept in step with the ledger (LedgerEntry) inside the same
    // transaction, so the list page does not have to add up every entry each time.
    balancePaise: { type: Number, required: true, default: 0, validate: Number.isInteger },
  },
  { timestamps: true },
);

customerSchema.plugin(tenantScoped);
// One customer per phone number within a shop (different shops can share a customer).
customerSchema.index(
  { tenantId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
// The udhaar list shows who owes the most first.
customerSchema.index({ tenantId: 1, balancePaise: -1 });

export type CustomerDoc = HydratedDocument<InferSchemaType<typeof customerSchema>>;

export const Customer = model('Customer', customerSchema);
