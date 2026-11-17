import Anthropic from '@anthropic-ai/sdk';
import { getClaude } from '../src/ai/claude';
import { catalogueText, extractVoiceOrder, VOICE_INSTRUCTIONS } from '../src/ai/voiceOrder';
import { AppError } from '../src/utils/AppError';

// Unit tests for the Claude call itself. The SDK client is replaced by a fake, so these
// check what we SEND and how we handle every kind of answer, without network or cost.
jest.mock('../src/ai/claude', () => ({ CLAUDE_MODEL: 'claude-opus-5-5', getClaude: jest.fn() }));

const parse = jest.fn();
const catalogue = [
  { ref: 'P1', name: 'Lux Soap 100g', localName: 'साबुन', unit: 'piece' },
  { ref: 'P2', name: 'Sugar (loose)', localName: 'चीनी', unit: 'kg' },
];
const answer = {
  items: [{ ref: 'P2', quantity: 1.5, heard: 'dedh kilo cheeni' }],
  unmatched: [],
};

beforeEach(() => {
  parse.mockReset();
  jest.mocked(getClaude).mockReturnValue({ beta: { messages: { parse } } } as unknown as Anthropic);
});

async function expectAppError(promise: Promise<unknown>, status: number, message: RegExp) {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).statusCode).toBe(status);
  expect((err as AppError).message).toMatch(message);
}

describe('extractVoiceOrder', () => {
  it('sends the transcript and catalogue in a cache-friendly, structured request', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: answer });

    const result = await extractVoiceOrder('dedh kilo cheeni', catalogue);

    expect(result).toEqual(answer);
    const request = parse.mock.calls[0][0];
    expect(request).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(request.output_config.format).toBeDefined(); // structured output schema
    // Stable instructions, then the catalogue with the cache breakpoint...
    expect(request.system).toEqual([
      { type: 'text', text: VOICE_INSTRUCTIONS },
      { type: 'text', text: catalogueText(catalogue), cache_control: { type: 'ephemeral' } },
    ]);
    // ...and only the changing transcript after it, marked as data.
    expect(request.messages).toEqual([
      { role: 'user', content: '<customer_speech>dedh kilo cheeni</customer_speech>' },
    ]);
  });

  it('formats the catalogue one product per line', () => {
    expect(catalogueText(catalogue)).toBe(
      'Catalogue (ref | name | local name | unit):\nP1 | Lux Soap 100g | साबुन | piece\nP2 | Sugar (loose) | चीनी | kg',
    );
    expect(catalogueText([{ ref: 'P1', name: 'Eggs', localName: null, unit: 'piece' }])).toContain(
      'P1 | Eggs | - | piece',
    );
  });

  it('turns a refusal into "add the items by hand"', async () => {
    parse.mockResolvedValue({ stop_reason: 'refusal', parsed_output: null });

    await expectAppError(extractVoiceOrder('x', catalogue), 422, /add the items by hand/);
  });

  it('handles a response that could not be parsed', async () => {
    parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null });

    await expectAppError(extractVoiceOrder('x', catalogue), 502, /Could not read that order/);
  });

  it('maps API errors to messages a shopkeeper can act on', async () => {
    const headers = new Headers();

    parse.mockRejectedValueOnce(new Anthropic.RateLimitError(429, undefined, 'slow down', headers));
    await expectAppError(extractVoiceOrder('x', catalogue), 503, /busy/);

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    parse.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, undefined, 'bad key', headers));
    await expectAppError(extractVoiceOrder('x', catalogue), 503, /Check LLM_API_KEY/);

    parse.mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: 'offline' }));
    await expectAppError(extractVoiceOrder('x', catalogue), 503, /internet connection/);

    parse.mockRejectedValueOnce(new Anthropic.InternalServerError(500, undefined, 'oops', headers));
    await expectAppError(extractVoiceOrder('x', catalogue), 502, /had a problem/);
  });
});
