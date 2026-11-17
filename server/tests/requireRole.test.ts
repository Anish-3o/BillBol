import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { authenticate, getAuth, requireRole } from '../src/middleware/authenticate';
import { errorHandler } from '../src/middleware/errorHandler';
import { signAccessToken } from '../src/services/token.service';

// No real route uses requireRole yet, so this builds a tiny app with one owner-only route.
// authenticate and requireRole only read the signed token, so no database is needed.
const app = express();
app.use(cookieParser());
app.get('/owner-only', authenticate, requireRole('owner'), (req, res) => {
  res.json(getAuth(req));
});
app.get('/owner-or-staff', authenticate, requireRole('owner', 'staff'), (_req, res) => {
  res.json({ ok: true });
});
app.use(errorHandler);

const tenantId = '665f1c2b9a1e4b0012345678';
const tokenFor = (role: 'owner' | 'staff') =>
  signAccessToken({ id: '665f1c2b9a1e4b0087654321', tenantId, role });
const get = (path: string, token?: string) => {
  const req = request(app).get(path);
  return token ? req.set('Cookie', [`accessToken=${token}`]) : req;
};

describe('requireRole', () => {
  it('lets an allowed role through, with user and tenantId attached by authenticate', async () => {
    const res = await get('/owner-only', tokenFor('owner'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: '665f1c2b9a1e4b0087654321', role: 'owner', tenantId });
  });

  it('returns 403 for a logged-in user with the wrong role', async () => {
    const res = await get('/owner-only', tokenFor('staff'));

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('You do not have permission to do this');
  });

  it('accepts any of several allowed roles', async () => {
    expect((await get('/owner-or-staff', tokenFor('staff'))).status).toBe(200);
    expect((await get('/owner-or-staff', tokenFor('owner'))).status).toBe(200);
  });

  it('returns 401, not 403, when nobody is logged in', async () => {
    expect((await get('/owner-only')).status).toBe(401);
  });
});
