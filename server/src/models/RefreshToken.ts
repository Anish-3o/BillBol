import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';

// One document per refresh token ever issued. The JWT's `jti` claim is this document's _id.
// A JWT on its own cannot be "used up", so this record is what makes rotation possible:
// using a token marks it revoked, and a revoked token is never accepted again.
//
// We store only the id, not the token itself: without JWT_REFRESH_SECRET, knowing an id
// is useless, so a leaked database does not leak working sessions.
const refreshTokenSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // All tokens from one login share a familyId (one family = one device session).
    // If a revoked token is presented again, someone has a copy of it, so we revoke
    // the whole family and both the thief and the real user must log in again.
    familyId: { type: String, required: true, index: true },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// TTL index: MongoDB deletes each record automatically once expiresAt has passed.
// Revoked records are kept until then so reuse can still be detected.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenDoc = HydratedDocument<InferSchemaType<typeof refreshTokenSchema>>;

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
