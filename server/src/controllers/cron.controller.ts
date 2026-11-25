import type { Request, Response } from 'express';
import { resetDemoShop } from '../services/demoShop.service';

// Rebuilds the public demo shop so every visitor starts from the same clean, realistic data.
export async function resetDemo(_req: Request, res: Response): Promise<void> {
  const shop = await resetDemoShop();
  res.json({ ok: true, bills: shop.bills, products: shop.products, customers: shop.customers });
}
