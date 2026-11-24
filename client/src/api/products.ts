import type { PriceRow } from '../lib/priceList';
import type { Product, ProductInput, ProductList } from '../types/product';
import { api } from './client';

export function listProducts(params: { q?: string; limit?: number; page?: number } = {}): Promise<ProductList> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return api<ProductList>(`/products${qs ? `?${qs}` : ''}`);
}

export const getProduct = (id: string) => api<Product>(`/products/${id}`);

export const createProduct = (input: ProductInput) => api<Product>('/products', 'POST', input);

export const updateProduct = (id: string, input: Partial<ProductInput>) =>
  api<Product>(`/products/${id}`, 'PATCH', input);

// The server archives (soft-deletes) the product.
export const archiveProduct = (id: string) => api<Product>(`/products/${id}`, 'DELETE');

// What the barcode scanner read -> the shop's product (404 ApiError if no product has it).
export const findProductByBarcode = (code: string) =>
  api<Product>(`/products/barcode/${encodeURIComponent(code)}`);

export type PriceChange = {
  productId: string;
  name: string;
  oldPricePaise: number;
  pricePaise: number;
  oldMrpPaise: number | null;
  mrpPaise: number | null;
};
export type PriceUpdateResult = {
  applied: boolean;
  changes: PriceChange[];
  unchanged: number;
  notFound: string[];
  invalid: { row: string; message: string }[];
};

// Bulk price update from a price list: apply: false previews, apply: true saves.
export const updatePrices = (rows: PriceRow[], apply: boolean) =>
  api<PriceUpdateResult>('/products/prices', 'POST', { rows, apply });
