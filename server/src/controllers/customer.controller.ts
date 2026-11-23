import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import { parseOrThrow } from '../middleware/validate';
import { draftReminder } from '../services/briefing.service';
import * as customerService from '../services/customer.service';
import type { ReminderInput } from '../validators/assistant.validator';
import {
  ledgerQuerySchema,
  listCustomersQuerySchema,
  type CreateCustomerInput,
  type PaymentInput,
  type UpdateCustomerInput,
} from '../validators/customer.validator';

type WithId = Request<{ id: string }>;

export async function list(req: Request, res: Response): Promise<void> {
  const query = parseOrThrow(listCustomersQuerySchema, req.query);
  res.json(await customerService.listCustomers(getAuth(req).tenantId, query));
}

export async function create(req: Request, res: Response): Promise<void> {
  const customer = await customerService.createCustomer(getAuth(req).tenantId, req.body as CreateCustomerInput);
  res.status(201).json(customer);
}

export async function get(req: WithId, res: Response): Promise<void> {
  res.json(await customerService.getCustomer(getAuth(req).tenantId, req.params.id));
}

export async function update(req: WithId, res: Response): Promise<void> {
  res.json(
    await customerService.updateCustomer(getAuth(req).tenantId, req.params.id, req.body as UpdateCustomerInput),
  );
}

export async function ledger(req: WithId, res: Response): Promise<void> {
  const query = parseOrThrow(ledgerQuerySchema, req.query);
  res.json(await customerService.listLedger(getAuth(req).tenantId, req.params.id, query));
}

export async function payment(req: WithId, res: Response): Promise<void> {
  res
    .status(201)
    .json(await customerService.recordPayment(getAuth(req), req.params.id, req.body as PaymentInput));
}

// Drafts a polite WhatsApp reminder; the shopkeeper reviews it and sends it themselves.
export async function reminderDraft(req: WithId, res: Response): Promise<void> {
  const { lang } = req.body as ReminderInput;
  res.json(await draftReminder(getAuth(req).tenantId, req.params.id, lang));
}
