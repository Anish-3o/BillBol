import request from 'supertest';
import { createApp } from '../src/app';
import { Bill } from '../src/models/Bill';
import { Counter } from '../src/models/Counter';
import { Product } from '../src/models/Product';
import { financialYear } from '../src/services/gst';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();
const FY = financialYear(new Date());

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) =>
    request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
});

// validShop has a GSTIN (registered -> GST breakup); otherShop has none (no GST).
let shop: Awaited<ReturnType<typeof registerShop>>;
let ids: { soap: string; sugar: string; rice: string };

async function addProducts(token: string) {
  const add = async (body: object) => (await as(token).post('/api/products', body)).body.id as string;
  return {
    soap: await add({ name: 'Lux Soap', unit: 'piece', pricePaise: 3800, gstRate: 5, stockMilli: 10000 }),
    sugar: await add({ name: 'Sugar', unit: 'kg', pricePaise: 4600, gstRate: 5, stockMilli: 25000 }),
    rice: await add({ name: 'Rice', unit: 'kg', pricePaise: 11000, gstRate: 0, stockMilli: 50000 }),
  };
}

const stockOf = async (id: string) =>
  (await Product.findOne({ _id: id, tenantId: shop.tenantId }))!.stockMilli;

// 3 soaps, 1.25 kg sugar, 2 kg rice
const basket = () => [
  { productId: ids.soap, quantityMilli: 3000 },
  { productId: ids.sugar, quantityMilli: 1250 },
  { productId: ids.rice, quantityMilli: 2000 },
];

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
  ids = await addProducts(shop.accessToken);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDB();
});
afterAll(closeTestDB);

