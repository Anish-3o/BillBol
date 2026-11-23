import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { Bill } from '../src/models/Bill';
import { istDateKey, istDayStart } from '../src/services/insights.service';
import { otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) => request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
});

let shop: Awaited<ReturnType<typeof registerShop>>;
let owner: ReturnType<typeof as>;
let sugarId: string;
let soapId: string;

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
  owner = as(shop.accessToken);
  sugarId = (await owner.post('/api/products', { name: 'Sugar (loose)', unit: 'kg', pricePaise: 4600, gstRate: 5, stockMilli: 40000 })).body.id;
  soapId = (
    await owner.post('/api/products', { name: 'Lux Soap', unit: 'piece', pricePaise: 3800, gstRate: 5, stockMilli: 3000, lowStockMilli: 5000 })
  ).body.id;
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('IST day boundaries', () => {
  it('treats 01:30 IST as the new day even when the server clock is UTC', () => {
    const lateNightUtc = new Date('2026-11-20T20:00:00Z'); // 21 Nov, 01:30 in India
    expect(istDayStart(lateNightUtc).toISOString()).toBe('2026-11-20T18:30:00.000Z');
    expect(istDateKey(lateNightUtc)).toBe('2026-11-21');
    expect(istDayStart(lateNightUtc, -1).toISOString()).toBe('2026-11-19T18:30:00.000Z');
  });
});

describe('GET /api/insights/dashboard', () => {
  it('adds up today, yesterday and the week from real bills', async () => {
    // Today: 2 kg sugar (₹92) + 1 soap (₹38) = ₹130, cash
    await owner.post('/api/bills', {
      items: [{ productId: sugarId, quantityMilli: 2000 }, { productId: soapId, quantityMilli: 1000 }],
      paymentMode: 'cash',
    });
    // Moved to yesterday: 1 soap = ₹38, UPI
    const old = await owner.post('/api/bills', { items: [{ productId: soapId, quantityMilli: 1000 }], paymentMode: 'upi' });
    const yesterdayNoon = new Date(istDayStart(new Date(), -1).getTime() + 12 * 3600_000);
    await Bill.collection.updateOne({ _id: new Types.ObjectId(old.body.bill.id as string) }, { $set: { createdAt: yesterdayNoon } });

    const res = await owner.get('/api/insights/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.today).toMatchObject({ salesPaise: 13000, bills: 1, avgBillPaise: 13000 });
    expect(res.body.today.paymentSplit).toEqual([{ mode: 'cash', paise: 13000, bills: 1 }]);
    expect(res.body.yesterday).toMatchObject({ salesPaise: 3800, bills: 1 });
    expect(res.body.week).toMatchObject({ salesPaise: 16800, bills: 2 });
    expect(res.body.week.topProducts[0]).toMatchObject({ name: 'Sugar (loose)', salesPaise: 9200, quantityMilli: 2000 });

    // 14 days, oldest first, no gaps.
    expect(res.body.daily).toHaveLength(14);
    expect(res.body.daily.at(-1)).toMatchObject({ salesPaise: 13000, bills: 1 });
    expect(res.body.daily.at(-2)).toMatchObject({ salesPaise: 3800, bills: 1 });
    expect(res.body.daily[0]).toMatchObject({ salesPaise: 0, bills: 0 });

    expect(res.body.recentBills).toHaveLength(2);
    expect(res.body.productCount).toBe(2);
  });

  it('suggests restocking from stock level and sales speed, with an order quantity', async () => {
    // 2 of the 3 soaps sold: 1 left, below the level of 5.
    await owner.post('/api/bills', { items: [{ productId: soapId, quantityMilli: 2000 }], paymentMode: 'cash' });

    const res = await owner.get('/api/insights/dashboard');

    expect(res.body.restock).toHaveLength(1);
    const soap = res.body.restock[0];
    expect(soap).toMatchObject({ name: 'Lux Soap', stockMilli: 1000, urgency: 'critical' });
    // Sold 2 in 14 days -> 143 thousandths/day; a week of that plus the level, minus stock,
    // rounded up to whole pieces: 1001 + 5000 - 1000 = 5001 -> 6 pieces.
    expect(soap.dailyMilli).toBe(143);
    expect(soap.suggestedMilli).toBe(6000);
  });

  it('only ever shows the logged-in shop', async () => {
    await owner.post('/api/bills', { items: [{ productId: sugarId, quantityMilli: 1000 }], paymentMode: 'cash' });
    const other = await registerShop(app, otherShop);

    const res = await as(other.accessToken).get('/api/insights/dashboard');

    expect(res.body.today.salesPaise).toBe(0);
    expect(res.body.recentBills).toEqual([]);
    expect(res.body.restock).toEqual([]);
  });

  it('requires login', async () => {
    expect((await request(app).get('/api/insights/dashboard')).status).toBe(401);
  });
});
