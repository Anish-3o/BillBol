import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped';

// Count units are sold whole (you cannot sell 2.5 soaps). Measured units allow decimals
// (2.5 kg of loose sugar), up to 3 places, i.e. down to 1 gram or 1 ml.
export const COUNT_UNITS = ['piece', 'packet', 'box', 'dozen'] as const;
export const MEASURED_UNITS = ['kg', 'litre'] as const;
export const UNITS = [...COUNT_UNITS, ...MEASURED_UNITS] as const;
export type Unit = (typeof UNITS)[number];

// GST rates in percent. Since GST 2.0 (22 Sep 2025) most goods are 0, 5 or 18%, with 40% for
// luxury and "sin" goods. 28% stays for tobacco products during the compensation-cess
// transition, which kirana shops do sell. Check with a CA before relying on this in production.
export const GST_RATES = [0, 5, 18, 28, 40] as const;
export type GstRate = (typeof GST_RATES)[number];

// Case-insensitive comparison: "Tata Salt" and "tata salt" are the same product name.
export const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

// Mongoose runs custom validators even on null, so null (an optional field being cleared)
// must pass here; whether a value is required is checked separately by `required`.
const isInteger = {
  validator: (v: unknown) => v == null || Number.isInteger(v),
  message: '{PATH} must be a whole number',
};

const productSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    // Name in Hindi/Marathi as customers say it ("चीनी" for sugar). Voice billing will match it.
    localName: { type: String, trim: true },
    unit: { type: String, enum: UNITS, required: true },

    // Money is stored as integer paise (Rule 4): floats cannot represent 0.1 exactly, so
    // ₹0.10 + ₹0.20 would not equal ₹0.30. The unit is in the field name so nobody mistakes
    // paise for rupees. Prices include GST, as on a shop shelf (B2C); the tax is worked out
    // from the price at billing time.
    pricePaise: { type: Number, required: true, min: 0, validate: isInteger },
    // Printed MRP. Optional (loose goods have none). Selling above MRP is illegal in India,
    // which the service checks.
    mrpPaise: { type: Number, min: 0, validate: isInteger },
    gstRate: { type: Number, enum: GST_RATES, required: true },
    // HSN code, needed on GST invoices (Week 3).
    hsn: { type: String, trim: true },

    // Quantities use the same trick as money: integer thousandths of the unit.
    // 2.5 kg is stored as 2500, 12 pieces as 12000. Billing will subtract from stock
    // thousands of times; with floats, rounding errors would pile up.
    stockMilli: { type: Number, required: true, default: 0, validate: isInteger },
    // Show a low-stock warning at or below this level. 0 means no warning.
    lowStockMilli: { type: Number, required: true, default: 0, min: 0, validate: isInteger },

    // Soft delete: products are archived, never removed. Old bills point at products,
    // and a bill from last month must still show what was sold.
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

productSchema.plugin(tenantScoped);

// Product names are unique per shop, not globally (two shops can both sell "Tata Salt").
// Case-insensitive via collation, and only among active products, so an archived
// product's name can be reused.
productSchema.index(
  { tenantId: 1, name: 1 },
  { unique: true, collation: CASE_INSENSITIVE, partialFilterExpression: { isActive: true } },
);

export type ProductAttrs = InferSchemaType<typeof productSchema>;
export type ProductDoc = HydratedDocument<ProductAttrs>;

export const Product = model('Product', productSchema);
