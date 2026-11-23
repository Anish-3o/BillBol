import request from 'supertest';
import { createApp } from '../src/app';
import { ean13, seedBarcode } from '../src/scripts/seedProducts';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) =>
    request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set('Cookie', [`accessToken=${token}`]).send(body),
  delete: (path: string) => request(app).delete(path).set('Cookie', [`accessToken=${token}`]),
});

const MAGGI_CODE = '8901058000290';
const maggi = {
  name: 'Maggi Noodles 70g',
  unit: 'packet',
  pricePaise: 1400,
  gstRate: 5,
  stockMilli: 60000,
  barcode: MAGGI_CODE,
};
const salt = { name: 'Tata Salt 1kg', unit: 'packet', pricePaise: 2800, gstRate: 0 };

let owner: string;
let tenantId: string;

beforeAll(connectTestDB);
beforeEach(async () => {
  const shop = await registerShop(app);
  owner = shop.accessToken;
  tenantId = shop.tenantId;
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('product barcodes', () => {
  it('stores a barcode and returns it with the product', async () => {
    const res = await as(owner).post('/api/products', maggi);

    expect(res.status).toBe(201);
    expect(res.body.barcode).toBe(MAGGI_CODE);
  });

  it('treats a missing or empty barcode as none', async () => {
    const a = await as(owner).post('/api/products', salt);
    const b = await as(owner).post('/api/products', { ...maggi, barcode: '' });

    // Two products without a barcode must not collide on the unique index.
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.barcode).toBeNull();
    expect(b.body.barcode).toBeNull();
  });

  it('rejects a barcode with spaces or symbols', async () => {
    const res = await as(owner).post('/api/products', { ...maggi, barcode: '8901 0580' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.barcode).toBeDefined();
  });

  it('refuses the same barcode on two products of one shop, naming the field', async () => {
    await as(owner).post('/api/products', maggi);

    const res = await as(owner).post('/api/products', { ...salt, barcode: MAGGI_CODE });

    expect(res.status).toBe(409);
    expect(res.body.error.details.barcode).toEqual(['This barcode is already used by another product']);
  });

  it('lets two different shops use the same barcode', async () => {
    const other = await registerShop(app, otherShop);
    await as(owner).post('/api/products', maggi);

    const res = await as(other.accessToken).post('/api/products', maggi);

    expect(res.status).toBe(201);
  });

  it("frees an archived product's barcode for reuse", async () => {
    const first = await as(owner).post('/api/products', maggi);
    await as(owner).delete(`/api/products/${first.body.id}`);

    const res = await as(owner).post('/api/products', { ...salt, barcode: MAGGI_CODE });

    expect(res.status).toBe(201);
  });

  it('can clear a barcode with null', async () => {
    const created = await as(owner).post('/api/products', maggi);

    const res = await as(owner).patch(`/api/products/${created.body.id}`, { barcode: null });

    expect(res.status).toBe(200);
    expect(res.body.barcode).toBeNull();
    // Cleared means gone: it no longer scans, and another product may take it.
    expect((await as(owner).get(`/api/products/barcode/${MAGGI_CODE}`)).status).toBe(404);
    expect((await as(owner).post('/api/products', { ...salt, barcode: MAGGI_CODE })).status).toBe(201);
  });
});

describe('GET /api/products/barcode/:code', () => {
  it('finds the product for a scanned code', async () => {
    const created = await as(owner).post('/api/products', maggi);

    const res = await as(owner).get(`/api/products/barcode/${MAGGI_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, name: 'Maggi Noodles 70g', pricePaise: 1400 });
  });

  it('works for staff, who scan at the counter', async () => {
    await as(owner).post('/api/products', maggi);
    const staff = await createStaff(app, tenantId);

    const res = await as(staff).get(`/api/products/barcode/${MAGGI_CODE}`);

    expect(res.status).toBe(200);
  });

  it('says 404 for an unknown code', async () => {
    const res = await as(owner).get('/api/products/barcode/1234567890128');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('No product with this barcode');
  });

  it('says 404, not 400, for a code that could never be stored', async () => {
    const res = await as(owner).get(`/api/products/barcode/${encodeURIComponent('abc$')}`);

    expect(res.status).toBe(404);
  });

  it("never finds another shop's product", async () => {
    const other = await registerShop(app, otherShop);
    await as(other.accessToken).post('/api/products', maggi);

    const res = await as(owner).get(`/api/products/barcode/${MAGGI_CODE}`);

    expect(res.status).toBe(404);
  });

  it('does not find an archived product', async () => {
    const created = await as(owner).post('/api/products', maggi);
    await as(owner).delete(`/api/products/${created.body.id}`);

    const res = await as(owner).get(`/api/products/barcode/${MAGGI_CODE}`);

    expect(res.status).toBe(404);
  });

  it('needs login', async () => {
    const res = await request(app).get(`/api/products/barcode/${MAGGI_CODE}`);

    expect(res.status).toBe(401);
  });
});

describe('searching products by barcode', () => {
  it('matches a full barcode typed into the search box', async () => {
    await as(owner).post('/api/products', maggi);
    await as(owner).post('/api/products', salt);

    const res = await as(owner).get(`/api/products?q=${MAGGI_CODE}`);

    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Maggi Noodles 70g']);
  });

  it('does not match part of a barcode', async () => {
    await as(owner).post('/api/products', maggi);

    const res = await as(owner).get('/api/products?q=8901');

    expect(res.body.items).toEqual([]);
  });
});

describe('demo barcodes', () => {
  it('computes the EAN-13 check digit', () => {
    // The standard worked example of an EAN-13 code.
    expect(ean13('400638133393')).toBe('4006381333931');
  });

  it('gives packaged goods an in-store (200) code and loose goods none', () => {
    const packet = { name: 'X', localName: 'x', unit: 'packet', price: 1, gstRate: 0, hsn: '1234', stock: 1, lowStock: 0 };

    expect(seedBarcode(packet, 0)).toMatch(/^200000000001\d$/);
    expect(seedBarcode({ ...packet, unit: 'kg' }, 0)).toBeNull();
  });
});
