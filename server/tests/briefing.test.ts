import request from 'supertest';
import { isGrounded, writeFromFacts } from '../src/ai/writer';
import { createApp } from '../src/app';
import { clearBriefingCache } from '../src/services/briefing.service';
import { otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

// The Claude call is mocked; by default it behaves as "not set up" (returns null).
jest.mock('../src/ai/writer', () => ({
  ...jest.requireActual('../src/ai/writer'),
  writeFromFacts: jest.fn(async () => null),
}));
const write = jest.mocked(writeFromFacts);

const app = createApp();
let shop: Awaited<ReturnType<typeof registerShop>>;
let soapId: string;

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) => request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
});

beforeAll(connectTestDB);
beforeEach(async () => {
  clearBriefingCache();
  write.mockReset();
  write.mockResolvedValue(null);
  shop = await registerShop(app);
  soapId = (await as(shop.accessToken).post('/api/products', { name: 'Lux Soap', unit: 'piece', pricePaise: 3800, gstRate: 5, stockMilli: 50000 })).body.id;
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('isGrounded (Rule 3 guard)', () => {
  const facts = "Yesterday's sales: ₹12,340 from 48 bills\nChange vs the day before: 8%";

  it('accepts text that only uses numbers from the facts', () => {
    expect(isGrounded('Kal ₹12,340 ki bikri, 48 bills, 8% zyada!', facts)).toBe(true);
    expect(isGrounded('Kal 12340 rupaye ki bikri hui.', facts)).toBe(true);
    expect(isGrounded('Good morning! Achha din raha.', facts)).toBe(true);
  });

  it('rejects text with a changed or invented number', () => {
    expect(isGrounded('Kal ₹12,430 ki bikri hui.', facts)).toBe(false);
    expect(isGrounded('Kal ₹12,340 ki bikri, 50 bills.', facts)).toBe(false);
  });
});

describe('GET /api/insights/briefing', () => {
  it('uses the template with real numbers when AI is not available', async () => {
    await as(shop.accessToken).post('/api/bills', { items: [{ productId: soapId, quantityMilli: 2000 }], paymentMode: 'cash' });

    const res = await as(shop.accessToken).get('/api/insights/briefing?lang=en');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('template');
    expect(res.body.text).toMatch(/Good morning, Ramesh!/);
    expect(res.body.text).toMatch(/Today so far: ₹76 \(1 bill\)/);
  });

  it("shows the AI's text when it passed the checks, and caches it", async () => {
    write.mockResolvedValue('Namaste Ramesh ji! Aaj achhi shuruaat hai.');

    const first = await as(shop.accessToken).get('/api/insights/briefing');
    const second = await as(shop.accessToken).get('/api/insights/briefing');

    expect(first.body).toMatchObject({ source: 'ai', text: 'Namaste Ramesh ji! Aaj achhi shuruaat hai.' });
    expect(second.body.text).toBe(first.body.text);
    expect(write).toHaveBeenCalledTimes(1);
    // The model is given computed facts to rephrase, never raw data to calculate from.
    expect(write.mock.calls[0][1]).toMatch(/Today so far: ₹0 from 0 bills/);
  });

  it('validates the language', async () => {
    expect((await as(shop.accessToken).get('/api/insights/briefing?lang=fr')).status).toBe(400);
  });
});

describe('POST /api/customers/:id/reminder-draft', () => {
  async function customerOwing(token = shop.accessToken) {
    const customerId = (await as(token).post('/api/customers', { name: 'Suresh Patil', phone: '9822334455' })).body.id;
    await as(token).post('/api/bills', { items: [{ productId: soapId, quantityMilli: 2000 }], paymentMode: 'udhaar', customerId });
    return customerId as string;
  }

  it('drafts a WhatsApp message with the exact amount and a ready-to-send link', async () => {
    const id = await customerOwing();

    const res = await as(shop.accessToken).post(`/api/customers/${id}/reminder-draft`, { lang: 'hinglish' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('template');
    expect(res.body.balancePaise).toBe(7600);
    expect(res.body.text).toMatch(/Suresh Patil ji/);
    expect(res.body.text).toMatch(/₹76/);
    expect(res.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919822334455\?text=/);
    expect(write.mock.calls[0][1]).toMatch(/Amount owed: ₹76/);
  });

  it('refuses when the customer owes nothing', async () => {
    const id = (await as(shop.accessToken).post('/api/customers', { name: 'Anita' })).body.id;

    const res = await as(shop.accessToken).post(`/api/customers/${id}/reminder-draft`, {});

    expect(res.status).toBe(400);
  });

  it("returns 404 for another shop's customer", async () => {
    const id = await customerOwing();
    const other = await registerShop(app, otherShop);

    expect((await as(other.accessToken).post(`/api/customers/${id}/reminder-draft`, {})).status).toBe(404);
  });
});

describe('Marathi briefing', () => {
  it('has a Marathi template', async () => {
    const res = await as(shop.accessToken).get('/api/insights/briefing?lang=mr');

    expect(res.status).toBe(200);
    expect(res.body.text).toMatch(/^सुप्रभात Ramesh! काल ₹0 ची विक्री झाली/);
  });
});
