import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import { parseOrThrow } from '../middleware/validate';
import * as billService from '../services/bill.service';
import { draftBillFromVoice } from '../services/voiceBill.service';
import {
  listBillsQuerySchema,
  type CancelBillInput,
  type CreateBillInput,
  type QuoteBillInput,
  type VoiceDraftInput,
} from '../validators/bill.validator';

export async function quote(req: Request, res: Response): Promise<void> {
  res.json(await billService.quoteBill(getAuth(req).tenantId, req.body as QuoteBillInput));
}

export async function create(req: Request, res: Response): Promise<void> {
  res.status(201).json(await billService.createBill(getAuth(req), req.body as CreateBillInput));
}

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseOrThrow(listBillsQuerySchema, req.query);
  res.json(await billService.listBills(getAuth(req).tenantId, query));
}

export async function get(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await billService.getBill(getAuth(req).tenantId, req.params.id));
}

export async function cancel(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await billService.cancelBill(getAuth(req), req.params.id, req.body as CancelBillInput));
}

export async function voiceDraft(req: Request, res: Response): Promise<void> {
  const { transcript } = req.body as VoiceDraftInput;
  res.json(await draftBillFromVoice(getAuth(req).tenantId, transcript));
}
