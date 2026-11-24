import { z } from 'zod';
import { GST_RATES, UNITS } from '../models/Product';

// Upper limits stop absurd values (a typo with extra zeros) from reaching the database.
const MAX_PAISE = 10_000_000_00; // ₹1 crore
const MAX_MILLI = 1_000_000_000; // 1 million units

// Whole numbers only: the client converts "₹12.50" to 1250 paise and "2.5 kg" to 2500.
// A decimal arriving here means the client did not convert, so we reject it.
const paise = z
  .number()
  .int('Must be a whole number of paise')
  .min(0, 'Cannot be negative')
  .max(MAX_PAISE, 'Too large');
const milli = z
  .number()
  .int('Must be a whole number of thousandths')
  .min(0, 'Cannot be negative')
  .max(MAX_MILLI, 'Too large');

const gstRate = z
  .number()
  .refine((r) => (GST_RATES as readonly number[]).includes(r), {
    message: `GST rate must be one of ${GST_RATES.join(', ')}`,
  });

// HSN codes are 4, 6 or 8 digits.
const hsn = z
  .string()
  .trim()
  .regex(/^\d{4}(\d{2}){0,2}$/, 'HSN code must be 4, 6 or 8 digits');

// What a scanner types: 8 digits (EAN-8), 12 (UPC-A), 13 (EAN-13), or a shop's own Code-128
// label. Letters, digits and dashes only, so a stray space cannot make a "different" code.
export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{4,32}$/, 'Barcode must be 4 to 32 letters or digits');

// Optional text fields: "" or null both mean "not set". In an update, null clears the value.
const emptyToNull = (v: unknown) => (v === '' ? null : v);
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyToNull, schema.nullable().optional());

// Shared fields with no defaults, so the update schema can make them all optional without
// a default sneaking in (a default stock of 0 in an update would wipe the real stock).
const baseFields = {
  name: z.string().trim().min(1, 'Enter a product name').max(100),
  localName: optional(z.string().trim().max(100)),
  unit: z.enum(UNITS),
  pricePaise: paise,
  mrpPaise: optional(paise),
  gstRate,
  hsn: optional(hsn),
  barcode: optional(barcodeSchema),
  stockMilli: milli,
  lowStockMilli: milli,
};

// Unknown keys (including a tenantId sent by the client) are silently stripped by Zod,
// so they never reach the database.
export const createProductSchema = z.object({
  ...baseFields,
  stockMilli: milli.default(0),
  lowStockMilli: milli.default(0),
});

export const updateProductSchema = z
  .object({
    ...baseFields,
    // Lets an owner restore an archived product.
    isActive: z.boolean(),
  })
  .partial();

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  // Query strings are text, so "true"/"false" must be converted by hand.
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// Bulk price update, e.g. from a distributor's price list uploaded as CSV. Each row names a
// product by barcode or by name; the app converts rupees to paise before sending. With
// apply: false (the default) nothing is saved, so the owner sees a preview first.
export const priceUpdateSchema = z.object({
  rows: z
    .array(
      z
        .object({
          name: z.string().trim().max(100).optional(),
          barcode: z.string().trim().max(32).optional(),
          pricePaise: paise,
          // Left out = keep the MRP already stored; null = clear it.
          mrpPaise: paise.nullable().optional(),
        })
        .refine((r) => Boolean(r.name || r.barcode), { message: 'Each row needs a product name or barcode' }),
    )
    .min(1, 'The price list is empty')
    .max(1000, 'At most 1000 rows at a time'),
  apply: z.boolean().default(false),
});

export type PriceUpdateInput = z.infer<typeof priceUpdateSchema>;
