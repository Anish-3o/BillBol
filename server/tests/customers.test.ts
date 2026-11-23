import request from 'supertest';
import { createApp } from '../src/app';
import { Bill } from '../src/models/Bill';
import { Customer } from '../src/models/Customer';
import { LedgerEntry } from '../src/models/LedgerEntry';
import { Product } from '../src/models/Product';
import { createStaff, otherShop, registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

const app = createApp();

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Cookie', [`accessToken=${token}`]),
  post: (path: string, body: object) =>
    request(app).post(path).set('Cookie', [`accessToken=${token}`]).send(body),
  patch: (path: string, body: object) =>
    request(app).patch(path).set('Cookie', [`accessToken=${token}`]).send(body),
});

let shop: Awaited<ReturnType<typeof registerShop>>;
let soapId: string;
let owner: ReturnType<typeof as>;

const addCustomer = async (body: object = { name: 'Suresh Patil', phone: '9822334455' }) =>
  (await owner.post('/api/customers', body)).body.id as string;

// 2 soaps at ₹38 = ₹76, on udhaar for the given customer
const udhaarBill = (customerId: string, qty = 2000) =>
  owner.post('/api/bills', {
    items: [{ productId: soapId, quantityMilli: qty }],
    paymentMode: 'udhaar',
    customerId,
  });

const balanceOf = async (id: string) =>
  (await Customer.findOne({ _id: id, tenantId: shop.tenantId }))!.balancePaise;

beforeAll(connectTestDB);
beforeEach(async () => {
  shop = await registerShop(app);
  owner = as(shop.accessToken);
  soapId = (
    await owner.post('/api/products', {
      name: 'Lux Soap',
      unit: 'piece',
      pricePaise: 3800,
      gstRate: 5,
      stockMilli: 50000,
    })
  ).body.id;
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDB();
});
afterAll(closeTestDB);

