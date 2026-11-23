import type { CashMode, Customer, CustomerList, LedgerEntry } from '../types/customer';
import { api } from './client';

export function listCustomers(params: { q?: string; limit?: number } = {}): Promise<CustomerList> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return api<CustomerList>(`/customers${qs ? `?${qs}` : ''}`);
}

export const getCustomer = (id: string) => api<Customer>(`/customers/${id}`);

export const createCustomer = (input: { name: string; phone: string | null }) =>
  api<Customer>('/customers', 'POST', input);

export const getLedger = (id: string, limit = 50) =>
  api<{ items: LedgerEntry[]; total: number }>(`/customers/${id}/ledger?limit=${limit}`);

export const recordPayment = (id: string, input: { amountPaise: number; paymentMode: CashMode; note?: string }) =>
  api<{ customer: Customer; entry: LedgerEntry }>(`/customers/${id}/payments`, 'POST', input);
