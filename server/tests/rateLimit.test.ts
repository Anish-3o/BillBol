import express, { type Request } from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/errorHandler';
import { rateLimit } from '../src/middleware/rateLimit';
import { RateLimit } from '../src/models/RateLimit';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

beforeAll(connectTestDB);
afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDB();
});
afterAll(closeTestDB);

// A tiny app around one limiter. The client "address" comes from a test header so each test
// can act as one or several visitors. ?fail=1 makes the route answer 401, like a wrong password.
// The window is fixed to the clock (e.g. 10:00-10:15), so a short window could end in the middle
// of a test and reset the count. A year-long window keeps every test inside one window.
const WINDOW_MS = 365 * 24 * 60 * 60_000;

function appWith(options: Partial<Parameters<typeof rateLimit>[0]> = {}) {
  const app = express();
  const limiter = rateLimit({
    name: 'test',
    windowMs: WINDOW_MS,
    max: 3,
    key: (req: Request) => req.get('x-test-client') ?? 'a',
    message: 'Slow down',
    enabled: true,
    ...options,
  });
  app.post('/try', limiter, (req, res) => {
    res.status(req.query.fail ? 401 : 200).json({ ok: !req.query.fail });
  });
  app.use(errorHandler);
  return app;
}

const send = (app: express.Express, client = 'a', fail = false) =>
  request(app).post(`/try${fail ? '?fail=1' : ''}`).set('x-test-client', client);

describe('rateLimit', () => {
  it('allows `max` requests, then answers 429 with Retry-After', async () => {
    const app = appWith();
    for (let i = 0; i < 3; i++) expect((await send(app)).status).toBe(200);

    const blocked = await send(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toBe('Slow down');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_MS / 1000);
  });

  it('counts each client separately', async () => {
    const app = appWith();
    for (let i = 0; i < 4; i++) await send(app, 'a');

    expect((await send(app, 'a')).status).toBe(429);
    expect((await send(app, 'b')).status).toBe(200);
  });

  it('counts requests that arrive at the same moment exactly (atomic increment)', async () => {
    const app = appWith();
    const results = await Promise.all(Array.from({ length: 6 }, () => send(app)));
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
  });

  it('with failedOnly, correct logins never use up the allowance', async () => {
    const app = appWith({ failedOnly: true });
    for (let i = 0; i < 6; i++) {
      expect((await send(app)).status).toBe(200);
      // The refund happens when the response finishes; wait for it before the next request.
      await waitForCount(0);
    }
  });

  it('with failedOnly, wrong attempts are counted and then blocked', async () => {
    const app = appWith({ failedOnly: true });
    for (let i = 0; i < 3; i++) expect((await send(app, 'a', true)).status).toBe(401);

    // Blocked now, even with the right password.
    expect((await send(app, 'a', false)).status).toBe(429);
  });

  it('lets requests through if the counter cannot be updated (fails open)', async () => {
    const app = appWith({ max: 0 });
    jest.spyOn(RateLimit, 'findOneAndUpdate').mockImplementation(() => {
      throw new Error('database down');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await send(app)).status).toBe(200);
  });

  it('is switched off in tests unless asked for, so other test files are not affected', async () => {
    const app = appWith({ max: 0, enabled: undefined });

    expect((await send(app)).status).toBe(200);
    expect(await RateLimit.countDocuments()).toBe(0);
  });

  it('stores counters that expire at the end of their window', async () => {
    const before = Date.now();
    await send(appWith());

    const counter = await RateLimit.findOne().lean();
    expect(counter?.key).toMatch(/^test:a:\d+$/);
    expect(counter!.expiresAt.getTime()).toBeGreaterThan(before);
    expect(counter!.expiresAt.getTime()).toBeLessThanOrEqual(before + WINDOW_MS);
  });
});

async function waitForCount(expected: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const counter = await RateLimit.findOne().lean();
    if ((counter?.count ?? 0) === expected) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Counter never reached ${expected}`);
}
