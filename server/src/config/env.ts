import 'dotenv/config';
import { z } from 'zod';

// Every environment variable the API needs, validated once at startup.
// If something is missing or wrong, the server refuses to start with a clear message.
const envSchema = z
  .object({
    // On Vercel (which sets VERCEL=1) the default is production, so cookies are secure and
    // error responses never include stack traces. NODE_ENV is deliberately not set in the
    // Vercel dashboard: during the build it would make npm skip devDependencies (Vite, tsc).
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default(process.env.VERCEL ? 'production' : 'development'),
    PORT: z.coerce.number().int().positive().default(4000),
    MONGO_URI: z.string().min(1).default('mongodb://localhost:27017/billbol'),
    CLIENT_URL: z.string().url().default('http://localhost:5173'),
    // No defaults on purpose: a guessable fallback secret would let anyone forge tokens.
    // 32+ characters so a short, weak value like "secret" is rejected at startup.
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // Anthropic API key for the AI features (voice billing). Optional: without it the server
    // still runs, and the AI endpoints answer 503 "not set up". An empty value counts as unset.
    LLM_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
    // Sarvam AI key for natural Indian-language voice: speech-to-text tuned for Hindi, Marathi
    // and Hinglish, and human-sounding text-to-speech. Optional: without it the app uses the
    // browser's own (free, less accurate) speech recognition and voices.
    SARVAM_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
    // Which Sarvam voice speaks Ramu's replies (a bulbul:v3 speaker name, lowercase).
    SARVAM_SPEAKER: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^[a-z_]+$/).default('shubh')),
  })
  // Different secrets mean a refresh token can never be accepted as an access token (or vice versa).
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'must be different from JWT_ACCESS_SECRET',
    path: ['JWT_REFRESH_SECRET'],
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
