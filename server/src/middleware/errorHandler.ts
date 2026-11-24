import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

// Errors thrown by Express's body parsers (express.json / express.raw) carry a `type`.
// They are the client's mistake, so they get a 4xx with a clear message instead of a 500.
const BODY_ERRORS: Record<string, [number, string]> = {
  'entity.too.large': [413, 'Too large. For voice, speak a few items at a time.'],
  'entity.parse.failed': [400, 'The request body is not valid JSON'],
};

// Express recognises an error handler by its four arguments, so _next must stay.
export function errorHandler(thrown: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const bodyError = BODY_ERRORS[(thrown as { type?: string } | null)?.type ?? ''];
  const err = bodyError ? new AppError(...bodyError) : thrown;

  const isAppError = err instanceof AppError;
  const status = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : 'Something went wrong';

  if (status === 500) console.error(err);

  res.status(status).json({
    error: {
      message,
      ...(isAppError && err.details !== undefined ? { details: err.details } : {}),
      ...(env.NODE_ENV === 'development' && err instanceof Error ? { stack: err.stack } : {}),
    },
  });
}
