import type { FilterQuery } from 'mongoose';
import {
  CASE_INSENSITIVE,
  COUNT_UNITS,
  Product,
  type ProductAttrs,
  type ProductDoc,
} from '../models/Product';
import { AppError } from '../utils/AppError';
import { isObjectIdString } from '../utils/objectId';
import type {
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from '../validators/product.validator';

// Every function takes tenantId as its first argument, always from getAuth(req), never
// from the request body. The tenantScoped plugin throws if a query forgets it.

export type PublicProduct = {
  id: string;
  name: string;
  localName: string | null;
  unit: string;
  pricePaise: number;
  mrpPaise: number | null;
  gstRate: number;
  hsn: string | null;
  stockMilli: number;
  lowStockMilli: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductList = { items: PublicProduct[]; total: number; page: number; limit: number };

const NOT_FOUND = 'Product not found';

export async function listProducts(tenantId: string, query: ListProductsQuery): Promise<ProductList> {
  const filter: FilterQuery<ProductAttrs> = { tenantId, isActive: !query.archived };
  if (query.q) {
    // Escape the search text before building a regex. Otherwise "(" causes a server error,
    // and a crafted pattern could make the regex engine hang (ReDoS).
    const pattern = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: pattern }, { localName: pattern }];
  }

  const [items, total] = await Promise.all([
    Product.find(filter)
      .collation(CASE_INSENSITIVE) // sort "atta" next to "Atta", not after all capitals
      .sort({ name: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    Product.countDocuments(filter),
  ]);

  return { items: items.map(toPublicProduct), total, page: query.page, limit: query.limit };
}

export async function getProduct(tenantId: string, id: string): Promise<PublicProduct> {
  return toPublicProduct(await findOwnedProduct(tenantId, id));
}

export async function createProduct(
  tenantId: string,
  input: CreateProductInput,
): Promise<PublicProduct> {
  const product = new Product({ ...input, tenantId });
  return toPublicProduct(await checkAndSave(product));
}

export async function updateProduct(
  tenantId: string,
  id: string,
  input: UpdateProductInput,
): Promise<PublicProduct> {
  if (Object.keys(input).length === 0) throw new AppError(400, 'Nothing to update');

  // Load, change, save (instead of one findOneAndUpdate) so the cross-field rules below
  // see the final product, e.g. a new price checked against the MRP already stored.
  const product = await findOwnedProduct(tenantId, id);
  product.set(input);
  return toPublicProduct(await checkAndSave(product));
}

// Archive, not delete: past bills still reference this product (see isActive in the model).
export async function archiveProduct(tenantId: string, id: string): Promise<PublicProduct> {
  const product = await findOwnedProduct(tenantId, id);
  product.isActive = false;
  return toPublicProduct(await product.save());
}

// Another shop's product id gives 404, not 403: a 403 would confirm the id exists.
async function findOwnedProduct(tenantId: string, id: string): Promise<ProductDoc> {
  if (!isObjectIdString(id)) throw new AppError(404, NOT_FOUND);
  const product = await Product.findOne({ _id: id, tenantId });
  if (!product) throw new AppError(404, NOT_FOUND);
  return product;
}

// Rules that involve more than one field live here, in one place for create and update,
// rather than in the Zod schemas (an update may change only one of the fields involved).
async function checkAndSave(product: ProductDoc): Promise<ProductDoc> {
  const errors: Record<string, string[]> = {};

  if (product.mrpPaise != null && product.pricePaise > product.mrpPaise) {
    errors.pricePaise = ['Selling price cannot be more than MRP'];
  }
  if ((COUNT_UNITS as readonly string[]).includes(product.unit)) {
    const whole = `Must be a whole number for ${product.unit}`;
    if (product.stockMilli % 1000 !== 0) errors.stockMilli = [whole];
    if (product.lowStockMilli % 1000 !== 0) errors.lowStockMilli = [whole];
  }
  if (Object.keys(errors).length > 0) throw new AppError(400, 'Invalid request', errors);

  try {
    return await product.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new AppError(409, 'A product with this name already exists', {
        name: ['You already have a product with this name'],
      });
    }
    throw err;
  }
}

export function toPublicProduct(p: ProductDoc): PublicProduct {
  return {
    id: p.id,
    name: p.name,
    localName: p.localName ?? null,
    unit: p.unit,
    pricePaise: p.pricePaise,
    mrpPaise: p.mrpPaise ?? null,
    gstRate: p.gstRate,
    hsn: p.hsn ?? null,
    stockMilli: p.stockMilli,
    lowStockMilli: p.lowStockMilli,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 11000 is MongoDB's "duplicate key" error code (a unique index rejected the write).
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}
