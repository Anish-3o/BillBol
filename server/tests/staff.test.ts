import request from 'supertest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/models/RefreshToken';
import { User } from '../src/models/User';
import { createStaff, loginAs, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) =>
    request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
  delete: (path: string) => request(app).delete(path).set('Cookie', [`accessToken=${token}`]),
});

const helper = { name: 'Raju', phone: '+91 98111 22233', password: 'raju-counter-1' };

let shop: Awaited<ReturnType<typeof registerShop>>;

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('staff accounts', () => {
  it('the owner adds a helper, who can then log in as staff', async () => {
    const res = await as(shop.accessToken).post('/api/staff', helper);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Raju', phone: '9811122233' });
    expect(res.body.passwordHash).toBeUndefined();

    const login = await request(app).post('/api/auth/login').send({ identifier: '9811122233', password: helper.password });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ role: 'staff', tenantId: shop.tenantId });
  });

  it('lists only staff, not the owner', async () => {
    await as(shop.accessToken).post('/api/staff', helper);

    const res = await as(shop.accessToken).get('/api/staff');

    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Raju']);
  });

  it('refuses a phone number that already has an account', async () => {
    await as(shop.accessToken).post('/api/staff', helper);

    const res = await as(shop.accessToken).post('/api/staff', { ...helper, name: 'Someone else' });

    expect(res.status).toBe(409);
    expect(res.body.error.details.phone).toBeDefined();
  });

  it('removing a helper deletes the account and ends their sessions', async () => {
    const added = (await as(shop.accessToken).post('/api/staff', helper)).body;
    await loginAs(app, '9811122233', helper.password);

    const res = await as(shop.accessToken).delete(`/api/staff/${added.id}`);

    expect(res.status).toBe(204);
    expect(await User.exists({ _id: added.id })).toBeNull();
    expect(await RefreshToken.countDocuments({ userId: added.id, revokedAt: null })).toBe(0);
    const login = await request(app).post('/api/auth/login').send({ identifier: '9811122233', password: helper.password });
    expect(login.status).toBe(401);
  });

  it("cannot remove the owner's own account", async () => {
    const res = await as(shop.accessToken).delete(`/api/staff/${shop.userId}`);

    expect(res.status).toBe(404);
    expect(await User.exists({ _id: shop.userId })).not.toBeNull();
  });

  it("cannot see or remove another shop's staff", async () => {
    const other = await registerShop(app, otherShop);
    const theirs = (await as(other.accessToken).post('/api/staff', helper)).body;

    expect((await as(shop.accessToken).get('/api/staff')).body).toEqual([]);
    expect((await as(shop.accessToken).delete(`/api/staff/${theirs.id}`)).status).toBe(404);
  });

  it('is owner-only', async () => {
    const staff = await createStaff(app, shop.tenantId);

    expect((await as(staff).get('/api/staff')).status).toBe(403);
    expect((await as(staff).post('/api/staff', helper)).status).toBe(403);
  });
});
