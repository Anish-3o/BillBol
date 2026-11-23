import mongoose from 'mongoose';
import request from 'supertest';

// These tests mock mongoose.connect, so they need no database. Each test loads a fresh copy
// of the modules, because connectDBOnce remembers its connection in module state.
type DbModule = typeof import('../src/config/db');
type VercelModule = typeof import('../src/vercel');

function loadFresh(): { db: DbModule; vercel: VercelModule; connect: jest.SpyInstance } {
  let db!: DbModule;
  let vercel!: VercelModule;
  let connect!: jest.SpyInstance;
  jest.isolateModules(() => {
    // The fresh module copy has its own mongoose instance; spy on that one.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const freshMongoose = require('mongoose') as typeof mongoose;
    connect = jest.spyOn(freshMongoose, 'connect');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    db = require('../src/config/db');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    vercel = require('../src/vercel');
  });
  return { db, vercel, connect };
}

afterEach(() => jest.restoreAllMocks());

describe('connectDBOnce', () => {
  it('connects once and reuses the connection, even for requests that arrive together', async () => {
    const { db, connect } = loadFresh();
    connect.mockResolvedValue(mongoose);

    await Promise.all([db.connectDBOnce(), db.connectDBOnce()]);
    await db.connectDBOnce();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('tries again on the next call after a failed connect', async () => {
    const { db, connect } = loadFresh();
    connect.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(mongoose);

    await expect(db.connectDBOnce()).rejects.toThrow('network down');
    await expect(db.connectDBOnce()).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe('Vercel handler', () => {
  it('serves API routes through Express', async () => {
    const { vercel, connect } = loadFresh();
    connect.mockResolvedValue(mongoose);

    const res = await request(vercel.default).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.service).toBe('billbol-api');
  });

  it('answers 503 JSON when the database cannot be reached', async () => {
    const { vercel, connect } = loadFresh();
    connect.mockRejectedValue(new Error('timed out'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(vercel.default).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain('try again');
  });
});
