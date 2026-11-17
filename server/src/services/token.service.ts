import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { ROLES, type Role } from '../models/User';
import { isObjectIdString } from '../utils/objectId';

// One source of truth for lifetimes: the JWT expiry and the cookie maxAge both use these.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type AccessTokenClaims = { sub: string; tenantId: string; role: Role };
export type RefreshTokenClaims = { sub: string; jti: string };

// The access token carries what every request needs (who, which shop, what role), so
// protected routes can authorise without a database lookup. It is short-lived because a
// stateless token cannot be revoked; if one leaks, it is useless within 15 minutes.
export function signAccessToken(user: { id: string; tenantId: string; role: Role }): string {
  return jwt.sign({ tenantId: user.tenantId, role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

// The refresh token only identifies the user and its own database record (jti).
// When it is exchanged, the server re-reads the user from the DB, so role changes or a
// removed staff member take effect within one access-token lifetime.
export function signRefreshToken(userId: string, tokenId: string): string {
  return jwt.sign({}, env.JWT_REFRESH_SECRET, {
    subject: userId,
    jwtid: tokenId,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

// Both verify functions return null for anything wrong (bad signature, expired, malformed),
// so callers only deal with "valid claims" or "not logged in".
export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const p = verify(token, env.JWT_ACCESS_SECRET);
  if (!p || !isObjectIdString(p.sub) || !isObjectIdString(p.tenantId) || !isRole(p.role)) return null;
  return { sub: p.sub, tenantId: p.tenantId, role: p.role };
}

export function verifyRefreshToken(token: string): RefreshTokenClaims | null {
  const p = verify(token, env.JWT_REFRESH_SECRET);
  if (!p || !isObjectIdString(p.sub) || !isObjectIdString(p.jti)) return null;
  return { sub: p.sub, jti: p.jti };
}

function verify(token: string, secret: string): JwtPayload | null {
  try {
    // Pinning the algorithm stops "algorithm confusion" attacks, where a forged token
    // says alg: "none" (or another algorithm) to get past signature checking.
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
