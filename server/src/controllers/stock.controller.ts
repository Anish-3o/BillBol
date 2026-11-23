import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import { parseOrThrow } from '../middleware/validate';
import * as stockService from '../services/stock.service';
import { listReceiptsQuerySchema, type ReceiveStockInput } from '../validators/stock.validator';

export async function receive(req: Request, res: Response): Promise<void> {
  res.status(201).json(await stockService.receiveStock(getAuth(req), req.body as ReceiveStockInput));
}

export async function receipts(req: Request, res: Response): Promise<void> {
  const query = parseOrThrow(listReceiptsQuerySchema, req.query);
  res.json(await stockService.listReceipts(getAuth(req).tenantId, query));
}
