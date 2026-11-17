import type { NextFunction, Request, Response } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { AppError } from '../utils/AppError';

// Parses data with a Zod schema, or throws a 400 with per-field messages such as
// { phone: ['Enter a valid 10-digit mobile number'] } that the frontend shows next to each input.
export function parseOrThrow<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, 'Invalid request', result.error.flatten().fieldErrors);
  }
  return result.data;
}

// Validates req.body and replaces it with the parsed result, so controllers receive clean,
// normalised data (trimmed, lowercased email, 10-digit phone).
// Query strings are parsed in the controller with parseOrThrow instead, because Express 5
// makes req.query read-only.
export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = parseOrThrow(schema, req.body);
    next();
  };
}
