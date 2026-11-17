import request from 'supertest';
import { createApp } from '../src/app';
import { Product } from '../src/models/Product';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

// Small wrappers that send the access-token cookie like a browser would.
const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) =>
    request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set('Cookie', [`accessToken=${token}`]).send(body),
  delete: (path: string) => request(app).delete(path).set('Cookie', [`accessToken=${token}`]),
});

const sugar = {
  name: 'Sugar',
  localName: 'चीनी',
  unit: 'kg',
  pricePaise: 4500, // ₹45 per kg
  gstRate: 5,
  stockMilli: 25500, // 25.5 kg
  lowStockMilli: 5000,
};

const soap = {
  name: 'Lux Soap 100g',
  unit: 'piece',
  pricePaise: 3800,
  mrpPaise: 4000,
  gstRate: 18,
  hsn: '3401',
  stockMilli: 24000, // 24 pieces
};

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

describe('POST /api/products', () => {
  it('lets the owner add a product, stored with their shop', async () => {
    const res = await as(owner).post('/api/products', sugar);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Sugar',
      localName: 'चीनी',
      unit: 'kg',
      pricePaise: 4500,
      mrpPaise: null,
      gstRate: 5,
      stockMilli: 25500,
      isActive: true,
    });
    const saved = await Product.findOne({ _id: res.body.id, tenantId });
    expect(saved).not.toBeNull();
  });

  it('ignores a tenantId sent in the body', async () => {
    const other = await registerShop(app, otherShop);

    const res = await as(owner).post('/api/products', { ...sugar, tenantId: other.tenantId });

    expect(res.status).toBe(201);
    expect(await Product.countDocuments({ tenantId: other.tenantId })).toBe(0);
    expect(await Product.countDocuments({ tenantId })).toBe(1);
  });

  it('defaults stock and low-stock level to 0', async () => {
    const res = await as(owner).post('/api/products', {
      name: 'Parle-G',
      unit: 'packet',
      pricePaise: 1000,
      gstRate: 5,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ stockMilli: 0, lowStockMilli: 0 });
  });

  it('rejects money and quantities that are not whole numbers (paise / thousandths)', async () => {
    const res = await as(owner).post('/api/products', {
      ...sugar,
      pricePaise: 45.5,
      stockMilli: 2.5,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('pricePaise');
    expect(res.body.error.details).toHaveProperty('stockMilli');
  });

  it('rejects an unknown GST rate, unit or HSN format', async () => {
    const res = await as(owner).post('/api/products', {
      ...soap,
      gstRate: 7,
      unit: 'bag',
      hsn: '12',
    });

    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details).sort()).toEqual(['gstRate', 'hsn', 'unit']);
  });

  it('rejects a selling price above MRP (illegal in India)', async () => {
    const res = await as(owner).post('/api/products', { ...soap, pricePaise: 4100 });

    expect(res.status).toBe(400);
    expect(res.body.error.details.pricePaise).toEqual(['Selling price cannot be more than MRP']);
  });

  it('rejects fractional stock for count units like pieces', async () => {
    const res = await as(owner).post('/api/products', { ...soap, stockMilli: 2500 });

    expect(res.status).toBe(400);
    expect(res.body.error.details.stockMilli).toEqual(['Must be a whole number for piece']);
  });

  it('rejects a duplicate name in the same shop, ignoring case', async () => {
    await as(owner).post('/api/products', sugar);

    const res = await as(owner).post('/api/products', { ...sugar, name: 'SUGAR' });

    expect(res.status).toBe(409);
    expect(res.body.error.details.name).toBeDefined();
  });

  it('allows the same name in a different shop', async () => {
    const other = await registerShop(app, otherShop);
    await as(owner).post('/api/products', sugar);

    const res = await as(other.accessToken).post('/api/products', sugar);

    expect(res.status).toBe(201);
  });
});

