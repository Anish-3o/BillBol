import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const ROLES = ['owner', 'staff'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    // select: false keeps the hash out of every query unless a query explicitly asks for it
    // (only login does), so it cannot leak into an API response by accident.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'staff' },
  },
  { timestamps: true },
);

// Login is "phone or email + password" with no shop picker, so a phone or email must point to
// exactly one user across ALL shops. That is why these indexes are global, not per tenant.
// partialFilterExpression: only index users that actually have the field, so many users can
// have no email without colliding on "null".
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);

// A user must be reachable by at least one login identifier.
userSchema.pre('validate', function () {
  if (!this.phone && !this.email) {
    this.invalidate('phone', 'A user needs a phone number or an email');
  }
});

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;

export const User = model('User', userSchema);
