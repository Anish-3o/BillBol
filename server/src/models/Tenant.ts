import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';

// A tenant is one shop. It is the root of multi-tenancy: every other business document
// (users, products, bills...) carries this document's _id as its tenantId.
const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    // The shop's contact number (printed on invoices). Normalised to 10 digits by the validator.
    phone: { type: String, required: true, trim: true },
    // Needed later for GST: same-state sales are CGST + SGST, other states are IGST.
    state: { type: String, required: true, trim: true },
    // Optional: many small kirana stores are below the GST registration threshold.
    gstin: { type: String, trim: true, uppercase: true },
    // Street address, printed under the shop name on receipts. Optional.
    address: { type: String, trim: true },
    // The shop's UPI ID ("sharmakirana@okaxis"). With it, the app shows a QR code with the
    // exact amount, so the customer scans and pays from any UPI app.
    upiId: { type: String, trim: true, lowercase: true },
  },
  { timestamps: true },
);

export type TenantAttrs = InferSchemaType<typeof tenantSchema>;
export type TenantDoc = HydratedDocument<TenantAttrs>;

export const Tenant = model('Tenant', tenantSchema);
