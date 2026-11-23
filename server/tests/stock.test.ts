import request from 'supertest';
import { createApp } from '../src/app';
import { Product } from '../src/models/Product';
import { StockReceipt } from '../src/models/StockReceipt';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) =>
    request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
  delete: (path: string) => request(app).delete(path).set('Cookie', [`accessToken=${token}`]),
});

let shop: Awaited<ReturnType<typeof registerShop>>;
let maggi: string;
let sugar: string;

const stockOf = async (id: string) => (await Product.findOne({ _id: id, tenantId: shop.tenantId }))!.stockMilli;

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
  const add = async (body: object) => (await as(shop.accessToken).post('/api/products', body)).body.id as string;
  maggi = await add({ name: 'Maggi', unit: 'packet', pricePaise: 1400, gstRate: 5, stockMilli: 2000 });
  sugar = await add({ name: 'Sugar', unit: 'kg', pricePaise: 4600, gstRate: 5, stockMilli: 1000 });
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('POST /api/stock/receive', () => {
  it('adds the goods to stock and keeps a receipt', async () => {
    const res = await as(shop.accessToken).post('/api/stock/receive', {
      items: [
        { productId: maggi, quantityMilli: 48000 },
        { productId: sugar, quantityMilli: 25000 },
      ],
      supplier: 'Gupta Traders',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ supplier: 'Gupta Traders', createdByName: 'Ramesh Sharma' });
    expect(res.body.items).toEqual([
      { productId: maggi, name: 'Maggi', unit: 'packet', quantityMilli: 48000 },
      { productId: sugar, name: 'Sugar', unit: 'kg', quantityMilli: 25000 },
    ]);
    expect(await stockOf(maggi)).toBe(50000);
    expect(await stockOf(sugar)).toBe(26000);
  });

  it('merges the same product scanned several times into one line', async () => {
    const res = await as(shop.accessToken).post('/api/stock/receive', {
      items: [
        { productId: maggi, quantityMilli: 1000 },
        { productId: maggi, quantityMilli: 1000 },
      ],
    });

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].quantityMilli).toBe(2000);
    expect(await stockOf(maggi)).toBe(4000);
  });

  it('lets staff receive goods, recording who did', async () => {
    const staff = await createStaff(app, shop.tenantId);

    const res = await as(staff).post('/api/stock/receive', { items: [{ productId: maggi, quantityMilli: 12000 }] });

    expect(res.status).toBe(201);
    expect(res.body.createdByName).toBe('Staff Member');
  });

  it('refuses half a packet, and changes nothing', async () => {
    const res = await as(shop.accessToken).post('/api/stock/receive', {
      items: [
        { productId: sugar, quantityMilli: 5000 },
        { productId: maggi, quantityMilli: 1500 },
      ],
    });

    expect(res.status).toBe(400);
    // The whole receipt is one transaction: the valid sugar line was not applied either.
    expect(await stockOf(sugar)).toBe(1000);
    expect(await StockReceipt.countDocuments({ tenantId: shop.tenantId })).toBe(0);
  });

  it("refuses another shop's product", async () => {
    const other = await registerShop(app, otherShop);

    const res = await as(other.accessToken).post('/api/stock/receive', { items: [{ productId: maggi, quantityMilli: 1000 }] });

    expect(res.status).toBe(400);
    expect(await stockOf(maggi)).toBe(2000);
  });

  it('refuses an archived product', async () => {
    await as(shop.accessToken).delete(`/api/products/${maggi}`);

    const res = await as(shop.accessToken).post('/api/stock/receive', { items: [{ productId: maggi, quantityMilli: 1000 }] });

    expect(res.status).toBe(400);
  });

  it('needs at least one item', async () => {
    expect((await as(shop.accessToken).post('/api/stock/receive', { items: [] })).status).toBe(400);
  });
});

describe('GET /api/stock/receipts', () => {
  it("lists this shop's receipts, newest first, and never another shop's", async () => {
    await as(shop.accessToken).post('/api/stock/receive', { items: [{ productId: maggi, quantityMilli: 1000 }], supplier: 'First' });
    await as(shop.accessToken).post('/api/stock/receive', { items: [{ productId: maggi, quantityMilli: 1000 }], supplier: 'Second' });
    const other = await registerShop(app, otherShop);

    const mine = await as(shop.accessToken).get('/api/stock/receipts');
    const theirs = await as(other.accessToken).get('/api/stock/receipts');

    expect(mine.body.map((r: { supplier: string }) => r.supplier)).toEqual(['Second', 'First']);
    expect(theirs.body).toEqual([]);
  });
});
