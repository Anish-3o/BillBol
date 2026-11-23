import request from 'supertest';
import { createApp } from '../src/app';
import { Tenant } from '../src/models/Tenant';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  patch: (path: string, body: object) =>
    request(app).patch(path).set('Cookie', [`accessToken=${token}`]).send(body),
  post: (path: string, body: object) =>
    request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
});

let shop: Awaited<ReturnType<typeof registerShop>>;

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('PATCH /api/shop', () => {
  it('lets the owner set the UPI ID and address, returned with the session', async () => {
    const res = await as(shop.accessToken).patch('/api/shop', {
      upiId: 'SharmaKirana@OkAxis',
      address: 'Shop 4, Main Road, Pune',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ upiId: 'sharmakirana@okaxis', address: 'Shop 4, Main Road, Pune' });
    const me = await as(shop.accessToken).get('/api/auth/me');
    expect(me.body.tenant.upiId).toBe('sharmakirana@okaxis');
  });

  it('rejects something that is not a UPI ID', async () => {
    const res = await as(shop.accessToken).patch('/api/shop', { upiId: 'not a upi id' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.upiId).toBeDefined();
  });

  it('clears the UPI ID with an empty value', async () => {
    await as(shop.accessToken).patch('/api/shop', { upiId: 'shop@ybl' });

    const res = await as(shop.accessToken).patch('/api/shop', { upiId: '' });

    expect(res.status).toBe(200);
    expect(res.body.upiId).toBeNull();
  });

  it('clearing the GSTIN makes new bills untaxed, without touching old ones', async () => {
    const product = (
      await as(shop.accessToken).post('/api/products', { name: 'Soap', unit: 'piece', pricePaise: 3800, gstRate: 5 })
    ).body;
    const item = [{ productId: product.id, quantityMilli: 1000 }];
    const before = (await as(shop.accessToken).post('/api/bills', { items: item, paymentMode: 'cash' })).body.bill;

    await as(shop.accessToken).patch('/api/shop', { gstin: null });
    const after = (await as(shop.accessToken).post('/api/bills', { items: item, paymentMode: 'cash' })).body.bill;

    expect(before.taxMode).toBe('gst');
    expect(after.taxMode).toBe('none');
    expect((await as(shop.accessToken).get(`/api/bills/${before.id}`)).body.taxMode).toBe('gst');
  });

  it('refuses an empty update', async () => {
    expect((await as(shop.accessToken).patch('/api/shop', {})).status).toBe(400);
  });

  it('is owner-only', async () => {
    const staff = await createStaff(app, shop.tenantId);

    expect((await as(staff).patch('/api/shop', { upiId: 'thief@ybl' })).status).toBe(403);
  });

  it('only ever changes the logged-in shop, whatever id is sent', async () => {
    const other = await registerShop(app, otherShop);

    await as(shop.accessToken).patch('/api/shop', { id: other.tenantId, tenantId: other.tenantId, upiId: 'mine@ybl' });

    expect((await Tenant.findById(other.tenantId))!.upiId).toBeUndefined();
    expect((await Tenant.findById(shop.tenantId))!.upiId).toBe('mine@ybl');
  });
});
