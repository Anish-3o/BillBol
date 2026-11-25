import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { RateLimit } from '../models/RateLimit';
import { AppError } from '../utils/AppError';

type RateLimitOptions = {
  /** Short name, part of the counter key, so different limiters never share a count. */
  name: string;
  windowMs: number;
  /** Requests allowed per client per window. */
  max: number;
  /** Who is being limited: usually the IP address. */
  key: (req: Request) => string;
  message: string;
  /**
   * Count only requests that fail (status 400+). Used for login, so a brute-force attempt
   * is stopped while a shop full of staff logging in correctly (or a room trying the live
   * demo from one Wi-Fi network) is never blocked.
   */
  failedOnly?: boolean;
  /**
   * Off in tests by default: the other test files log in many times from the same address
   * and would trip the limits. tests/rateLimit.test.ts turns it on explicitly.
   */
  enabled?: boolean;
};

// The client's IP address. On Vercel, app.ts sets "trust proxy" so this is the visitor's
// address from X-Forwarded-For (which Vercel overwrites, so it cannot be spoofed) rather than
// the address of Vercel's own proxy, which would put every visitor in one bucket.
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

// Adds 1 to a counter and returns the new count, creating the counter if needed.
// findOneAndUpdate with $inc is atomic, so two requests at the same moment both get counted.
async function hit(key: string, expiresAt: Date): Promise<number> {
  const bump = () =>
    RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true },
    ).lean();
  try {
    return (await bump())!.count;
  } catch (err) {
    // Two requests can both try to insert the same new counter; one loses with a duplicate-key
    // error. By then the counter exists, so trying once more simply increments it.
    if ((err as { code?: number }).code === 11000) return (await bump())!.count;
    throw err;
  }
}

// A fixed-window rate limiter: at most `max` requests per client in each window
// (e.g. 10:00-10:15, 10:15-10:30). Simpler than a sliding window and enough to stop password
// guessing and runaway AI bills; the worst case is 2 x max across a window boundary.
export function rateLimit(options: RateLimitOptions) {
  const enabled = options.enabled ?? env.NODE_ENV !== 'test';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!enabled) return next();

    const now = Date.now();
    const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
    const resetAt = windowStart + options.windowMs;
    const key = `${options.name}:${options.key(req)}:${windowStart}`;

    let count: number;
    try {
      count = await hit(key, new Date(resetAt));
    } catch (err) {
      // Fail open: if the counter cannot be updated, a shopkeeper must still be able to bill.
      // The limiter protects against abuse; it must never be the thing that takes the shop down.
      console.error('Rate limiter unavailable, letting the request through:', err);
      return next();
    }

    if (count > options.max) {
      // Tells the client (and well-behaved bots) how many seconds to wait.
      res.setHeader('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
      throw new AppError(429, options.message);
    }

    if (options.failedOnly) {
      // We counted the request up front (so parallel guesses cannot slip past the check).
      // If it turns out to have succeeded, give the attempt back.
      res.on('finish', () => {
        if (res.statusCode < 400) {
          RateLimit.updateOne({ key }, { $inc: { count: -1 } }).catch((err: unknown) =>
            console.error('Rate limiter could not refund a successful request:', err),
          );
        }
      });
    }

    next();
  };
}

const MINUTE = 60_000;

// Password guessing: 10 wrong passwords per address per 15 minutes. Correct logins are free.
export const loginLimiter = rateLimit({
  name: 'login',
  windowMs: 15 * MINUTE,
  max: 10,
  key: clientIp,
  failedOnly: true,
  message: 'Too many wrong attempts. Please wait 15 minutes and try again.',
});

// Fake shop sign-ups: 10 new shops per address per hour is far more than any real person needs.
export const registerLimiter = rateLimit({
  name: 'register',
  windowMs: 60 * MINUTE,
  max: 10,
  key: clientIp,
  message: 'Too many new shops from this network. Please try again in an hour.',
});

// AI and voice calls cost money per request (Claude, Sarvam). A busy counter doing a voice bill
// every two minutes uses roughly 3 calls each (hear, understand, speak), about 90 an hour, so 300
// leaves plenty of room. Keyed by user AND address: everyone trying the shared demo account
// gets their own allowance, and one person cannot use up the whole demo shop's.
export const aiLimiter = rateLimit({
  name: 'ai',
  windowMs: 60 * MINUTE,
  max: 300,
  key: (req) => `${req.user?.id ?? 'anon'}:${clientIp(req)}`,
  message: 'Ramu needs a short break. Please try again in a few minutes, or type the bill.',
});
