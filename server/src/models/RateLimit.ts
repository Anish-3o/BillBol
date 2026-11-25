import { model, Schema } from 'mongoose';

// One counter per (limiter, client, time window), e.g. "login:203.0.113.7:1764050400000".
// Stored in MongoDB rather than in memory because on Vercel every serverless instance has its
// own memory: an in-memory counter would reset on each cold start and be split across
// instances, so an attacker could simply spread requests out. The database is shared by all.
//
// This is NOT a business model, so it has no tenantId: limits apply before we know (or
// trust) which shop a request is for, e.g. on login.
const rateLimitSchema = new Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
});

// TTL index: MongoDB deletes each counter once its window is over, so the collection stays tiny.
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = model('RateLimit', rateLimitSchema);
