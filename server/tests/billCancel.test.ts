import request from 'supertest';
import { createApp } from '../src/app';
import { Bill } from '../src/models/Bill';
import { Customer } from '../src/models/Customer';
import { LedgerEntry } from '../src/models/LedgerEntry';
import { Product } from '../src/models/Product';
import { STAFF_CANCEL_WINDOW_MS } from '../src/services/bill.service';
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
let soap: string;
let sugar: string;

const stockOf = async (id: string) => (await Product.findOne({ _id: id, tenantId: shop.tenantId }))!.stockMilli;

async function makeBill(token: string, extra: object = {}) {
  const res = await as(token).post('/api/bills', {
    items: [
      { productId: soap, quantityMilli: 3000 },
      { productId: sugar, quantityMilli: 1500 },
    ],
    paymentMode: 'cash',
    ...extra,
  });
  if (res.status !== 201) throw new Error(`bill failed: ${JSON.stringify(res.body)}`);
  return res.body.bill as { id: string; totalPaise: number; number: string };
}

const cancel = (token: string, id: string, reason = 'Wrong item') =>
  as(token).post(`/api/bills/${id}/cancel`, { reason });

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
  const add = async (body: object) => (await as(shop.accessToken).post('/api/products', body)).body.id as string;
  soap = await add({ name: 'Lux Soap', unit: 'piece', pricePaise: 3800, gstRate: 5, stockMilli: 10000 });
  sugar = await add({ name: 'Sugar', unit: 'kg', pricePaise: 4600, gstRate: 5, stockMilli: 25000 });
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('POST /api/bills/:id/cancel', () => {
  it('marks the bill cancelled, with who, when and why', async () => {
    const bill = await makeBill(shop.accessToken);

    const res = await cancel(shop.accessToken, bill.id, 'Customer returned the goods');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.cancelled).toMatchObject({ byName: 'Ramesh Sharma', reason: 'Customer returned the goods' });
    expect(res.body.totalPaise).toBe(bill.totalPaise); // the record itself is unchanged
    const detail = await as(shop.accessToken).get(`/api/bills/${bill.id}`);
    expect(detail.body.status).toBe('cancelled');
  });

  it('puts every item back in stock', async () => {
    const bill = await makeBill(shop.accessToken);
    expect(await stockOf(soap)).toBe(7000);

    await cancel(shop.accessToken, bill.id);

    expect(await stockOf(soap)).toBe(10000);
    expect(await stockOf(sugar)).toBe(25000);
  });

  it('restores stock even for a product archived since the sale', async () => {
    const bill = await makeBill(shop.accessToken);
    await as(shop.accessToken).delete(`/api/products/${soap}`);

    await cancel(shop.accessToken, bill.id);

    expect(await stockOf(soap)).toBe(10000);
  });

  it("takes an udhaar bill off the customer's khata with a reversing entry", async () => {
    const customer = (await as(shop.accessToken).post('/api/customers', { name: 'Sunita' })).body;
    const bill = await makeBill(shop.accessToken, { paymentMode: 'udhaar', customerId: customer.id });
    expect((await Customer.findOne({ _id: customer.id, tenantId: shop.tenantId }))!.balancePaise).toBe(bill.totalPaise);

    await cancel(shop.accessToken, bill.id, 'Wrong customer');

    expect((await Customer.findOne({ _id: customer.id, tenantId: shop.tenantId }))!.balancePaise).toBe(0);
    const entries = await LedgerEntry.find({ tenantId: shop.tenantId, customerId: customer.id }).sort({ createdAt: 1, _id: 1 });
    // The original line stays; a new line reverses it (append-only khata).
    expect(entries.map((e) => e.type)).toEqual(['credit_sale', 'bill_cancelled']);
    expect(entries[1]).toMatchObject({ amountPaise: bill.totalPaise, balanceAfterPaise: 0, billNumber: bill.number, note: 'Wrong customer' });
  });

  it('leaves cancelled bills out of sales numbers', async () => {
    const kept = await makeBill(shop.accessToken);
    const wrong = await makeBill(shop.accessToken);

    await cancel(shop.accessToken, wrong.id);

    const res = await as(shop.accessToken).get('/api/insights/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.today).toMatchObject({ salesPaise: kept.totalPaise, bills: 1 });
  });

  it('keeps the cancelled bill in the list, marked as cancelled', async () => {
    const bill = await makeBill(shop.accessToken);
    await cancel(shop.accessToken, bill.id);

    const res = await as(shop.accessToken).get('/api/bills');

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ number: bill.number, status: 'cancelled' });
  });

  it('refuses to cancel twice, so stock is never restored twice', async () => {
    const bill = await makeBill(shop.accessToken);
    await cancel(shop.accessToken, bill.id);

    const res = await cancel(shop.accessToken, bill.id);

    expect(res.status).toBe(409);
    expect(await stockOf(soap)).toBe(10000);
  });

  it('handles two cancels at the same moment: exactly one wins', async () => {
    const bill = await makeBill(shop.accessToken);

    const results = await Promise.all([cancel(shop.accessToken, bill.id), cancel(shop.accessToken, bill.id)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await stockOf(soap)).toBe(10000);
  });

  it('needs a reason', async () => {
    const bill = await makeBill(shop.accessToken);

    const res = await as(shop.accessToken).post(`/api/bills/${bill.id}/cancel`, { reason: '  ' });

    expect(res.status).toBe(400);
    expect(await stockOf(soap)).toBe(7000);
  });

  it("says 404 for another shop's bill and leaves it alone", async () => {
    const bill = await makeBill(shop.accessToken);
    const other = await registerShop(app, otherShop);

    const res = await cancel(other.accessToken, bill.id);

    expect(res.status).toBe(404);
    expect((await Bill.findOne({ _id: bill.id, tenantId: shop.tenantId }))!.status).toBe('active');
  });

  it('says 404 for a malformed id', async () => {
    expect((await cancel(shop.accessToken, 'nope')).status).toBe(404);
  });

  describe('staff', () => {
    let staff: string;
    beforeEach(async () => {
      staff = await createStaff(app, shop.tenantId);
    });

    it('can cancel their own bill within 10 minutes', async () => {
      const bill = await makeBill(staff);

      expect((await cancel(staff, bill.id)).status).toBe(200);
    });

    it('cannot cancel their own bill after 10 minutes', async () => {
      const bill = await makeBill(staff);
      // Straight to the collection: Mongoose would not let us rewrite createdAt.
      await Bill.collection.updateOne(
        { _id: new (await import('mongoose')).Types.ObjectId(bill.id) },
        { $set: { createdAt: new Date(Date.now() - STAFF_CANCEL_WINDOW_MS - 60_000) } },
      );

      const res = await cancel(staff, bill.id);

      expect(res.status).toBe(403);
      expect(await stockOf(soap)).toBe(7000);
    });

    it("cannot cancel someone else's bill", async () => {
      const bill = await makeBill(shop.accessToken);

      expect((await cancel(staff, bill.id)).status).toBe(403);
    });

    it('the owner can cancel a staff bill at any time', async () => {
      const bill = await makeBill(staff);

      expect((await cancel(shop.accessToken, bill.id)).status).toBe(200);
    });
  });
});
