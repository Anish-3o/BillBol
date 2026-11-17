import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { RefreshToken } from '../src/models/RefreshToken';
import { cookieValue, getCookie, registerShop, validShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

// Sends a request carrying the given cookies, the way a browser would.
const refresh = (refreshToken: string) =>
  request(app).post('/api/auth/refresh').set('Cookie', [`refreshToken=${refreshToken}`]);
const me = (accessToken: string) =>
  request(app).get('/api/auth/me').set('Cookie', [`accessToken=${accessToken}`]);

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('POST /api/auth/refresh', () => {
  it('issues a new access token and a new refresh token', async () => {
    const shop = await registerShop(app);

    const res = await refresh(shop.refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: shop.userId, role: 'owner' });
    expect(res.body.tenant.id).toBe(shop.tenantId);

    const newRefresh = cookieValue(getCookie(res, 'refreshToken'));
    const newAccess = cookieValue(getCookie(res, 'accessToken'));
    expect(newRefresh).not.toBe(shop.refreshToken);
    expect(getCookie(res, 'refreshToken')).toMatch(/HttpOnly/);

    // The new access token works, and the new refresh token can be used in turn.
    expect((await me(newAccess)).status).toBe(200);
    expect((await refresh(newRefresh)).status).toBe(200);
  });

  it('rejects a refresh token that has already been used', async () => {
    const shop = await registerShop(app);
    const first = await refresh(shop.refreshToken);
    expect(first.status).toBe(200);

    const reused = await refresh(shop.refreshToken);

    expect(reused.status).toBe(401);
    expect(reused.body.error.message).toBe('Session expired, please log in again');
    // The dead cookies are cleared.
    expect(getCookie(reused, 'refreshToken')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('treats reuse as theft and also revokes the newer token from the same login', async () => {
    const shop = await registerShop(app);
    // The real user refreshes and gets a new token...
    const rotated = cookieValue(getCookie(await refresh(shop.refreshToken), 'refreshToken'));
    // ...then an attacker replays the stolen old one.
    expect((await refresh(shop.refreshToken)).status).toBe(401);

    // The whole session is now dead, so the attacker cannot have raced ahead with it either.
    expect((await refresh(rotated)).status).toBe(401);
  });

  it('only revokes the session that was reused, not other devices', async () => {
    const counter = await registerShop(app);
    const phoneLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: validShop.phone, password: validShop.password });
    const phoneRefresh = cookieValue(getCookie(phoneLogin, 'refreshToken'));

    await refresh(counter.refreshToken);
    await refresh(counter.refreshToken); // reuse on the counter session

    expect((await refresh(phoneRefresh)).status).toBe(200);
  });

  it('lets only one of two simultaneous refreshes with the same token succeed', async () => {
    const shop = await registerShop(app);

    const results = await Promise.all([refresh(shop.refreshToken), refresh(shop.refreshToken)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('rejects a missing, tampered or wrong-type token', async () => {
    const shop = await registerShop(app);

    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    expect((await refresh(`${shop.refreshToken}x`)).status).toBe(401);
    // An access token is signed with a different secret, so it cannot be used to refresh.
    expect((await refresh(shop.accessToken)).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears both auth cookies', async () => {
    const shop = await registerShop(app);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`refreshToken=${shop.refreshToken}`, `accessToken=${shop.accessToken}`]);

    expect(res.status).toBe(204);
    const access = getCookie(res, 'accessToken');
    const refreshCookie = getCookie(res, 'refreshToken');
    // Expired, empty, and with the same path they were set with, or the browser keeps them.
    expect(access).toMatch(/^accessToken=;/);
    expect(access).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(access).toMatch(/Path=\/api;/);
    expect(refreshCookie).toMatch(/^refreshToken=;/);
    expect(refreshCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(refreshCookie).toMatch(/Path=\/api\/auth;/);
  });

  it('revokes the refresh token on the server, not just in the browser', async () => {
    const shop = await registerShop(app);
    await request(app).post('/api/auth/logout').set('Cookie', [`refreshToken=${shop.refreshToken}`]);

    // Someone who copied the cookie before logout cannot use it afterwards.
    expect((await refresh(shop.refreshToken)).status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
  });

  it('succeeds even when not logged in', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(204);
    expect(getCookie(res, 'accessToken')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('GET /api/auth/me', () => {
  it('needs login', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Please log in');
  });

  it('returns the logged-in user and their shop', async () => {
    const shop = await registerShop(app);

    const res = await me(shop.accessToken);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: shop.userId,
      tenantId: shop.tenantId,
      name: 'Ramesh Sharma',
      role: 'owner',
    });
    expect(res.body.tenant).toMatchObject({ id: shop.tenantId, name: 'Sharma Kirana Store' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects an expired access token', async () => {
    const shop = await registerShop(app);
    const expired = jwt.sign(
      { tenantId: shop.tenantId, role: 'owner', exp: Math.floor(Date.now() / 1000) - 60 },
      env.JWT_ACCESS_SECRET,
      { subject: shop.userId },
    );

    const res = await me(expired);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Session expired');
  });

  it('rejects a refresh token used as an access token', async () => {
    const shop = await registerShop(app);

    expect((await me(shop.refreshToken)).status).toBe(401);
  });

  it('rejects a token with alg "none" (no signature)', async () => {
    const shop = await registerShop(app);
    const unsigned = jwt.sign({ tenantId: shop.tenantId, role: 'owner' }, null, {
      subject: shop.userId,
      algorithm: 'none',
    });

    expect((await me(unsigned)).status).toBe(401);
  });
});