describe('customers', () => {
  it('adds a customer with a normalised phone and zero balance', async () => {
    const res = await owner.post('/api/customers', { name: 'Suresh Patil', phone: '+91 98223-34455' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Suresh Patil', phone: '9822334455', balancePaise: 0 });
  });

  it('phone is optional, but unique within a shop', async () => {
    expect((await owner.post('/api/customers', { name: 'No Phone' })).status).toBe(201);
    expect((await owner.post('/api/customers', { name: 'Also No Phone', phone: '' })).status).toBe(201);
    await addCustomer();

    const dup = await owner.post('/api/customers', { name: 'Someone Else', phone: '9822334455' });

    expect(dup.status).toBe(409);
    expect(dup.body.error.details.phone).toBeDefined();
  });

  it('allows the same phone in a different shop', async () => {
    await addCustomer();
    const other = await registerShop(app, otherShop);

    const res = await as(other.accessToken).post('/api/customers', { name: 'Suresh', phone: '9822334455' });

    expect(res.status).toBe(201);
  });

  it('edits name and phone but never the balance', async () => {
    const id = await addCustomer();

    const res = await owner.patch(`/api/customers/${id}`, { name: 'Suresh B. Patil', balancePaise: -99999 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Suresh B. Patil', balancePaise: 0 });
  });

  it('lists who owes the most first, with the shop total', async () => {
    const a = await addCustomer({ name: 'Asha' });
    const b = await addCustomer({ name: 'Bharat' });
    await addCustomer({ name: 'Chetan' });
    await udhaarBill(a, 1000); // ₹38
    await udhaarBill(b, 3000); // ₹114

    const res = await owner.get('/api/customers');

    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Bharat', 'Asha', 'Chetan']);
    expect(res.body).toMatchObject({ total: 3, totalOwedPaise: 15200, customersOwing: 2 });
  });

  it('searches by name or phone', async () => {
    await addCustomer({ name: 'Suresh Patil', phone: '9822334455' });
    await addCustomer({ name: 'Meena Joshi', phone: '9123412345' });

    expect((await owner.get('/api/customers?q=meena')).body.items[0].name).toBe('Meena Joshi');
    expect((await owner.get('/api/customers?q=98223')).body.items[0].name).toBe('Suresh Patil');
  });
});

describe('udhaar bills', () => {
  it('charges the bill to the customer: balance, ledger entry and bill all agree', async () => {
    const id = await addCustomer();

    const res = await udhaarBill(id);

    expect(res.status).toBe(201);
    expect(res.body.bill).toMatchObject({
      paymentMode: 'udhaar',
      totalPaise: 7600,
      customer: { id, name: 'Suresh Patil' },
    });
    expect(await balanceOf(id)).toBe(7600);
    const entries = await LedgerEntry.find({ tenantId: shop.tenantId, customerId: id });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'credit_sale',
      amountPaise: 7600,
      balanceAfterPaise: 7600,
      billNumber: res.body.bill.number,
    });
  });

  it('requires a customer for udhaar', async () => {
    const res = await owner.post('/api/bills', {
      items: [{ productId: soapId, quantityMilli: 1000 }],
      paymentMode: 'udhaar',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details.customerId).toEqual(['Choose the customer for udhaar']);
  });

  it("rejects another shop's customer and leaves everything untouched", async () => {
    const other = await registerShop(app, otherShop);
    const theirCustomer = (await as(other.accessToken).post('/api/customers', { name: 'Theirs' })).body.id;

    const res = await udhaarBill(theirCustomer);

    expect(res.status).toBe(400);
    expect(await Bill.countDocuments({ tenantId: shop.tenantId })).toBe(0);
    expect((await Product.findOne({ _id: soapId, tenantId: shop.tenantId }))!.stockMilli).toBe(50000);
    expect(await Customer.findOne({ _id: theirCustomer, tenantId: other.tenantId })).toMatchObject({
      balancePaise: 0,
    });
  });

  it('can attach a customer to a cash bill without touching their khata', async () => {
    const id = await addCustomer();

    const res = await owner.post('/api/bills', {
      items: [{ productId: soapId, quantityMilli: 1000 }],
      paymentMode: 'cash',
      customerId: id,
    });

    expect(res.body.bill.customer).toEqual({ id, name: 'Suresh Patil' });
    expect(await balanceOf(id)).toBe(0);
    expect(await LedgerEntry.countDocuments({ tenantId: shop.tenantId })).toBe(0);
  });

  it('is all-or-nothing: if the khata write fails, no bill, no stock change, no balance', async () => {
    const id = await addCustomer();
    jest.spyOn(LedgerEntry, 'create').mockRejectedValueOnce(new Error('Simulated crash writing khata'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await udhaarBill(id);

    expect(res.status).toBe(500);
    expect(await Bill.countDocuments({ tenantId: shop.tenantId })).toBe(0);
    expect(await balanceOf(id)).toBe(0);
    expect((await Product.findOne({ _id: soapId, tenantId: shop.tenantId }))!.stockMilli).toBe(50000);
  });
});

describe('payments', () => {
  it('reduces the balance and records the payment in the khata', async () => {
    const id = await addCustomer();
    await udhaarBill(id, 3000); // ₹114

    const res = await owner.post(`/api/customers/${id}/payments`, {
      amountPaise: 10000,
      paymentMode: 'upi',
      note: 'Paid via PhonePe',
    });

    expect(res.status).toBe(201);
    expect(res.body.customer.balancePaise).toBe(1400);
    expect(res.body.entry).toMatchObject({
      type: 'payment',
      amountPaise: 10000,
      balanceAfterPaise: 1400,
      paymentMode: 'upi',
      note: 'Paid via PhonePe',
      createdByName: 'Ramesh Sharma',
    });
  });

  it('allows paying in advance (negative balance)', async () => {
    const id = await addCustomer();

    const res = await owner.post(`/api/customers/${id}/payments`, { amountPaise: 50000, paymentMode: 'cash' });

    expect(res.body.customer.balancePaise).toBe(-50000);
  });

  it('validates the amount', async () => {
    const id = await addCustomer();

    expect((await owner.post(`/api/customers/${id}/payments`, { amountPaise: 0, paymentMode: 'cash' })).status).toBe(400);
    expect((await owner.post(`/api/customers/${id}/payments`, { amountPaise: 10.5, paymentMode: 'cash' })).status).toBe(400);
    expect((await owner.post(`/api/customers/${id}/payments`, { amountPaise: 100, paymentMode: 'udhaar' })).status).toBe(400);
  });

  it('lets staff take payments and give udhaar, recorded under their name', async () => {
    const id = await addCustomer();
    const staff = as(await createStaff(app, shop.tenantId));

    const bill = await staff.post('/api/bills', {
      items: [{ productId: soapId, quantityMilli: 1000 }],
      paymentMode: 'udhaar',
      customerId: id,
    });
    const pay = await staff.post(`/api/customers/${id}/payments`, { amountPaise: 1000, paymentMode: 'cash' });

    expect(bill.status).toBe(201);
    expect(pay.body.entry.createdByName).toBe('Staff Member');
    expect(pay.body.customer.balancePaise).toBe(2800);
  });
});

describe('ledger', () => {
  it('lists entries newest first, and the balance always equals sales minus payments', async () => {
    const id = await addCustomer();
    await udhaarBill(id, 2000); // +7600
    await owner.post(`/api/customers/${id}/payments`, { amountPaise: 5000, paymentMode: 'cash' }); // -5000
    await udhaarBill(id, 1000); // +3800

    const res = await owner.get(`/api/customers/${id}/ledger`);

    expect(res.body.total).toBe(3);
    expect(res.body.items.map((e: { type: string }) => e.type)).toEqual(['credit_sale', 'payment', 'credit_sale']);
    expect(res.body.items.map((e: { balanceAfterPaise: number }) => e.balanceAfterPaise)).toEqual([6400, 2600, 7600]);

    // The running balance on the customer matches the khata's history exactly.
    const all = await LedgerEntry.find({ tenantId: shop.tenantId, customerId: id });
    const fromHistory = all.reduce((sum, e) => sum + (e.type === 'credit_sale' ? e.amountPaise : -e.amountPaise), 0);
    expect(await balanceOf(id)).toBe(fromHistory);
  });
});

describe('tenant isolation', () => {
  it("never shows, edits, charges or pays into another shop's customers", async () => {
    const id = await addCustomer();
    await udhaarBill(id);
    const intruder = as((await registerShop(app, otherShop)).accessToken);

    expect((await intruder.get('/api/customers')).body.total).toBe(0);
    expect((await intruder.get(`/api/customers/${id}`)).status).toBe(404);
    expect((await intruder.get(`/api/customers/${id}/ledger`)).status).toBe(404);
    expect((await intruder.patch(`/api/customers/${id}`, { name: 'Hacked' })).status).toBe(404);
    expect((await intruder.post(`/api/customers/${id}/payments`, { amountPaise: 7600, paymentMode: 'cash' })).status).toBe(404);

    expect(await Customer.findOne({ _id: id, tenantId: shop.tenantId })).toMatchObject({
      name: 'Suresh Patil',
      balancePaise: 7600,
    });
  });
});
