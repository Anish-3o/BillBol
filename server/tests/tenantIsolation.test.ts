import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { signAccessToken } from '../src/services/token.service';
import { otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

// Rule 1 of this project: a user from one shop can never read another shop's data.
// /auth/me is the only tenant-scoped read so far; these tests pin down the guarantees every
// future route (products, bills, udhaar) must keep: tenantId comes from the signed token only,
// and queries filter by it.

const app = createApp();
const me = (accessToken: string) =>
  request(app).get('/api/auth/me').set('Cookie', [`accessToken=${accessToken}`]);

let shopA: Awaited<ReturnType<typeof registerShop>>;
let shopB: Awaited<ReturnType<typeof registerShop>>;

beforeAll(connectTestDB);
beforeEach(async () => {
  shopA = await registerShop(app);
  shopB = await registerShop(app, otherShop);
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('tenant isolation', () => {
  it("each shop's token only ever returns that shop's own data", async () => {
    const resA = await me(shopA.accessToken);
    const resB = await me(shopB.accessToken);

    expect(resA.body.tenant.id).toBe(shopA.tenantId);
    expect(resA.body.user.id).toBe(shopA.userId);
    expect(resB.body.tenant.id).toBe(shopB.tenantId);
    expect(resB.body.user.id).toBe(shopB.userId);
    expect(JSON.stringify(resA.body)).not.toContain(shopB.tenantId);
  });

  it('ignores a tenantId sent by the client in the query, body or headers', async () => {
    const res = await request(app)
      .get(`/api/auth/me?tenantId=${shopB.tenantId}`)
      .set('Cookie', [`accessToken=${shopA.accessToken}`])
      .set('X-Tenant-Id', shopB.tenantId)
      .send({ tenantId: shopB.tenantId });

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(shopA.tenantId);
    expect(JSON.stringify(res.body)).not.toContain(shopB.tenantId);
  });

  it("rejects a forged token that claims another shop's tenantId", async () => {
    // An attacker edits their token to point at shop B but cannot sign it with our secret.
    const forged = jwt.sign({ tenantId: shopB.tenantId, role: 'owner' }, 'attacker-guess-secret', {
      subject: shopA.userId,
    });

    const res = await me(forged);

    expect(res.status).toBe(401);
  });

  it("returns nothing for a validly signed token pairing shop A's user with shop B", async () => {
    // Defence in depth: even if a token like this were ever issued by mistake, queries filter
    // by BOTH user id and tenantId, so shop A's user is not found inside shop B.
    const mismatched = signAccessToken({ id: shopA.userId, tenantId: shopB.tenantId, role: 'owner' });

    const res = await me(mismatched);

    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('Patil');
  });

  it('a refreshed session stays in its own shop', async () => {
    // The tenant for the new tokens comes from the stored refresh-token record, not the request.
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`refreshToken=${shopA.refreshToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(shopA.tenantId);
  });
});
