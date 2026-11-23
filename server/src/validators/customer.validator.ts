import { z } from 'zod';
import { phoneSchema } from './auth.validator';

const emptyToNull = (v: unknown) => (v === '' ? null : v);

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(100),
  // Optional; same normalisation as login phones ("+91 98765 43210" -> "9876543210").
  phone: z.preprocess(emptyToNull, phoneSchema.nullable().optional()),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const paymentSchema = z.object({
  amountPaise: z
    .number()
    .int('Must be a whole number of paise')
    .min(1, 'Enter an amount')
    .max(10_000_000_00, 'Too large'),
  paymentMode: z.enum(['cash', 'upi', 'card']),
  note: z.string().trim().max(200).optional(),
});

export const listCustomersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
