import { z } from 'zod';
import { GSTIN_REGEX, phoneSchema } from './auth.validator';

// UPI IDs (VPAs) look like "name@bank": letters, digits, dots, dashes or underscores, then @
// and the bank's handle. The handle has no digits ("okaxis", "ybl", "paytm").
const upiId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,256}@[a-z]{2,64}$/, 'Enter a UPI ID like sharmakirana@okaxis');

// "" or null clears an optional field (e.g. the shop stops being GST-registered).
const emptyToNull = (v: unknown) => (v === '' ? null : v);
const clearable = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyToNull, schema.nullable().optional());

// Owner-only shop details. Unknown keys (an id, a tenantId) are stripped by Zod. The owner's
// name and login phone belong to the user account, so they are not changed here.
export const updateShopSchema = z.object({
  name: z.string().trim().min(2, 'Enter the shop name').max(100).optional(),
  phone: phoneSchema.optional(),
  state: z.string().trim().min(2).max(50).optional(),
  address: clearable(z.string().trim().max(200, 'Keep the address under 200 characters')),
  gstin: clearable(z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN')),
  upiId: clearable(upiId),
});

export type UpdateShopInput = z.infer<typeof updateShopSchema>;
