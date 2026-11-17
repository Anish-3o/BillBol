import request from 'supertest';
import { extractVoiceOrder, type CatalogueEntry } from '../src/ai/voiceOrder';
import { createApp } from '../src/app';
import { Bill } from '../src/models/Bill';
import { Product } from '../src/models/Product';
import { AppError } from '../src/utils/AppError';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

// The Claude call is mocked: these tests cover everything around it - which catalogue is
// sent, and how the model's answer is checked and turned into a draft.
jest.mock('../src/ai/voiceOrder', () => ({
  ...jest.requireActual('../src/ai/voiceOrder'),
  extractVoiceOrder: jest.fn(),
}));
const extract = jest.mocked(extractVoiceOrder);

const app = createApp();
let shop: Awaited<ReturnType<typeof registerShop>>;

const post = (token: string, path: string, body: object) =>
  request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body);
const draft = (transcript: string, token = shop.accessToken) =>
  post(token, '/api/bills/voice-draft', { transcript });

// Refs are assigned per request, so tests look them up by product name.
const refOf = (catalogue: CatalogueEntry[], name: string) => catalogue.find((c) => c.name === name)!.ref;

async function addProduct(token: string, body: object) {
  return (await post(token, '/api/products', body)).body.id as string;
}

beforeAll(connectTestDB);
beforeEach(async () => {
  extract.mockReset();
  shop = await registerShop(app);
  await addProduct(shop.accessToken, { name: 'Sugar (loose)', localName: 'चीनी', unit: 'kg', pricePaise: 4600, gstRate: 5, stockMilli: 40000 });
  await addProduct(shop.accessToken, { name: 'Lux Soap 100g', localName: 'साबुन', unit: 'piece', pricePaise: 3800, gstRate: 5, stockMilli: 20000 });
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('POST /api/bills/voice-draft', () => {
  it("turns the model's answer into draft cart lines with full product details", async () => {
    extract.mockImplementation(async (_t, catalogue) => ({
      items: [
        { ref: refOf(catalogue, 'Sugar (loose)'), quantity: 1.5, heard: 'dedh kilo cheeni' },
        { ref: refOf(catalogue, 'Lux Soap 100g'), quantity: 2, heard: 'do sabun' },
      ],
      unmatched: ['parle-g'],
    }));

    const res = await draft('dedh kilo cheeni, do sabun aur ek parle-g');

    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe('dedh kilo cheeni, do sabun aur ek parle-g');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      quantityMilli: 1500,
      heard: 'dedh kilo cheeni',
      product: { name: 'Sugar (loose)', unit: 'kg', pricePaise: 4600 },
    });
    expect(res.body.items[1]).toMatchObject({ quantityMilli: 2000, product: { name: 'Lux Soap 100g' } });
    expect(res.body.unmatched).toEqual(['parle-g']);
  });

  it("sends only this shop's active products, sorted, with short refs", async () => {
    const archived = await addProduct(shop.accessToken, { name: 'Old Stock', unit: 'piece', pricePaise: 100, gstRate: 5 });
    await request(app).delete(`/api/products/${archived}`).set('Cookie', [`accessToken=${shop.accessToken}`]);
    const other = await registerShop(app, otherShop);
    await addProduct(other.accessToken, { name: 'Other Shop Item', unit: 'piece', pricePaise: 100, gstRate: 5 });
    extract.mockResolvedValue({ items: [], unmatched: [] });

    await draft('kuch bhi');

    expect(extract).toHaveBeenCalledWith('kuch bhi', [
      { ref: 'P1', name: 'Lux Soap 100g', localName: 'साबुन', unit: 'piece' },
      { ref: 'P2', name: 'Sugar (loose)', localName: 'चीनी', unit: 'kg' },
    ]);
  });

  it('never trusts the model: unknown refs and bad quantities become "not found"', async () => {
    extract.mockImplementation(async (_t, catalogue) => ({
      items: [
        { ref: 'P99', quantity: 1, heard: 'invented item' },
        { ref: refOf(catalogue, 'Sugar (loose)'), quantity: 0, heard: 'zero sugar' },
        { ref: refOf(catalogue, 'Sugar (loose)'), quantity: -2, heard: 'minus sugar' },
      ],
      unmatched: [],
    }));

    const res = await draft('test');

    expect(res.body.items).toEqual([]);
    expect(res.body.unmatched).toEqual(['invented item', 'zero sugar', 'minus sugar']);
  });

  it('rounds count units to whole numbers and merges repeated items', async () => {
    extract.mockImplementation(async (_t, catalogue) => ({
      items: [
        { ref: refOf(catalogue, 'Lux Soap 100g'), quantity: 1.6, heard: 'dedh sabun' },
        { ref: refOf(catalogue, 'Lux Soap 100g'), quantity: 0.2, heard: 'thoda sabun' },
        { ref: refOf(catalogue, 'Sugar (loose)').toLowerCase(), quantity: 0.25, heard: 'paav cheeni' },
      ],
      unmatched: [],
    }));

    const res = await draft('test');

    expect(res.body.items).toHaveLength(2);
    // 1.6 -> 2 pieces, 0.2 -> at least 1 piece, merged into one line of 3
    expect(res.body.items[0]).toMatchObject({ quantityMilli: 3000, heard: 'dedh sabun, thoda sabun' });
    // refs are matched case-insensitively; kg keeps decimals
    expect(res.body.items[1]).toMatchObject({ quantityMilli: 250, product: { name: 'Sugar (loose)' } });
  });

  it('only drafts: saves no bill and leaves stock alone (Rule 2)', async () => {
    extract.mockImplementation(async (_t, catalogue) => ({
      items: [{ ref: refOf(catalogue, 'Sugar (loose)'), quantity: 5, heard: 'paanch kilo cheeni' }],
      unmatched: [],
    }));

    await draft('paanch kilo cheeni');

    expect(await Bill.countDocuments({ tenantId: shop.tenantId })).toBe(0);
    const sugar = await Product.findOne({ tenantId: shop.tenantId, name: 'Sugar (loose)' });
    expect(sugar!.stockMilli).toBe(40000);
  });

  it('asks for products first when the shop has none, without calling the model', async () => {
    const empty = await registerShop(app, otherShop);

    const res = await draft('ek kilo cheeni', empty.accessToken);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Add products first/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('passes on a clear error when voice billing is not set up', async () => {
    extract.mockRejectedValue(new AppError(503, 'Voice billing is not set up yet: add LLM_API_KEY to server/.env'));

    const res = await draft('ek kilo cheeni');

    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/LLM_API_KEY/);
  });

  it('validates the transcript', async () => {
    expect((await draft('   ')).status).toBe(400);
    expect((await draft('x'.repeat(501))).status).toBe(400);
    expect(extract).not.toHaveBeenCalled();
  });

  it('works for staff and requires login', async () => {
    extract.mockResolvedValue({ items: [], unmatched: [] });
    const staff = await createStaff(app, shop.tenantId);

    expect((await draft('ek kilo cheeni', staff)).status).toBe(200);
    expect((await request(app).post('/api/bills/voice-draft').send({ transcript: 'x' })).status).toBe(401);
  });
});
