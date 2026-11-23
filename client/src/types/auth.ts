// Mirrors PublicUser / PublicTenant in server/src/services/auth.service.ts.

export type Role = 'owner' | 'staff';

export type User = {
  id: string;
  tenantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
};

export type Tenant = {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  state: string;
  gstin: string | null;
  address: string | null;
  upiId: string | null;
};

// What /auth/me, /auth/login, /auth/register and /auth/refresh all return.
export type Session = { user: User; tenant: Tenant };

export type RegisterInput = {
  shopName: string;
  ownerName: string;
  phone: string;
  email: string;
  state: string;
  gstin: string;
  password: string;
};
