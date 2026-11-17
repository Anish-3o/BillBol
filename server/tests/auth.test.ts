import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { Tenant } from '../src/models/Tenant';
import { User } from '../src/models/User';
import { cookieValue, getCookie, validShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

const register = (body: object = validShop) => request(app).post('/api/auth/register').send(body);
const login = (body: object) => request(app).post('/api/auth/login').send(body);

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('POST /api/auth/register', () => {
  it('creates a shop and its owner, and sets httpOnly auth cookies', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.tenant).toMatchObject({
      name: 'Sharma Kirana Store',
      ownerName: 'Ramesh Sharma',
      state: 'Maharashtra',
      gstin: '27AAPFU0939F1ZV', // normalised to uppercase
    });
    expect(res.body.user).toMatchObject({
      name: 'Ramesh Sharma',
      phone: '9876543210',
      email: 'ramesh@example.com', // normalised to lowercase
      role: 'owner',
      tenantId: res.body.tenant.id,
    });

    // Nothing secret in the response body.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain(validShop.password);
    expect(raw).not.toContain('Token');

    // The password is stored as a bcrypt hash, never in plain text.
    const user = await User.findById(res.body.user.id).select('+passwordHash');
    expect(user!.passwordHash).not.toBe(validShop.password);
    expect(await bcrypt.compare(validShop.password, user!.passwordHash)).toBe(true);

    // Cookies: httpOnly, right paths, right lifetimes.
    const access = getCookie(res, 'accessToken');
    const refresh = getCookie(res, 'refreshToken');
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/Path=\/api;/);
    expect(access).toMatch(/Max-Age=900;/);
    expect(access).toMatch(/SameSite=Lax/);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/Path=\/api\/auth;/);
    expect(refresh).toMatch(/Max-Age=604800;/);

    // The access token identifies the user, their shop and their role, and lasts 15 minutes.
    const claims = jwt.verify(cookieValue(access!), env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    expect(claims).toMatchObject({
      sub: res.body.user.id,
      tenantId: res.body.tenant.id,
      role: 'owner',
    });
    expect(claims.exp! - claims.iat!).toBe(15 * 60);

    // The refresh token is signed with its own secret and lasts 7 days.
    const refreshClaims = jwt.verify(
      cookieValue(refresh!),
      env.JWT_REFRESH_SECRET,
    ) as jwt.JwtPayload;
    expect(refreshClaims.sub).toBe(res.body.user.id);
    expect(refreshClaims.exp! - refreshClaims.iat!).toBe(7 * 24 * 60 * 60);
    expect(() => jwt.verify(cookieValue(refresh!), env.JWT_ACCESS_SECRET)).toThrow();
  });

  it('stores phone numbers in one canonical 10-digit form', async () => {
    const res = await register({ ...validShop, phone: '+91 98765-43210' });

    expect(res.status).toBe(201);
    expect(res.body.user.phone).toBe('9876543210');
    expect(res.body.tenant.phone).toBe('9876543210');
  });

  it('works without the optional email and GSTIN', async () => {
    const res = await register({
      shopName: validShop.shopName,
      ownerName: validShop.ownerName,
      phone: validShop.phone,
      state: validShop.state,
      password: validShop.password,
      gstin: '', // what an empty form field sends
    });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBeNull();
    expect(res.body.tenant.gstin).toBeNull();
  });

  it('rejects invalid input with field-level errors', async () => {
    const res = await register({ ...validShop, phone: '12345', password: 'short', gstin: 'XYZ' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('phone');
    expect(res.body.error.details).toHaveProperty('password');
    expect(res.body.error.details).toHaveProperty('gstin');
    expect(await Tenant.countDocuments()).toBe(0);
  });

  describe('duplicate account', () => {
    it('rejects a phone number that is already registered', async () => {
      await register();
      // Same phone written differently, different email: still the same person.
      const res = await register({
        ...validShop,
        shopName: 'Another Shop',
        phone: '+91 98765 43210',
        email: 'other@example.com',
      });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('An account with this phone or email already exists');
      // The failed attempt must not leave an orphan shop behind.
      expect(await Tenant.countDocuments()).toBe(1);
      expect(await User.countDocuments()).toBe(1);
    });

    it('rejects an email that is already registered', async () => {
      await register();
      const res = await register({ ...validShop, phone: '9123456780', email: 'RAMESH@example.com' });

      expect(res.status).toBe(409);
      expect(await Tenant.countDocuments()).toBe(1);
    });
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('logs in with phone and sets auth cookies', async () => {
    const res = await login({ identifier: '98765 43210', password: validShop.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ phone: '9876543210', role: 'owner' });
    expect(res.body.tenant.name).toBe('Sharma Kirana Store');
    expect(res.body.user.tenantId).toBe(res.body.tenant.id);
    expect(getCookie(res, 'accessToken')).toMatch(/HttpOnly/);
    expect(getCookie(res, 'refreshToken')).toMatch(/HttpOnly/);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('logs in with email, ignoring case', async () => {
    const res = await login({ identifier: 'RAMESH@EXAMPLE.COM', password: validShop.password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ramesh@example.com');
  });

  it('rejects a wrong password without setting cookies', async () => {
    const res = await login({ identifier: '9876543210', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid phone/email or password');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('gives an unknown account the same error as a wrong password', async () => {
    const res = await login({ identifier: '9000000000', password: validShop.password });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid phone/email or password');
  });

  it('rejects a request with missing fields', async () => {
    const res = await login({ identifier: '9876543210' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('password');
  });
});
