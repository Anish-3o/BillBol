import { Types } from 'mongoose';
import { Product } from '../src/models/Product';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

// The plugin is the safety net for Rule 1: a query on tenant data without a tenantId
// must fail loudly instead of touching every shop's data.

const tenantId = new Types.ObjectId();
const NO_TENANT = /without a tenantId filter/;

beforeAll(connectTestDB);
beforeEach(async () => {
  await Product.create({ tenantId, name: 'Sugar', unit: 'kg', pricePaise: 4500, gstRate: 5 });
});
afterEach(clearTestDB);
afterAll(closeTestDB);

describe('tenantScoped plugin', () => {
  it('allows queries that filter by tenantId', async () => {
    expect(await Product.find({ tenantId })).toHaveLength(1);
    expect(await Product.countDocuments({ tenantId })).toBe(1);
    expect(await Product.aggregate([{ $match: { tenantId } }])).toHaveLength(1);
  });

  it('throws on reads without tenantId', async () => {
    await expect(Product.find({})).rejects.toThrow(NO_TENANT);
    await expect(Product.findOne({ name: 'Sugar' })).rejects.toThrow(NO_TENANT);
    await expect(Product.countDocuments()).rejects.toThrow(NO_TENANT);
    await expect(Product.exists({ name: 'Sugar' })).rejects.toThrow(NO_TENANT);
  });

  it('throws on findById, which cannot carry a tenant filter', async () => {
    const product = await Product.findOne({ tenantId });
    await expect(Product.findById(product!._id)).rejects.toThrow(NO_TENANT);
  });

  it('throws on updates and deletes without tenantId', async () => {
    await expect(Product.updateMany({}, { pricePaise: 1 })).rejects.toThrow(NO_TENANT);
    await expect(Product.findOneAndUpdate({ name: 'Sugar' }, { pricePaise: 1 })).rejects.toThrow(
      NO_TENANT,
    );
    await expect(Product.deleteMany({})).rejects.toThrow(NO_TENANT);
    // Nothing was changed.
    expect((await Product.findOne({ tenantId }))!.pricePaise).toBe(4500);
  });

  it('throws on an aggregate that does not start with a tenant $match', async () => {
    await expect(Product.aggregate([{ $match: { name: 'Sugar' } }])).rejects.toThrow(/tenantId/);
    await expect(Product.aggregate([{ $sort: { name: 1 } }])).rejects.toThrow(/tenantId/);
  });
});
