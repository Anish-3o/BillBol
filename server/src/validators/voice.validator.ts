import { z } from 'zod';

const language = z.enum(['hi', 'mr', 'en']).default('hi');

// ?lang=hi on POST /voice/transcribe (the body is the raw audio).
export const transcribeQuerySchema = z.object({ lang: language });

// One reply for Ramu to speak. Replies are a sentence or two, so a short limit also caps
// what a single request can cost.
export const speakSchema = z.object({
  text: z.string().trim().min(1, 'Nothing to say').max(600, 'Too long to speak at once'),
  lang: language,
});

export type SpeakInput = z.infer<typeof speakSchema>;