describe('POST /api/bills/quote', () => {
  it('prices the items and splits GST for a registered shop', async () => {
    const res = await as(shop.accessToken).post('/api/bills/quote', { items: basket() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      taxMode: 'gst',
      totalPaise: 39150, // 114 + 57.50 + 220
      taxablePaise: 38334,
      cgstPaise: 408,
      sgstPaise: 408,
      stockWarnings: [],
    });
    expect(res.body.lines[1]).toMatchObject({
      name: 'Sugar',
      quantityMilli: 1250,
      unitPricePaise: 4600,
      totalPaise: 5750,
    });
  });

  it('charges no GST for a shop without a GSTIN', async () => {
    const other = await registerShop(app, otherShop);
    const otherIds = await addProducts(other.accessToken);

    const res = await as(other.accessToken).post('/api/bills/quote', {
      items: [{ productId: otherIds.soap, quantityMilli: 3000 }],
    });

    expect(res.body).toMatchObject({
      taxMode: 'none',
      totalPaise: 11400,
      taxablePaise: 11400,
      cgstPaise: 0,
      sgstPaise: 0,
    });
  });

  it('saves nothing and does not touch stock', async () => {
    await as(shop.accessToken).post('/api/bills/quote', { items: basket() });

    expect(await Bill.countDocuments({ tenantId: shop.tenantId })).toBe(0);
    expect(await stockOf(ids.soap)).toBe(10000);
  });

  it('ignores prices sent by the client', async () => {
    const res = await as(shop.accessToken).post('/api/bills/quote', {
      items: [{ productId: ids.soap, quantityMilli: 1000, unitPricePaise: 1 }],
    });

    expect(res.body.totalPaise).toBe(3800);
  });

  it('merges the same product added twice into one line', async () => {
    const res = await as(shop.accessToken).post('/api/bills/quote', {
      items: [
        { productId: ids.soap, quantityMilli: 1000 },
        { productId: ids.sugar, quantityMilli: 500 },
        { productId: ids.soap, quantityMilli: 2000 },
      ],
    });

    expect(res.body.lines.map((l: { name: string }) => l.name)).toEqual(['Lux Soap', 'Sugar']);
    expect(res.body.lines[0].quantityMilli).toBe(3000);
  });

  it('keeps CGST equal to SGST across a whole bill', async () => {
    // ₹46 + ₹38 at 5%: rounding an odd paisa to one side on every line used to give
    // CGST ₹1.99 / SGST ₹2.01 here.
    const res = await as(shop.accessToken).post('/api/bills/quote', {
      items: [
        { productId: ids.sugar, quantityMilli: 1000 },
        { productId: ids.soap, quantityMilli: 1000 },
      ],
    });

    expect(res.body).toMatchObject({ totalPaise: 8400, cgstPaise: 200, sgstPaise: 200, taxablePaise: 8000 });
  });

  it('rejects half a soap', async () => {
    const res = await as(shop.accessToken).post('/api/bills/quote', {
      items: [{ productId: ids.soap, quantityMilli: 1500 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Lux Soap: quantity must be a whole number of pieces');
  });

  it('rejects an empty bill and bad quantities', async () => {
    expect((await as(shop.accessToken).post('/api/bills/quote', { items: [] })).status).toBe(400);
    const res = await as(shop.accessToken).post('/api/bills/quote', {
      items: [{ productId: ids.soap, quantityMilli: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an archived product', async () => {
    await request(app)
      .delete(`/api/products/${ids.soap}`)
      .set('Cookie', [`accessToken=${shop.accessToken}`]);

    const res = await as(shop.accessToken).post('/api/bills/quote', {
      items: [{ productId: ids.soap, quantityMilli: 1000 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no longer available/);
  });

  it('warns, but does not block, when selling more than the recorded stock', async () => {
    const res = await as(shop.accessToken).post('/api/bills/quote', {
      items: [{ productId: ids.soap, quantityMilli: 12000 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.stockWarnings).toEqual([
      expect.objectContaining({ name: 'Lux Soap', stockMilli: 10000, requestedMilli: 12000 }),
    ]);
  });
});

describe('POST /api/bills', () => {
  it('saves the bill with a number and takes the items out of stock', async () => {
    const res = await as(shop.accessToken).post('/api/bills', {
      items: basket(),
      paymentMode: 'upi',
    });

    expect(res.status).toBe(201);
    expect(res.body.bill).toMatchObject({
      number: `${FY}/0001`,
      taxMode: 'gst',
      totalPaise: 39150,
      paymentMode: 'upi',
      createdByName: 'Ramesh Sharma',
    });
    expect(res.body.bill.items).toHaveLength(3);
    expect(await stockOf(ids.soap)).toBe(7000);
    expect(await stockOf(ids.sugar)).toBe(23750);
    expect(await stockOf(ids.rice)).toBe(48000);
  });

  it('numbers bills one after another', async () => {
    const first = await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cash' });
    const second = await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cash' });

    expect(first.body.bill.number).toBe(`${FY}/0001`);
    expect(second.body.bill.number).toBe(`${FY}/0002`);
  });

  it('gives unique numbers and correct stock when bills are made at the same moment', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        as(shop.accessToken).post('/api/bills', {
          items: [{ productId: ids.soap, quantityMilli: 1000 }],
          paymentMode: 'cash',
        }),
      ),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const numbers = results.map((r) => r.body.bill.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `${FY}/000${n}`));
    expect(await stockOf(ids.soap)).toBe(5000);
  });

  it('numbers each shop separately', async () => {
    const other = await registerShop(app, otherShop);
    const otherIds = await addProducts(other.accessToken);
    await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cash' });

    const res = await as(other.accessToken).post('/api/bills', {
      items: [{ productId: otherIds.rice, quantityMilli: 1000 }],
      paymentMode: 'cash',
    });

    expect(res.body.bill.number).toBe(`${FY}/0001`);
  });

  it('lets stock go negative and returns a warning', async () => {
    const res = await as(shop.accessToken).post('/api/bills', {
      items: [{ productId: ids.soap, quantityMilli: 12000 }],
      paymentMode: 'cash',
    });

    expect(res.status).toBe(201);
    expect(res.body.stockWarnings).toHaveLength(1);
    expect(await stockOf(ids.soap)).toBe(-2000);
  });

  it('keeps the price at the time of sale when the product price changes later', async () => {
    const created = await as(shop.accessToken).post('/api/bills', {
      items: [{ productId: ids.soap, quantityMilli: 1000 }],
      paymentMode: 'cash',
    });
    await request(app)
      .patch(`/api/products/${ids.soap}`)
      .set('Cookie', [`accessToken=${shop.accessToken}`])
      .send({ pricePaise: 5000, name: 'Lux Soap Renamed' });

    const bill = await as(shop.accessToken).get(`/api/bills/${created.body.bill.id}`);

    expect(bill.body.items[0]).toMatchObject({ name: 'Lux Soap', unitPricePaise: 3800 });
    expect(bill.body.totalPaise).toBe(3800);
  });

  it('is all-or-nothing: a failure halfway saves no bill, no stock change and no number', async () => {
    // Make the stock update for the SECOND line fail, after the bill and the first stock
    // update have already been written inside the transaction.
    const realUpdateOne = Product.updateOne.bind(Product);
    let calls = 0;
    jest.spyOn(Product, 'updateOne').mockImplementation(((...args: Parameters<typeof Product.updateOne>) => {
      calls += 1;
      if (calls === 2) throw new Error('Simulated crash during stock update');
      return realUpdateOne(...args);
    }) as typeof Product.updateOne);

    const failed = await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cash' });

    expect(failed.status).toBe(500);
    expect(await Bill.countDocuments({ tenantId: shop.tenantId })).toBe(0);
    expect(await stockOf(ids.soap)).toBe(10000); // first line's stock change rolled back
    expect((await Counter.findOne({ tenantId: shop.tenantId }))?.seq ?? 0).toBe(0);

    // The next bill still gets number 0001: no gap in the sequence.
    jest.restoreAllMocks();
    const ok = await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cash' });
    expect(ok.body.bill.number).toBe(`${FY}/0001`);
  });

  it('requires a valid payment mode', async () => {
    const res = await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cheque' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('paymentMode');
  });

  it('lets staff make bills, recorded under their name', async () => {
    const staff = await createStaff(app, shop.tenantId);

    const res = await as(staff).post('/api/bills', { items: basket(), paymentMode: 'cash' });

    expect(res.status).toBe(201);
    expect(res.body.bill.createdByName).toBe('Staff Member');
  });

  it('requires login', async () => {
    expect((await request(app).post('/api/bills').send({ items: basket() })).status).toBe(401);
  });
});

describe('GET /api/bills', () => {
  it('lists bills newest first, with paging', async () => {
    for (let i = 0; i < 3; i++) {
      await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cash' });
    }

    const res = await as(shop.accessToken).get('/api/bills?limit=2');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((b: { number: string }) => b.number)).toEqual([
      `${FY}/0003`,
      `${FY}/0002`,
    ]);
    expect(res.body.items[0]).toMatchObject({ itemCount: 3, totalPaise: 39150 });
  });

  it('returns 404 for an unknown or malformed bill id', async () => {
    expect((await as(shop.accessToken).get('/api/bills/665f1c2b9a1e4b0012345678')).status).toBe(404);
    expect((await as(shop.accessToken).get('/api/bills/nope')).status).toBe(404);
  });
});

describe('tenant isolation', () => {
  it("cannot bill, list or read another shop's products and bills", async () => {
    const created = await as(shop.accessToken).post('/api/bills', { items: basket(), paymentMode: 'cash' });
    const other = await registerShop(app, otherShop);
    const intruder = as(other.accessToken);

    // Billing shop A's product from shop B fails like an unknown product, and A's stock is untouched.
    const steal = await intruder.post('/api/bills', {
      items: [{ productId: ids.rice, quantityMilli: 1000 }],
      paymentMode: 'cash',
    });
    expect(steal.status).toBe(400);
    expect(await stockOf(ids.rice)).toBe(48000);

    expect((await intruder.get('/api/bills')).body.total).toBe(0);
    expect((await intruder.get(`/api/bills/${created.body.bill.id}`)).status).toBe(404);
  });
});
