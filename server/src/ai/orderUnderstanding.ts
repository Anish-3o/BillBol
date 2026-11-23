import { AppError } from '../utils/AppError';
import { isClaudeConfigured } from './claude';
import { parseOrderLocally } from './localParser';
import { extractVoiceOrder, type CatalogueEntry, type VoiceOrder } from './voiceOrder';

export type OrderEngine = 'claude' | 'local';

// Picks who reads the order: Claude when it is set up and reachable, otherwise the offline
// parser. Only "unavailable" errors (503: no key, rate limit, no internet) fall back. A refusal
// or an unreadable answer is reported to the shopkeeper instead, because silently swapping in
// a weaker parser there would hide a real problem.
export async function understandOrder(
  transcript: string,
  catalogue: CatalogueEntry[],
  ignoreWords: string[] = [],
): Promise<{ order: VoiceOrder; engine: OrderEngine }> {
  if (!isClaudeConfigured()) {
    return { order: parseOrderLocally(transcript, catalogue, ignoreWords), engine: 'local' };
  }
  try {
    return { order: await extractVoiceOrder(transcript, catalogue), engine: 'claude' };
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 503) {
      console.warn(`Claude unavailable (${err.message}); using the offline parser.`);
      return { order: parseOrderLocally(transcript, catalogue, ignoreWords), engine: 'local' };
    }
    throw err;
  }
}
