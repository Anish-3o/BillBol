import { CLAUDE_MODEL, getClaude, isClaudeConfigured } from './claude';

export type WriterLanguage = 'en' | 'hi' | 'hinglish' | 'mr';

export const LANGUAGE_RULES: Record<WriterLanguage, string> = {
  en: 'Write in simple Indian English.',
  hi: 'Write in simple Hindi, in Devanagari script. Keep product names as given. Write all numbers and amounts with Western digits exactly as given (for example ₹12,340).',
  mr: 'Write in simple Marathi, in Devanagari script, the way shopkeepers in Maharashtra speak. Keep product names as given. Write all numbers and amounts with Western digits exactly as given (for example ₹12,340).',
  hinglish: 'Write in Hinglish: Hindi words in Latin script, the way shopkeepers type on WhatsApp (for example "Kal ki bikri achhi rahi").',
};

// Rule 3 guard: every number in the AI's text must appear in the facts we gave it. If the
// model invents or changes a number ("₹12,430" instead of "₹12,340"), we throw its text away
// and use the template. Digits are compared after removing thousands separators, so "₹12,340"
// in the facts allows "12340" or "12,340" in the text.
export function isGrounded(text: string, facts: string): boolean {
  const numbers = (s: string) => (s.replace(/(\d),(?=\d)/g, '$1').match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const allowed = new Set(numbers(facts));
  return numbers(text).every((n) => allowed.has(n));
}

// One short piece of writing from facts we computed: a briefing, a reminder. Returns null when
// Claude is not set up, fails, or breaks the grounding rule, and the caller uses its template.
// Failures are logged, not thrown: a missing sentence must never break the dashboard.
export async function writeFromFacts(instructions: string, facts: string): Promise<string | null> {
  if (!isClaudeConfigured()) return null;
  try {
    const response = await getClaude().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      // Low effort: short, friendly text from numbers we already have.
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: instructions,
      // Tagged so the facts are read as data, not as instructions.
      messages: [{ role: 'user', content: `<facts>\n${facts}\n</facts>` }],
    });
    if (response.stop_reason !== 'end_turn') return null;
    const text = response.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
    if (!text) return null;
    if (!isGrounded(text, facts)) {
      console.warn('AI text used a number that is not in the facts; using the template instead.');
      return null;
    }
    return text;
  } catch (err) {
    console.warn('AI writer failed; using the template instead:', (err as Error).message);
    return null;
  }
}
