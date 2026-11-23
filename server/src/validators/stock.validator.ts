import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

// Like a bill, the client sends only product ids and quantities (thousandths of the unit);
// names and units are read from the database.
export const receiveStockSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid product'),
        quantityMilli: z
          .number()
          .int('Quantity must be a whole number of thousandths')
          .min(1, 'Quantity must be more than 0')
          .max(10_000_000, 'Quantity is too large'),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200, 'Too many items at once'),
  supplier: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  note: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
});

export const listReceiptsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;
export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;
