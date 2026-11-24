import request from 'supertest';
import { createApp } from '../src/app';
import { Product } from '../src/models/Product';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();
let shop: Awaited<ReturnType<typeof registerShop>>;

const post = (body: object, token = shop.accessToken) =>
  request(app).post('/api/products/prices').set('Cookie', [`accessToken=${token}`]).send(body);
const addProduct = (body: object, token = shop.accessToken) =>
  request(app).post('/api/products').set('Cookie', [`accessToken=${token}`]).send({ unit: 'packet', gstRate: 5, ...body });
const priceOf = async (name: string) => (await Product.findOne({ tenantId: shop.tenantId, name }))!;

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
  await addProduct({ name: 'Tata Salt 1kg', pricePaise: 2800, mrpPaise: 3000, barcode: '8901058000016' });
  await addProduct({ name: 'Maggi Noodles 70g', pricePaise: 1400, mrpPaise: 1500 });
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('POST /api/products/prices', () => {
  it('previews the changes without saving anything', async () => {
    const res = await post({ rows: [{ name: 'maggi noodles 70g', pricePaise: 1500, mrpPaise: 1600 }] });

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.changes).toEqual([
      expect.objectContaining({ name: 'Maggi Noodles 70g', oldPricePaise: 1400, pricePaise: 1500, oldMrpPaise: 1500, mrpPaise: 1600 }),
    ]);
    expect((await priceOf('Maggi Noodles 70g')).pricePaise).toBe(1400);
  });

  it('applies the changes, matching by barcode first and keeping the MRP when none is given', async () => {
    const res = await post({ apply: true, rows: [{ barcode: '8901058000016', name: 'Salt', pricePaise: 2900 }] });

    expect(res.body.applied).toBe(true);
    const salt = await priceOf('Tata Salt 1kg');
    expect(salt.pricePaise).toBe(2900);
    expect(salt.mrpPaise).toBe(3000);
  });

  it('reports rows it could not use: unknown products, prices above MRP, duplicates, no change', async () => {
    const res = await post({
      apply: true,
      rows: [
        { name: 'Ghee 1L', pricePaise: 60000 },
        { name: 'Tata Salt 1kg', pricePaise: 3500 },
        { name: 'Maggi Noodles 70g', pricePaise: 1400 },
        { name: 'Maggi Noodles 70g', pricePaise: 1450 },
      ],
    });

    expect(res.body.notFound).toEqual(['Ghee 1L']);
    expect(res.body.invalid.map((i: { message: string }) => i.message)).toEqual([
      'Tata Salt 1kg: selling price is more than the MRP',
      'Maggi Noodles 70g appears more than once in the list',
    ]);
    expect(res.body.unchanged).toBe(1);
    expect(res.body.changes).toEqual([]);
    expect((await priceOf('Tata Salt 1kg')).pricePaise).toBe(2800);
  });

  it("never touches another shop's products", async () => {
    const other = await registerShop(app, otherShop);

    const res = await post({ apply: true, rows: [{ name: 'Tata Salt 1kg', pricePaise: 100 }] }, other.accessToken);

    expect(res.body.notFound).toEqual(['Tata Salt 1kg']);
    expect((await priceOf('Tata Salt 1kg')).pricePaise).toBe(2800);
  });

  it('is for the owner only, and validates the list', async () => {
    const staff = await createStaff(app, shop.tenantId);
    expect((await post({ rows: [{ name: 'Tata Salt 1kg', pricePaise: 2900 }] }, staff)).status).toBe(403);
    expect((await post({ rows: [] })).status).toBe(400);
    expect((await post({ rows: [{ pricePaise: 100 }] })).status).toBe(400);
    expect((await post({ rows: [{ name: 'Tata Salt 1kg', pricePaise: 29.5 }] })).status).toBe(400);
  });
});
