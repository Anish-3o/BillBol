import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped';

// credit_sale adds to what the customer owes; payment and bill_cancelled take it away. A
// cancelled udhaar bill is not deleted from the khata: a new line reverses it, like a pen entry.
export const LEDGER_TYPES = ['credit_sale', 'payment', 'bill_cancelled'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

// The udhaar ledger ("khata"). Append-only: entries are never edited or deleted, like a paper
// khata written in pen. A mistake is fixed by adding a new entry, so the history always
// explains the balance: the customer's balance equals credit sales minus payments.
const ledgerEntrySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    type: { type: String, enum: LEDGER_TYPES, required: true },
    // Always positive; `type` says which way it moves the balance.
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isInteger },
    // The balance right after this entry, so the khata reads like a bank statement.
    balanceAfterPaise: { type: Number, required: true, validate: Number.isInteger },
    // For credit sales: which bill.
    billId: { type: Schema.Types.ObjectId, ref: 'Bill' },
    billNumber: { type: String },
    // For payments: how the customer paid.
    paymentMode: { type: String, enum: ['cash', 'upi', 'card'] },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);

ledgerEntrySchema.plugin(tenantScoped);
ledgerEntrySchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });

export type LedgerEntryDoc = HydratedDocument<InferSchemaType<typeof ledgerEntrySchema>>;

export const LedgerEntry = model('LedgerEntry', ledgerEntrySchema);
