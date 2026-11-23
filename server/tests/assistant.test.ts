import request from 'supertest';
import { runAssistantAgent, splitSpeech } from '../src/ai/assistant';
import { isClaudeConfigured } from '../src/ai/claude';
import { createApp } from '../src/app';
import { Bill } from '../src/models/Bill';
import { AppError } from '../src/utils/AppError';
import { otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

// Most tests run the offline brain (the test env has no API key). The Claude agent itself is
// mocked: the tests drive its real tools, which is where the rules are enforced.
jest.mock('../src/ai/claude', () => ({
  ...jest.requireActual('../src/ai/claude'),
  isClaudeConfigured: jest.fn(() => false),
}));
jest.mock('../src/ai/assistant', () => ({
  ...jest.requireActual('../src/ai/assistant'),
  runAssistantAgent: jest.fn(),
}));
const configured = jest.mocked(isClaudeConfigured);
const agent = jest.mocked(runAssistantAgent);

const app = createApp();
let shop: Awaited<ReturnType<typeof registerShop>>;
let sugarId: string;
let soapId: string;

const as = (token: string) => ({
  post: (path: string, body: object) => request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
});
const say = (message: string, extra: object = {}, token = shop.accessToken) =>
  as(token).post('/api/assistant/message', { message, ...extra });

type DraftItem = { product: { id: string; name: string }; quantityMilli: number };
const lines = (draft: { items: DraftItem[] }) => draft.items.map((i) => [i.product.name, i.quantityMilli]);

beforeAll(connectTestDB);
beforeEach(async () => {
  configured.mockReturnValue(false);
  agent.mockReset();
  shop = await registerShop(app);
  const owner = as(shop.accessToken);
  sugarId = (await owner.post('/api/products', { name: 'Sugar (loose)', localName: 'चीनी', unit: 'kg', pricePaise: 4600, gstRate: 5, stockMilli: 40000 })).body.id;
  soapId = (await owner.post('/api/products', { name: 'Lux Soap 100g', localName: 'साबुन', unit: 'piece', pricePaise: 3800, gstRate: 5, stockMilli: 20000 })).body.id;
  await owner.post('/api/customers', { name: 'Suresh Patil', phone: '9822334455' });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDB();
});
afterAll(closeTestDB);

describe('POST /api/assistant/message (offline brain)', () => {
  it('drafts a priced bill and asks to confirm, without saving anything', async () => {
    const res = await say('Ramu do kilo cheeni aur ek sabun');

    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('local');
    expect(lines(res.body.draft)).toEqual([
      ['Sugar (loose)', 2000],
      ['Lux Soap 100g', 1000],
    ]);
    // ₹92 + ₹38, calculated by the bill service, not by the assistant
    expect(res.body.draft.quote.totalPaise).toBe(13000);
    expect(res.body.reply).toMatch(/₹130/);
    expect(res.body.reply).toMatch(/Confirm/);
    expect(await Bill.countDocuments({ tenantId: shop.tenantId })).toBe(0);
  });

  it('shows Hinglish but speaks Devanagari Hindi, so a Hindi voice reads it', async () => {
    const res = await say('Patil ji ke udhaar mein ek sabun');

    expect(res.body.reply).toBe('1 item, kul ₹38. Suresh Patil ke khate mein. Confirm karun?');
    expect(res.body.speech).toBe('1 आइटम, कुल ₹38। Suresh Patil के खाते में। कन्फ़र्म करूँ?');
  });

  it('adds to the draft the app sends back ("aur ek sabun")', async () => {
    const draft = { items: [{ productId: soapId, quantityMilli: 1000 }] };

    const res = await say('aur ek sabun', { draft });

    expect(lines(res.body.draft)).toEqual([['Lux Soap 100g', 2000]]);
  });

  it('removes one item or clears the whole draft', async () => {
    const draft = { items: [{ productId: soapId, quantityMilli: 1000 }, { productId: sugarId, quantityMilli: 1000 }] };

    const removed = await say('sabun hatao', { draft });
    expect(lines(removed.body.draft)).toEqual([['Sugar (loose)', 1000]]);

    const cleared = await say('cancel', { draft });
    expect(cleared.body.draft).toBeNull();
  });

  it('writes an udhaar bill to the named customer', async () => {
    const res = await say('Patil ji ke udhaar mein ek sabun');

    expect(res.body.draft.paymentMode).toBe('udhaar');
    expect(res.body.draft.customer.name).toBe('Suresh Patil');
    expect(lines(res.body.draft)).toEqual([['Lux Soap 100g', 1000]]);
  });

  it('answers sales questions with numbers from code, and a card for the screen', async () => {
    await as(shop.accessToken).post('/api/bills', { items: [{ productId: soapId, quantityMilli: 2000 }], paymentMode: 'cash' });

    const res = await say('aaj ki bikri kitni hui');

    expect(res.body.card.kind).toBe('sales');
    expect(res.body.card.summary.salesPaise).toBe(7600);
    expect(res.body.reply).toMatch(/₹76/);
  });

  it('replies in Devanagari when spoken to in Devanagari', async () => {
    const res = await say('दो किलो चीनी');

    expect(lines(res.body.draft)).toEqual([['Sugar (loose)', 2000]]);
    expect(res.body.reply).toMatch(/कुल ₹92/);
  });

  it("ignores another shop's products in the draft the client sends", async () => {
    const other = await registerShop(app, otherShop);
    const theirs = (await as(other.accessToken).post('/api/products', { name: 'Ghee', unit: 'kg', pricePaise: 60000, gstRate: 5 })).body.id;

    const res = await say('ek sabun', { draft: { items: [{ productId: theirs, quantityMilli: 1000 }] } });

    expect(lines(res.body.draft)).toEqual([['Lux Soap 100g', 1000]]);
  });

  it('validates the message and requires login', async () => {
    expect((await say('   ')).status).toBe(400);
    expect((await request(app).post('/api/assistant/message').send({ message: 'hi' })).status).toBe(401);
  });
});

describe('POST /api/assistant/message (Claude agent)', () => {
  beforeEach(() => configured.mockReturnValue(true));

  it("lets the agent's tools build the draft, with totals from code", async () => {
    agent.mockImplementation(async ({ tools, catalogue }) => {
      const sugarRef = catalogue.find((c) => c.name === 'Sugar (loose)')!.ref;
      const update = tools.find((t) => t.name === 'update_bill_draft')!;
      const result = JSON.parse(
        (await update.run({
          items: [{ ref: sugarRef, quantity: 1.5, heard: 'dedh kilo cheeni' }],
          payment_mode: 'udhaar',
          customer_name: 'Suresh ji',
        })) as string,
      );
      return { reply: `Dedh kilo cheeni, kul ${result.total}. Confirm karun?`, speech: `डेढ़ किलो चीनी, कुल ${result.total}। कन्फ़र्म करूँ?` };
    });

    const res = await say('Suresh ke khate mein dedh kilo cheeni');

    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('claude');
    expect(res.body.reply).toBe('Dedh kilo cheeni, kul ₹69. Confirm karun?');
    expect(res.body.speech).toBe('डेढ़ किलो चीनी, कुल ₹69। कन्फ़र्म करूँ?');
    expect(lines(res.body.draft)).toEqual([['Sugar (loose)', 1500]]);
    expect(res.body.draft.customer.name).toBe('Suresh Patil');
    expect(await Bill.countDocuments({ tenantId: shop.tenantId })).toBe(0);
  });

  it('gives the agent no tool that can save a bill', async () => {
    agent.mockResolvedValue({ reply: 'ok', speech: 'ठीक' });
    await say('hello');

    const names = agent.mock.calls[0][0].tools.map((t) => t.name).sort();
    expect(names).toEqual(['clear_bill_draft', 'get_restock_suggestions', 'get_sales_summary', 'get_udhaar', 'update_bill_draft']);
  });

  it('drops refs the agent made up', async () => {
    agent.mockImplementation(async ({ tools }) => {
      await tools.find((t) => t.name === 'update_bill_draft')!.run({ items: [{ ref: 'P99', quantity: 1, heard: 'ghee' }] });
      return { reply: 'ok', speech: 'ठीक' };
    });

    const res = await say('ek ghee');

    expect(res.body.draft.items).toEqual([]);
    expect(res.body.draft.unmatched).toEqual(['ghee']);
  });

  it('falls back to the offline brain when Claude is unreachable', async () => {
    agent.mockRejectedValue(new AppError(503, 'Could not reach the voice service.'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await say('ek sabun');

    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('local');
    expect(lines(res.body.draft)).toEqual([['Lux Soap 100g', 1000]]);
  });

  it('reports whether AI is enabled', async () => {
    expect((await as(shop.accessToken).get('/api/assistant/status')).body).toEqual({ aiEnabled: true });
  });
});

describe('splitSpeech', () => {
  it('separates the screen text from the Hindi text to speak', () => {
    expect(splitSpeech('Kul ₹245. Confirm karun? <speak>कुल ₹245। कन्फ़र्म करूँ?</speak>')).toEqual({
      reply: 'Kul ₹245. Confirm karun?',
      speech: 'कुल ₹245। कन्फ़र्म करूँ?',
    });
  });

  it('speaks the reply itself when the tag is missing, and hides a cut-off tag', () => {
    expect(splitSpeech('Kul ₹245.')).toEqual({ reply: 'Kul ₹245.', speech: 'Kul ₹245.' });
    expect(splitSpeech('Kul ₹245. <speak>कुल')).toEqual({ reply: 'Kul ₹245.', speech: 'Kul ₹245.' });
  });
});

describe('Marathi shop (offline brain)', () => {
  beforeEach(() => configured.mockReturnValue(false));

  it('answers on screen and aloud in Marathi when the app language is Marathi', async () => {
    const res = await say('दोन किलो साखर', { language: 'mr' });

    expect(lines(res.body.draft)).toEqual([['Sugar (loose)', 2000]]);
    expect(res.body.reply).toBe('1 वस्तू, एकूण ₹92. कन्फर्म करू?');
    expect(res.body.speech).toBe(res.body.reply);
  });

  it('keeps Hindi for Devanagari when the app language is Hindi', async () => {
    const res = await say('दो किलो चीनी', { language: 'hi' });

    expect(res.body.reply).toBe('1 आइटम, कुल ₹92। कन्फ़र्म करूँ?');
  });

  it('rejects an unknown language', async () => {
    expect((await say('ek sabun', { language: 'fr' })).status).toBe(400);
  });
});

describe('customer names spoken in Devanagari', () => {
  beforeEach(() => configured.mockReturnValue(false));

  it('finds "Suresh Patil" when Marathi speech writes "सुरेश पाटील"', async () => {
    const res = await say('सुरेश पाटील च्या खात्यात एक साबण', { language: 'mr' });

    expect(res.body.draft.customer.name).toBe('Suresh Patil');
    expect(res.body.draft.paymentMode).toBe('udhaar');
    expect(lines(res.body.draft)).toEqual([['Lux Soap 100g', 1000]]);
    expect(res.body.reply).toBe('1 वस्तू, एकूण ₹38. Suresh Patil च्या खात्यात. कन्फर्म करू?');
  });
});