describe('GET /api/products', () => {
  beforeEach(async () => {
    for (const p of [
      sugar,
      soap,
      { name: 'atta 5kg', localName: 'आटा', unit: 'packet', pricePaise: 25000, gstRate: 5 },
    ]) {
      expect((await as(owner).post('/api/products', p)).status).toBe(201);
    }
  });

  it('lists products sorted by name, ignoring case', async () => {
    const res = await as(owner).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual([
      'atta 5kg',
      'Lux Soap 100g',
      'Sugar',
    ]);
  });

  it('searches by name or Hindi name, ignoring case', async () => {
    const byName = await as(owner).get('/api/products?q=LUX');
    const byLocal = await as(owner).get(`/api/products?q=${encodeURIComponent('चीनी')}`);

    expect(byName.body.items.map((p: { name: string }) => p.name)).toEqual(['Lux Soap 100g']);
    expect(byLocal.body.items.map((p: { name: string }) => p.name)).toEqual(['Sugar']);
  });

  it('treats regex characters in the search as plain text', async () => {
    const res = await as(owner).get(`/api/products?q=${encodeURIComponent('(.*')}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('paginates', async () => {
    const res = await as(owner).get('/api/products?limit=2&page=2');

    expect(res.body).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(res.body.items).toHaveLength(1);
  });

  it('rejects a bad query string', async () => {
    const res = await as(owner).get('/api/products?limit=1000');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('limit');
  });
});

describe('GET /api/products/:id', () => {
  it('returns one product', async () => {
    const created = await as(owner).post('/api/products', sugar);

    const res = await as(owner).get(`/api/products/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sugar');
  });

  it('returns 404 for an unknown or malformed id', async () => {
    expect((await as(owner).get('/api/products/665f1c2b9a1e4b0012345678')).status).toBe(404);
    expect((await as(owner).get('/api/products/not-an-id')).status).toBe(404);
  });
});

describe('PATCH /api/products/:id', () => {
  it('updates only the fields sent', async () => {
    const created = await as(owner).post('/api/products', soap);

    const res = await as(owner).patch(`/api/products/${created.body.id}`, { pricePaise: 3500 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pricePaise: 3500, mrpPaise: 4000, stockMilli: 24000 });
  });

  it('clears an optional field when sent null', async () => {
    const created = await as(owner).post('/api/products', soap);

    const res = await as(owner).patch(`/api/products/${created.body.id}`, {
      mrpPaise: null,
      hsn: '',
    });

    expect(res.body).toMatchObject({ mrpPaise: null, hsn: null });
  });

  it('checks the new price against the MRP already stored', async () => {
    const created = await as(owner).post('/api/products', soap);

    const res = await as(owner).patch(`/api/products/${created.body.id}`, { pricePaise: 4500 });

    expect(res.status).toBe(400);
    expect(res.body.error.details.pricePaise).toBeDefined();
  });

  it('rejects an empty update', async () => {
    const created = await as(owner).post('/api/products', soap);

    const res = await as(owner).patch(`/api/products/${created.body.id}`, {});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Nothing to update');
  });
});

describe('DELETE /api/products/:id (archive)', () => {
  it('archives instead of deleting, so old bills keep working', async () => {
    const created = await as(owner).post('/api/products', sugar);
    const id = created.body.id;

    const res = await as(owner).delete(`/api/products/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    // Hidden from the normal list...
    expect((await as(owner).get('/api/products')).body.total).toBe(0);
    // ...shown in the archived list, and still readable by id.
    expect((await as(owner).get('/api/products?archived=true')).body.total).toBe(1);
    expect((await as(owner).get(`/api/products/${id}`)).status).toBe(200);
    // The document still exists in the database.
    expect(await Product.countDocuments({ tenantId })).toBe(1);
  });

  it("frees the archived product's name for reuse, and can be restored", async () => {
    const created = await as(owner).post('/api/products', sugar);
    await as(owner).delete(`/api/products/${created.body.id}`);

    expect((await as(owner).post('/api/products', sugar)).status).toBe(201);
    // Restoring the old one now clashes with the new active "Sugar".
    const restore = await as(owner).patch(`/api/products/${created.body.id}`, { isActive: true });
    expect(restore.status).toBe(409);
  });
});

describe('roles', () => {
  it('lets staff view products', async () => {
    const created = await as(owner).post('/api/products', sugar);
    const staff = await createStaff(app, tenantId);

    expect((await as(staff).get('/api/products')).body.total).toBe(1);
    expect((await as(staff).get(`/api/products/${created.body.id}`)).status).toBe(200);
  });

  it('does not let staff add, change or archive products', async () => {
    const created = await as(owner).post('/api/products', sugar);
    const staff = await createStaff(app, tenantId);
    const id = created.body.id;

    expect((await as(staff).post('/api/products', soap)).status).toBe(403);
    expect((await as(staff).patch(`/api/products/${id}`, { pricePaise: 1 })).status).toBe(403);
    expect((await as(staff).delete(`/api/products/${id}`)).status).toBe(403);
    expect((await as(owner).get(`/api/products/${id}`)).body.pricePaise).toBe(4500);
  });

  it('requires login', async () => {
    expect((await request(app).get('/api/products')).status).toBe(401);
  });
});

describe('tenant isolation', () => {
  it("never shows, changes or archives another shop's products", async () => {
    const created = await as(owner).post('/api/products', sugar);
    const id = created.body.id;
    const other = await registerShop(app, otherShop);
    const intruder = as(other.accessToken);

    // 404, not 403: the other shop must not even learn that this id exists.
    expect((await intruder.get(`/api/products/${id}`)).status).toBe(404);
    expect((await intruder.patch(`/api/products/${id}`, { pricePaise: 1 })).status).toBe(404);
    expect((await intruder.delete(`/api/products/${id}`)).status).toBe(404);
    expect((await intruder.get('/api/products')).body.total).toBe(0);
    expect((await intruder.get('/api/products?q=Sugar')).body.total).toBe(0);

    // Shop A's product is untouched.
    const mine = await as(owner).get(`/api/products/${id}`);
    expect(mine.body).toMatchObject({ pricePaise: 4500, isActive: true });
  });
});
