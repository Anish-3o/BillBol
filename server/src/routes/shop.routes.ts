import { Router } from 'express';
import * as shopController from '../controllers/shop.controller';
import { authenticate, requireRole } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { updateShopSchema } from '../validators/shop.validator';

export const shopRouter = Router();

// Reading the shop needs no route of its own: every session (/auth/me) already includes it.
// Changing it is owner-only: the GSTIN decides how bills are taxed and the UPI ID decides
// whose bank account customers pay into.
shopRouter.patch('/', authenticate, requireRole('owner'), validate(updateShopSchema), shopController.update);
