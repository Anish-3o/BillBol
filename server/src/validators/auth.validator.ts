import { z } from 'zod';

// Indian mobile numbers: 10 digits starting with 6-9. Users type them in many shapes
// ("+91 98765 43210", "098765-43210"), so we strip formatting and store one canonical form.
// Without this, the same person could register twice with differently formatted numbers.
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email');

// GSTIN format: 2-digit state code + 10-char PAN + entity number + 'Z' + check character.
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// bcrypt only uses the first 72 bytes of a password; anything longer would be silently
// ignored, so we cap it instead of pretending it adds security.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

// HTML forms send "" for empty fields; treat that as "not provided".
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const registerSchema = z.object({
  shopName: z.string().trim().min(2).max(100),
  ownerName: z.string().trim().min(2).max(100),
  // Shop contact number, and also the owner's login phone.
  phone: phoneSchema,
  // Optional second way for the owner to log in.
  email: z.preprocess(emptyToUndefined, emailSchema.optional()),
  state: z.string().trim().min(2).max(50),
  gstin: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN')
      .optional(),
  ),
  password: passwordSchema,
});

export const loginSchema = z.object({
  // One input on the login screen: "Phone or email".
  identifier: z.string().trim().min(1, 'Enter your phone or email'),
  // No length rules here: login only checks the password, it does not enforce policy.
  password: z.string().min(1, 'Enter your password'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
