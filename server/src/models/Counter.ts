import { model, Schema } from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped';

// A per-shop sequence, e.g. key "bill:2026-27" -> the last bill number used this year.
// Incremented inside the same transaction that saves the bill, so if the bill fails the
// increment is rolled back too: bill numbers never skip, which GST requires.
const counterSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  key: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

counterSchema.plugin(tenantScoped);
counterSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const Counter = model('Counter', counterSchema);
