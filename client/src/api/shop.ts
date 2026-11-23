import type { Tenant } from '../types/auth';
import type { Staff, StockReceipt } from '../types/stock';
import { api } from './client';

// Shop details (owner only). "" clears an optional field.
export type ShopInput = Partial<Pick<Tenant, 'name' | 'phone' | 'state'>> & {
  address?: string;
  gstin?: string;
  upiId?: string;
};
export const updateShop = (input: ShopInput) => api<Tenant>('/shop', 'PATCH', input);

// Staff logins (owner only).
export const listStaff = () => api<Staff[]>('/staff');
export const addStaff = (input: { name: string; phone: string; password: string }) => api<Staff>('/staff', 'POST', input);
export const removeStaff = (id: string) => api<void>(`/staff/${id}`, 'DELETE');

// Goods coming in: adds to stock and keeps a receipt.
export const receiveStock = (input: {
  items: { productId: string; quantityMilli: number }[];
  supplier?: string;
  note?: string;
}) => api<StockReceipt>('/stock/receive', 'POST', input);
export const listReceipts = (limit = 10) => api<StockReceipt[]>(`/stock/receipts?limit=${limit}`);
