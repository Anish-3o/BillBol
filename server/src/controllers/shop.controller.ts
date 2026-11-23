import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import { updateShop } from '../services/shop.service';
import type { UpdateShopInput } from '../validators/shop.validator';

export async function update(req: Request, res: Response): Promise<void> {
  res.json(await updateShop(getAuth(req).tenantId, req.body as UpdateShopInput));
}
