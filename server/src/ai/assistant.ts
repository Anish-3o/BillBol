import type { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod/v4';
import { AppError } from '../utils/AppError';
import { CLAUDE_MODEL, getClaude } from './claude';
import { catalogueText, toAppError, type CatalogueEntry } from './voiceOrder';

// "Hey Ramu": the shop's voice assistant, built as a Claude agent with tools.
//
// Claude decides WHAT to do (make a draft bill, look up sales, check udhaar) and calls our
// tools; the tools do the work in code against this shop's data. That split is what keeps the
// rules intact:
// - Rule 2: there is no "save bill" tool. The agent can only change the DRAFT; the
//   shopkeeper confirms in the app, which calls the normal POST /bills.
// - Rule 3: every amount the agent says comes back from a tool, calculated in code.
// - Rule 1: the tools are built per request with the logged-in tenant baked in, so the model
//   has no way to name another shop.

export type AssistantTurn = { role: 'user' | 'assistant'; text: string };
// Tools with different input types in one array: the runner itself types them as <any>, and
// each tool still validates its own input with its Zod schema before run() is called.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RunnableTool = ReturnType<typeof betaZodTool<z.ZodType<any>>>;

export type AssistantLanguage = 'hi' | 'mr' | 'en';

export function assistantInstructions(name: string, shopName: string, language: AssistantLanguage = 'hi'): string {
  const speakLanguage = language === 'mr' ? 'Marathi' : 'Hindi';
  const replyLanguage =
    language === 'mr'
      ? '- This shop speaks Marathi: reply in simple Marathi, in Devanagari script, even if a few words are in Hindi or English.'
      : '- Reply in the language and script the shopkeeper used: Devanagari Hindi for Devanagari, Hinglish in Latin script for Latin-script Hindi, Marathi for Marathi, English for English.';
  return `You are ${name}, the voice assistant at ${shopName}, a kirana (grocery) shop in India. The shopkeeper talks to you while serving customers at the counter. Your replies are read aloud by text-to-speech.

What you can do, using your tools:
- Make bills. When the shopkeeper lists items, call update_bill_draft with the COMPLETE list of items for the bill: it replaces the draft. To add, remove or change items, send the current items with the change applied. Refer to products by their catalogue ref.
- Answer questions about sales (get_sales_summary), what to reorder (get_restock_suggestions) and udhaar, i.e. customer credit (get_udhaar).
- Start over with clear_bill_draft when the shopkeeper cancels.

Bills:
- You never save a bill. After updating the draft, read back the items in a few words with the total from the tool result, then ask the shopkeeper to confirm, for example "Kul ₹245. Confirm karun?". The app handles their yes or no.
- Match products by meaning, brand and local names: "cheeni", "shakkar", "साखर" are sugar; "sabun" is soap; "doodh" is milk; "anda" is eggs. If nothing in the catalogue fits, put the words in "unmatched". Never invent products.
- Quantities are in each product's own unit: "250 gram" of a kg product is 0.25; "ek dozen" of a piece product is 12. aadha = 0.5, paav = 0.25, sava = 1.25, dedh = 1.5, dhai = 2.5. No quantity said means 1.
- For udhaar ("Sharma ji ke khate mein likh do"), set payment_mode "udhaar" and customer_name. If the tool says the customer was not found or is unclear, tell the shopkeeper.

Numbers:
- Never calculate, estimate or round any amount, total or count yourself. Say only numbers a tool returned, exactly as written.

How to reply:
- One or two short sentences, at most about 35 words: they are spoken aloud. No markdown, lists or emoji.
${replyLanguage}
- If something is unclear, ask one short question.
- If asked about anything unrelated to the shop, say politely that you help with bills, stock, sales and udhaar.

Voice:
- After your reply, add the same reply in ${speakLanguage}, written in Devanagari script, inside <speak></speak>. A ${speakLanguage} text-to-speech voice reads it aloud, so write it the way a shopkeeper speaks: simple everyday ${speakLanguage}. Keep product and brand names as they are (for example "Maggi", "Tata Salt") and keep amounts exactly as in your reply (for example ₹245).`;
}

// "Kul ₹245. Confirm karun? <speak>कुल ₹245। कन्फ़र्म करूँ?</speak>" -> the screen text and the
// spoken text. If the model forgot the tag, the reply itself is spoken.
export function splitSpeech(text: string): { reply: string; speech: string } {
  const match = /<speak>([\s\S]*?)<\/speak>/i.exec(text);
  const reply = text.replace(/<speak>[\s\S]*?(<\/speak>|$)/gi, '').trim();
  const speech = match?.[1].trim() || reply;
  return { reply: reply || speech, speech };
}

export async function runAssistantAgent(args: {
  name: string;
  language?: AssistantLanguage;
  shopName: string;
  catalogue: CatalogueEntry[];
  history: AssistantTurn[];
  message: string;
  draftText: string;
  tools: RunnableTool[];
}): Promise<{ reply: string; speech: string }> {
  // The API needs the conversation to start with the shopkeeper.
  const history = [...args.history];
  while (history[0]?.role === 'assistant') history.shift();

  try {
    const final = await getClaude().beta.messages.toolRunner({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      // A few tool calls at most per request (e.g. look up udhaar, then update the draft).
      max_iterations: 6,
      // Send the full (short) history each turn rather than using a server-side thread.
      thread: false,
      // Low effort: quick counter-side tasks, and someone is waiting for the answer.
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Fixed instructions and the shop's catalogue first, with a cache breakpoint: every
      // turn of a conversation reuses the cached prefix. Only the messages change.
      system: [
        { type: 'text', text: assistantInstructions(args.name, args.shopName, args.language) },
        { type: 'text', text: catalogueText(args.catalogue), cache_control: { type: 'ephemeral' } },
      ],
      tools: args.tools,
      messages: [
        ...history.map((t) => ({ role: t.role, content: t.text })),
        {
          role: 'user',
          // The draft is app state the model must see; the shopkeeper's words are tagged as
          // data so they are not treated as instructions.
          content: `<current_draft>\n${args.draftText}\n</current_draft>\n<shopkeeper_said>${args.message}</shopkeeper_said>`,
        },
      ],
    });

    if (final.stop_reason === 'refusal') {
      throw new AppError(422, 'Sorry, I could not help with that. Try saying the items again.');
    }
    const text = final.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join(' ')
      .trim();
    if (!text) throw new AppError(502, 'The assistant did not answer. Please try again.');
    return splitSpeech(text);
  } catch (err) {
    throw toAppError(err);
  }
}
