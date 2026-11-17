import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

// Express recognises an error handler by its four arguments, so _next must stay.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
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
