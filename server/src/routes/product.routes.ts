import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import { authenticate, requireRole } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createProductSchema, priceUpdateSchema, updateProductSchema } from '../validators/product.validator';

export const productRouter = Router();

// Every product route needs login.
productRouter.use(authenticate);

// Staff can look up products (they make bills). Only the owner can change the catalogue,
// because prices and stock are the owner's money.
productRouter.get('/', productController.list);
// The counter's barcode scanner. Registered before '/:id', which would otherwise match it.
productRouter.get('/barcode/:code', productController.byBarcode);
productRouter.get('/:id', productController.get);
productRouter.post('/', requireRole('owner'), validate(createProductSchema), productController.create);
// Bulk price update from an uploaded price list (preview first, then apply).
productRouter.post('/prices', requireRole('owner'), validate(priceUpdateSchema), productController.updatePrices);
productRouter.patch(
  '/:id',
  requireRole('owner'),
  validate(updateProductSchema),
  productController.update,
);
// DELETE archives the product (soft delete); see product.service.
productRouter.delete('/:id', requireRole('owner'), productController.archive);
