import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

// Lets only the scheduler call /api/cron/* routes. Vercel Cron sends
// "Authorization: Bearer <CRON_SECRET>" with each scheduled request.
export function cronAuth(req: Request, _res: Response, next: NextFunction): void {
  // Not configured: behave as if the route does not exist, rather than leaving it open.
  if (!env.CRON_SECRET) throw new AppError(404, 'Not found');

  const sent = Buffer.from(req.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  // timingSafeEqual takes the same time whatever the input, so an attacker cannot work out the
  // secret one character at a time by measuring how fast wrong guesses are rejected.
  // It needs equal lengths, hence the length check first (the length is not the secret).
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    throw new AppError(401, 'Not allowed');
  }
  next();
}
