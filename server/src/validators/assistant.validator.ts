import { z } from 'zod';
import { PAYMENT_MODES } from '../models/Bill';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// One message to the assistant, plus the short conversation so far and the current draft.
// The app keeps this state and sends it each time; the server stores no conversation.
export const assistantMessageSchema = z.object({
  message: z.string().trim().min(1, 'Say something first').max(500, 'Too long: say a few items at a time'),
  // The last few turns are enough for "aur do maggi" to make sense; older ones only cost tokens.
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1000) }))
    .max(12)
    .default([]),
  draft: z
    .object({
      items: z
        .array(z.object({ productId: objectId, quantityMilli: z.number().int().min(1).max(10_000_000) }))
        .max(100),
      paymentMode: z.enum(PAYMENT_MODES).optional(),
      customerId: objectId.optional(),
    })
    .nullable()
    .default(null),
  // The wake word the shopkeeper chose ("Ramu", "Munna"...). Only used in the prompt.
  assistantName: z.string().trim().min(1).max(30).optional(),
  // The app's speech language. Marathi and Hindi share a script, so this is how the server
  // knows to answer (and speak) in Marathi.
  language: z.enum(['hi', 'mr', 'en']).default('hi'),
});

export const briefingQuerySchema = z.object({
  lang: z.enum(['en', 'hi', 'hinglish', 'mr']).default('hinglish'),
});

export const reminderSchema = z.object({
  lang: z.enum(['en', 'hi', 'hinglish', 'mr']).default('hinglish'),
});

export type AssistantInput = z.infer<typeof assistantMessageSchema>;
export type ReminderInput = z.infer<typeof reminderSchema>;
