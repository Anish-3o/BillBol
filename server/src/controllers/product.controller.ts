import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import { parseOrThrow } from '../middleware/validate';
import * as productService from '../services/product.service';
import {
  listProductsQuerySchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '../validators/product.validator';

// tenantId always comes from getAuth(req), i.e. the signed access token.

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseOrThrow(listProductsQuerySchema, req.query);
  res.json(await productService.listProducts(getAuth(req).tenantId, query));
}

export async function get(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await productService.getProduct(getAuth(req).tenantId, req.params.id));
}

export async function create(req: Request, res: Response): Promise<void> {
  const product = await productService.createProduct(
    getAuth(req).tenantId,
    req.body as CreateProductInput,
  );
  res.status(201).json(product);
}

export async function update(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(
    await productService.updateProduct(
      getAuth(req).tenantId,
      req.params.id,
      req.body as UpdateProductInput,
    ),
  );
}

export async function archive(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await productService.archiveProduct(getAuth(req).tenantId, req.params.id));
}
