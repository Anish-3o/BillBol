// bcryptjs (pure JavaScript) instead of bcrypt (native C++ addon): it installs and runs anywhere,
// including Vercel's serverless functions, with no compiled binary. Hashes are interchangeable.
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { RefreshToken } from '../models/RefreshToken';
import { Tenant, type TenantDoc } from '../models/Tenant';
import { User, type UserDoc } from '../models/User';
import { AppError } from '../utils/AppError';
import {
  emailSchema,
  phoneSchema,
  type LoginInput,
  type RegisterInput,
} from '../validators/auth.validator';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './token.service';

// Cost factor 12 takes roughly 200-300 ms per hash: slow enough to make brute-forcing a
// stolen hash expensive, fast enough for a login. Tests use the minimum (4) to stay quick.
export const SALT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;

// The same message for "no such user" and "wrong password", so the login form
// cannot be used to discover which phone numbers have accounts.
const INVALID_CREDENTIALS = 'Invalid phone/email or password';
const ACCOUNT_EXISTS = 'An account with this phone or email already exists';
const SESSION_EXPIRED = 'Session expired, please log in again';

export type PublicUser = {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
};

export type PublicTenant = {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  state: string;
  gstin: string | null;
  address: string | null; // printed on receipts
  upiId: string | null; // for "scan to pay" QR codes
};

export type AuthTokens = { accessToken: string; refreshToken: string };

export type AuthResult = { user: PublicUser; tenant: PublicTenant; tokens: AuthTokens };

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await User.exists({
    $or: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])],
  });
  if (existing) throw new AppError(409, ACCOUNT_EXISTS);

  // Hash before creating anything, so a slow hash does not widen the gap between the two writes.
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const tenant = await Tenant.create({
    name: input.shopName,
    ownerName: input.ownerName,
    phone: input.phone,
    state: input.state,
    gstin: input.gstin,
  });

  // Creating the shop and its owner should be all-or-nothing. MongoDB transactions need a
  // replica set, and our local Mongo is a single node, so instead we undo the tenant by hand
  // if the user insert fails. That covers the rare race where two requests register the same
  // phone at once: the existence check above passes for both, and the unique index rejects one.
  let user: UserDoc;
  try {
    user = await User.create({
      tenantId: tenant._id,
      name: input.ownerName,
      phone: input.phone,
      email: input.email,
      passwordHash,
      role: 'owner',
    });
  } catch (err) {
    await Tenant.deleteOne({ _id: tenant._id });
    if (isDuplicateKeyError(err)) throw new AppError(409, ACCOUNT_EXISTS);
    throw err;
  }

  return startSession(user, tenant, randomUUID());
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const query = identifierToQuery(input.identifier);
  if (!query) throw new AppError(401, INVALID_CREDENTIALS);

  // Login is the one place we look a user up without a tenant filter: nobody is logged in yet,
  // so there is no tenant to filter by. Phone and email are globally unique (see User model),
  // so this finds at most one user, and the tenant comes from that user, never from the client.
  const user = await User.findOne(query).select('+passwordHash');
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new AppError(401, INVALID_CREDENTIALS);
  }

  const tenant = await Tenant.findById(user.tenantId);
  // Every user is created with a tenant, so this means corrupted data: a 500, not a 401.
  if (!tenant) throw new Error(`User ${user.id} has no tenant ${String(user.tenantId)}`);

  // Each login starts a new token family (one per device), so logging out on the shop
  // counter does not log the owner out on their phone.
  return startSession(user, tenant, randomUUID());
}

