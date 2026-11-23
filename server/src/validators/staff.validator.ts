import { z } from 'zod';
import { passwordSchema, phoneSchema } from './auth.validator';

// The owner sets up a helper's login: name, mobile number and a starting password, which the
// owner tells them. Staff log in with that phone, like the owner does.
export const addStaffSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(100),
  phone: phoneSchema,
  password: passwordSchema,
});

export type AddStaffInput = z.infer<typeof addStaffSchema>;
