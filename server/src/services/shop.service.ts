import { Tenant } from '../models/Tenant';
import { AppError } from '../utils/AppError';
import type { UpdateShopInput } from '../validators/shop.validator';
import { toPublicTenant, type PublicTenant } from './auth.service';

// The shop's own details (name, address, GSTIN, UPI ID). The tenant id always comes from the
// logged-in user's token, so an owner can only ever change their own shop.
export async function updateShop(tenantId: string, input: UpdateShopInput): Promise<PublicTenant> {
  if (Object.keys(input).length === 0) throw new AppError(400, 'Nothing to update');
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new AppError(401, 'Session expired, please log in again');

  // null means "clear it". Setting undefined makes Mongoose remove the field, so an empty
  // GSTIN is gone rather than stored as null (and a cleared shop bills without GST again;
  // bills already saved keep their own tax mode).
  for (const [key, value] of Object.entries(input)) {
    tenant.set(key, value === null ? undefined : value);
  }
  return toPublicTenant(await tenant.save());
}
