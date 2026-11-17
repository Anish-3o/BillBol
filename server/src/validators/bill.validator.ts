import { z } from 'zod';
import { PAYMENT_MODES } from '../models/Bill';

// The client sends only product ids and quantities. Names, prices and GST rates are read
// from the database on the server, so a tampered request cannot change what things cost.
const billItem = z.object({
  productId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid product'),
  // Thousandths of the product's unit (2.5 kg = 2500). At most 10,000 units per line.
  quantityMilli: z
    .number()
    .int('Quantity must be a whole number of thousandths')
    .min(1, 'Quantity must be more than 0')
    .max(10_000_000, 'Quantity is too large'),
});

export const quoteBillSchema = z.object({
  items: z.array(billItem).min(1, 'Add at least one item').max(200, 'Too many items in one bill'),
});

export const createBillSchema = quoteBillSchema.extend({
  paymentMode: z.enum(PAYMENT_MODES),
});

// What the browser's speech recognition heard (or what the shopkeeper typed instead).
export const voiceDraftSchema = z.object({
  transcript: z.string().trim().min(1, 'Say or type the order first').max(500, 'Too long: say up to a few items at a time'),
});

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type BillItemInput = z.infer<typeof billItem>;
export type QuoteBillInput = z.infer<typeof quoteBillSchema>;
export type CreateBillInput = z.infer<typeof createBillSchema>;
export type VoiceDraftInput = z.infer<typeof voiceDraftSchema>;
export type ListBillsQuery = z.infer<typeof listBillsQuerySchema>;
