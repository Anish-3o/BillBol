import bcrypt from 'bcrypt';
import { RefreshToken } from '../models/RefreshToken';
import { User, type UserDoc } from '../models/User';
import { AppError } from '../utils/AppError';
import { isObjectIdString } from '../utils/objectId';
import type { AddStaffInput } from '../validators/staff.validator';
import { SALT_ROUNDS } from './auth.service';

export type PublicStaff = { id: string; name: string; phone: string | null; createdAt: string };

// Owner-only (see staff.routes). Only 'staff' users are listed or removed here: the owner's
// own account can never be deleted from this screen, by mistake or otherwise.

export async function listStaff(tenantId: string): Promise<PublicStaff[]> {
  const staff = await User.find({ tenantId, role: 'staff' }).sort({ createdAt: 1 });
  return staff.map(toPublicStaff);
}

export async function addStaff(tenantId: string, input: AddStaffInput): Promise<PublicStaff> {
  // Login is "phone + password" with no shop picker, so a phone is unique across all shops.
  if (await User.exists({ phone: input.phone })) {
    throw new AppError(409, 'This phone number already has a BillBol account', {
      phone: ['This number already has a BillBol account'],
    });
  }
  const user = await User.create({
    tenantId,
    name: input.name,
    phone: input.phone,
    passwordHash: await bcrypt.hash(input.password, SALT_ROUNDS),
    role: 'staff',
  });
  return toPublicStaff(user);
}

// A helper who left. Their account is deleted and every refresh token revoked, so they cannot
// get a new session. Their current access token stays valid until it expires (at most 15
// minutes): access tokens are checked by signature alone, without a database lookup, which is
// the trade-off that keeps every other request fast. Bills they made keep their name, because
// bills store a copy of it.
export async function removeStaff(tenantId: string, id: string): Promise<void> {
  if (!isObjectIdString(id)) throw new AppError(404, 'Staff member not found');
  const removed = await User.findOneAndDelete({ _id: id, tenantId, role: 'staff' });
  if (!removed) throw new AppError(404, 'Staff member not found');
  await RefreshToken.updateMany({ tenantId, userId: removed._id, revokedAt: null }, { revokedAt: new Date() });
}

function toPublicStaff(u: UserDoc): PublicStaff {
  return { id: u.id, name: u.name, phone: u.phone ?? null, createdAt: u.createdAt.toISOString() };
}