// Refresh-token rotation: every refresh token works exactly once. Using it returns a new
// access token AND a new refresh token, and the old refresh token is revoked.
export async function refresh(rawToken: string | undefined): Promise<AuthResult> {
  const claims = rawToken ? verifyRefreshToken(rawToken) : null;
  if (!claims) throw new AppError(401, SESSION_EXPIRED);

  // Atomic "use it up": find a token that is NOT yet revoked and revoke it in one operation.
  // If two requests race with the same token, MongoDB lets only one of them match.
  const used = await RefreshToken.findOneAndUpdate(
    { _id: claims.jti, userId: claims.sub, revokedAt: null },
    { revokedAt: new Date() },
  );

  if (!used) {
    // The signature was valid, so this token was really issued by us, but it has already been
    // used (or logged out). The real user always holds the newest token, so an old one being
    // replayed means someone kept a copy: revoke the whole family to lock them out.
    const replayed = await RefreshToken.findById(claims.jti);
    if (replayed) await revokeFamily(replayed.familyId);
    throw new AppError(401, SESSION_EXPIRED);
  }

  // Re-read the user so the new access token has their current role, and a deleted user
  // cannot keep refreshing. Filtered by the tenant stored with the token.
  const user = await User.findOne({ _id: used.userId, tenantId: used.tenantId });
  const tenant = user && (await Tenant.findById(used.tenantId));
  if (!user || !tenant) {
    await revokeFamily(used.familyId);
    throw new AppError(401, SESSION_EXPIRED);
  }

  return startSession(user, tenant, used.familyId);
}

// Logout ends this device's session (its token family). It never fails: even with a missing,
// expired or already-revoked token, the caller still clears the cookies.
export async function logout(rawToken: string | undefined): Promise<void> {
  const claims = rawToken ? verifyRefreshToken(rawToken) : null;
  if (!claims) return;

  const record = await RefreshToken.findOne({ _id: claims.jti, userId: claims.sub });
  if (record) await revokeFamily(record.familyId);
}

// Both conditions together: the user must exist AND belong to the tenant in the token.
// Even a validly signed token that pairs a user with another shop's tenantId finds nothing.
export async function getCurrentUser(auth: {
  userId: string;
  tenantId: string;
}): Promise<{ user: PublicUser; tenant: PublicTenant }> {
  const user = await User.findOne({ _id: auth.userId, tenantId: auth.tenantId });
  const tenant = user && (await Tenant.findById(auth.tenantId));
  // The account was removed after the token was issued.
  if (!user || !tenant) throw new AppError(401, SESSION_EXPIRED);

  return { user: toPublicUser(user), tenant: toPublicTenant(tenant) };
}

async function startSession(user: UserDoc, tenant: TenantDoc, familyId: string): Promise<AuthResult> {
  const record = await RefreshToken.create({
    tenantId: tenant._id,
    userId: user._id,
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });

  const publicUser = toPublicUser(user);
  return {
    user: publicUser,
    tenant: toPublicTenant(tenant),
    tokens: {
      accessToken: signAccessToken({
        id: publicUser.id,
        tenantId: publicUser.tenantId,
        role: user.role,
      }),
      refreshToken: signRefreshToken(publicUser.id, record.id),
    },
  };
}

async function revokeFamily(familyId: string): Promise<void> {
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
}

// "Phone or email" comes in as one string. Normalise it exactly like registration did,
// otherwise "+91 98765 43210" would not match the stored "9876543210".
function identifierToQuery(identifier: string): { email: string } | { phone: string } | null {
  if (identifier.includes('@')) {
    const email = emailSchema.safeParse(identifier);
    return email.success ? { email: email.data } : null;
  }
  const phone = phoneSchema.safeParse(identifier);
  return phone.success ? { phone: phone.data } : null;
}

// Explicit allow-list of fields sent to the client, so new model fields
// (or the password hash) are never exposed by accident.
function toPublicUser(user: UserDoc): PublicUser {
  return {
    id: user.id,
    tenantId: user.tenantId.toString(),
    name: user.name,
    phone: user.phone ?? null,
    email: user.email ?? null,
    role: user.role,
  };
}

export function toPublicTenant(tenant: TenantDoc): PublicTenant {
  return {
    id: tenant.id,
    name: tenant.name,
    ownerName: tenant.ownerName,
    phone: tenant.phone,
    state: tenant.state,
    gstin: tenant.gstin ?? null,
    address: tenant.address ?? null,
    upiId: tenant.upiId ?? null,
  };
}

// 11000 is MongoDB's "duplicate key" error code (a unique index rejected the insert).
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}
