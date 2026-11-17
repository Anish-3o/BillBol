import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
// The SDK's structured-output helper is built on Zod 4. Zod 3.25 (used everywhere else in
// this server) ships Zod 4 under the 'zod/v4' path, so only this file imports it.
import * as z from 'zod/v4';
import { AppError } from '../utils/AppError';
import { CLAUDE_MODEL, getClaude } from './claude';

// What Claude must return. Structured outputs make the API return JSON that matches this
// schema, so there is no free-text parsing. Claude only says WHICH products and HOW MANY;
// prices, GST and totals are never asked of it (Rule 3: AI never invents numbers).
export const VoiceOrderSchema = z.object({
  items: z.array(
    z.object({
      ref: z.string().describe('Catalogue reference of the product, e.g. "P3"'),
      quantity: z.number().describe("Quantity in the product's own unit from the catalogue"),
      heard: z.string().describe('The words the customer used for this item'),
    }),
  ),
  unmatched: z
    .array(z.string())
    .describe('Phrases that clearly ask for an item that is not in the catalogue'),
});

export type VoiceOrder = z.infer<typeof VoiceOrderSchema>;

// Products are sent with short references (P1, P2...) instead of 24-character database ids:
// fewer tokens, and nothing for the model to mistype. The server maps them back.
export type CatalogueEntry = { ref: string; name: string; localName: string | null; unit: string };

export const VOICE_INSTRUCTIONS = `You turn what a customer at an Indian kirana (grocery) shop said into a draft bill.

The speech was transcribed by a browser. It may be Hindi, Marathi, English or a mix (Hinglish), in Devanagari or Latin script, and it may contain transcription mistakes.

How to match products:
- Use only products from the catalogue, referring to each by its ref (e.g. "P3").
- Match by meaning, brand and local names, not just spelling: "cheeni", "shakkar", "साखर" mean sugar; "sabun" means soap; "doodh" means milk; "anda" means eggs.
- If a phrase could mean more than one product and nothing in the speech settles it, choose the closest match. The shopkeeper reviews every line before the bill is saved.
- If the customer clearly asks for something the catalogue does not have, put their words in "unmatched". Never invent products.

How to read quantities:
- Give each quantity in that product's own unit from the catalogue.
- Hindi/Marathi amounts: aadha/ardha = 0.5, paav/pav = 0.25, pauna = 0.75, sava = 1.25, dedh/deedh = 1.5, dhai/adhai/adich = 2.5.
- Convert to the catalogue unit: "250 gram" of a kg product is 0.25; "ek dozen" of a piece product is 12.
- Products sold by piece, packet, box or dozen take whole numbers.
- If no quantity is said, use 1.

Ignore words that are not items: greetings, "aur", "bhaiya", "de do", "kitna hua", and any prices the customer mentions.`;

// One line per product: "P1 | Sugar (loose) | चीनी | kg".
export function catalogueText(catalogue: CatalogueEntry[]): string {
  const lines = catalogue.map((p) => [p.ref, p.name, p.localName ?? '-', p.unit].join(' | '));
  return `Catalogue (ref | name | local name | unit):\n${lines.join('\n')}`;
}

export async function extractVoiceOrder(
  transcript: string,
  catalogue: CatalogueEntry[],
): Promise<VoiceOrder> {
  const claude = getClaude();

  try {
    const response = await claude.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      // Low effort: a short extraction task, and a customer is waiting at the counter.
      // Effort is the only depth control on this model (thinking cannot be switched off).
      output_config: { effort: 'low', format: betaZodOutputFormat(VoiceOrderSchema) },
      // If a safety classifier declines the request, the API retries it on a fallback model
      // within the same call instead of failing the bill.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Fixed instructions first, then the shop's catalogue with a cache breakpoint: repeat
      // bills from the same shop within a few minutes reuse the cached prefix (cheaper, faster).
      // The catalogue is sorted by name, so the same products always produce the same text.
      // Only the transcript, which changes every time, comes after the breakpoint.
      system: [
        { type: 'text', text: VOICE_INSTRUCTIONS },
        { type: 'text', text: catalogueText(catalogue), cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          // Tagged so the model treats the customer's words as data, not as instructions.
          content: `<customer_speech>${transcript}</customer_speech>`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new AppError(422, 'Could not understand that order. Please add the items by hand.');
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      throw new AppError(502, 'Could not read that order. Please try again or add the items by hand.');
    }
    return response.parsed_output;
  } catch (err) {
    throw toAppError(err);
  }
}

// Turns SDK errors into messages a shopkeeper can act on. Most specific first; the SDK's
// typed classes are used instead of matching on error text.
function toAppError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError(503, 'Voice billing is busy right now. Try again in a moment.');
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error('Claude API key rejected:', err.message);
    return new AppError(503, 'Voice billing is not set up correctly. Check LLM_API_KEY.');
  }
  // Includes timeouts (APIConnectionTimeoutError extends APIConnectionError).
  if (err instanceof Anthropic.APIConnectionError) {
    return new AppError(503, 'Could not reach the voice service. Check the internet connection.');
  }
  if (err instanceof Anthropic.APIError) {
    console.error(`Claude API error ${err.status}:`, err.message);
    return new AppError(502, 'The voice service had a problem. Please try again.');
  }
  return err;
}
