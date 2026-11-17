import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../models/User';
import { verifyAccessToken } from '../services/token.service';
import { AppError } from '../utils/AppError';
import { ACCESS_COOKIE } from '../utils/authCookies';

export type AuthUser = { id: string; role: Role };

// Teach TypeScript that Express requests can carry the logged-in user and their tenant.
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    tenantId?: string;
  }
}

// Verifies the access token cookie and puts the user and tenant on the request.
// This is the ONLY place tenantId comes from: the signed token, never the body, query or
// headers, so a client cannot ask for another shop's data by sending a different id.
// It does not hit the database; the token's signature is the proof (see token.service).
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== 'string' || !token) throw new AppError(401, 'Please log in');

  const claims = verifyAccessToken(token);
  // Expired or tampered. The client reacts to any 401 by calling /auth/refresh once.
  if (!claims) throw new AppError(401, 'Session expired');

  req.user = { id: claims.sub, role: claims.role };
  req.tenantId = claims.tenantId;
  next();
}

// Use after authenticate: requireRole('owner') lets only owners through.
// 403 (not 401): we know who you are, you are just not allowed to do this.
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new AppError(401, 'Please log in');
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'You do not have permission to do this');
    }
    next();
  };
}

// For handlers behind authenticate: returns the auth info with non-optional types.
// If it throws, a route forgot to add authenticate, which is a bug (500), not a client error.
export function getAuth(req: Request): { userId: string; role: Role; tenantId: string } {
  if (!req.user || !req.tenantId) {
    throw new Error('getAuth() called on a route without the authenticate middleware');
  }
  return { userId: req.user.id, role: req.user.role, tenantId: req.tenantId };
}
