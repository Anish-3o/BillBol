import type { Product, ProductInput, ProductList } from '../types/product';
import { api } from './client';

export function listProducts(params: { q?: string; limit?: number } = {}): Promise<ProductList> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.limit) search.set('limit', String(params.limit));
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
