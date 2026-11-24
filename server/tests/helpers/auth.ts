import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { User } from '../../src/models/User';

export const validShop = {
  shopName: 'Sharma Kirana Store',
  ownerName: 'Ramesh Sharma',
  phone: '9876543210',
  email: 'Ramesh@Example.com',
  state: 'Maharashtra',
  gstin: '27aapfu0939f1zv',
  password: 'chai-biscuit-42',
};

export const otherShop = {
  shopName: 'Patil General Stores',
  ownerName: 'Sunita Patil',
  phone: '9123456780',
  email: 'sunita@example.com',
  state: 'Maharashtra',
  password: 'poha-jalebi-99',
};

// Returns the raw Set-Cookie header for one cookie, e.g. "accessToken=...; Path=/api; HttpOnly".
export function getCookie(res: Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith(`${name}=`));
}

export function cookieValue(cookie: string | undefined): string {
  if (!cookie) throw new Error('Expected a Set-Cookie header');
  return cookie.split(';')[0].split('=')[1];
}

// Registers a shop and returns its ids plus the raw tokens from the cookies.
export async function registerShop(app: Express, body: object = validShop) {
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    userId: res.body.user.id as string,
    tenantId: res.body.tenant.id as string,
    accessToken: cookieValue(getCookie(res, 'accessToken')),
    refreshToken: cookieValue(getCookie(res, 'refreshToken')),
  };
}

// Logs in through the real API and returns the access token from the cookie.
export async function loginAs(app: Express, identifier: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return cookieValue(getCookie(res, 'accessToken'));
}

// There is no "add staff" API yet (Week 4), so tests insert a staff user directly,
// then log in through the API like a real user would.
export async function createStaff(app: Express, tenantId: string, phone = '9988776655') {
  const password = 'staff-password-1';
  await User.create({
    tenantId,
    name: 'Staff Member',
    phone,
    passwordHash: await bcrypt.hash(password, 4),
    role: 'staff',
  });
  return loginAs(app, phone, password);
}
