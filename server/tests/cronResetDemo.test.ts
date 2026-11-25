import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { Bill } from '../src/models/Bill';
import { Product } from '../src/models/Product';
import { Tenant } from '../src/models/Tenant';
import { User } from '../src/models/User';
import { DEMO } from '../src/services/demoShop.service';
import { otherShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();
const SECRET = 'cron-secret-for-tests-0123456789-abcdefgh';

const reset = (auth?: string) => {
  const req = request(app).get('/api/cron/reset-demo');
  return auth ? req.set('Authorization', auth) : req;
};

beforeAll(connectTestDB);
afterEach(async () => {
  env.CRON_SECRET = undefined;
  await clearTestDB();
});
afterAll(closeTestDB);

describe('GET /api/cron/reset-demo', () => {
  it('does not exist when CRON_SECRET is not set', async () => {
    const res = await reset(`Bearer ${SECRET}`);

    expect(res.status).toBe(404);
    expect(await Tenant.countDocuments()).toBe(0);
  });

  it('rejects a missing or wrong secret', async () => {
    env.CRON_SECRET = SECRET;

    expect((await reset()).status).toBe(401);
    expect((await reset(`Bearer ${SECRET}x`)).status).toBe(401);
    expect((await reset(SECRET)).status).toBe(401); // "Bearer " prefix is required
    expect(await Tenant.countDocuments()).toBe(0);
  });

  it(
    'rebuilds the demo shop, undoing visitor changes, and leaves other shops alone',
    async () => {
      env.CRON_SECRET = SECRET;
      const other = await request(app).post('/api/auth/register').send(otherShop);
      expect(other.status).toBe(201);

      const first = await reset(`Bearer ${SECRET}`);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ ok: true, products: 50, customers: 8 });
      expect(first.body.bills).toBeGreaterThan(500);

      // A visitor messes the demo shop up.
      const demoOwner = await User.findOne({ phone: DEMO.phone });
      const tenantId = demoOwner!.tenantId;
      await Tenant.updateOne({ _id: tenantId }, { $set: { upiId: 'stranger@upi' } });
      await Product.collection.deleteMany({ tenantId });

      const second = await reset(`Bearer ${SECRET}`);
      expect(second.status).toBe(200);
      // Same fixed random seed, so the rebuilt shop has the same shape.
      expect(second.body.bills).toBe(first.body.bills);

      // Exactly one demo shop, fresh (new id), with its products back and no visitor edits.
      const demoUsers = await User.find({ phone: DEMO.phone });
      expect(demoUsers).toHaveLength(1);
      const newTenantId = demoUsers[0].tenantId;
      expect(String(newTenantId)).not.toBe(String(tenantId));
      expect(await Tenant.findById(tenantId)).toBeNull();
      expect((await Tenant.findById(newTenantId))!.get('upiId')).toBeFalsy();
      expect(await Product.collection.countDocuments({ tenantId: newTenantId })).toBe(50);
      expect(await Bill.collection.countDocuments({ tenantId })).toBe(0);

      // The other shop and its owner are untouched.
      expect(await Tenant.findById(other.body.tenant.id)).not.toBeNull();
      expect(await User.countDocuments({ phone: otherShop.phone })).toBe(1);

      // And the public demo login still works.
      const login = await request(app)
        .post('/api/auth/login')
        .send({ identifier: DEMO.phone, password: DEMO.password });
      expect(login.status).toBe(200);
    },
    90_000,
  );
});
