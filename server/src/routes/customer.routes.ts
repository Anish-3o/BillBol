import { Router } from 'express';
import * as customerController from '../controllers/customer.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createCustomerSchema,
  paymentSchema,
  updateCustomerSchema,
} from '../validators/customer.validator';
import { reminderSchema } from '../validators/assistant.validator';

export const customerRouter = Router();

// Owners and staff both work the counter: they add customers, give udhaar and take payments.
// There is no route that edits a balance or a ledger entry: balances only move through
// bills and payments, which always write a ledger entry.
customerRouter.use(authenticate);

customerRouter.get('/', customerController.list);
customerRouter.post('/', validate(createCustomerSchema), customerController.create);
customerRouter.get('/:id', customerController.get);
customerRouter.patch('/:id', validate(updateCustomerSchema), customerController.update);
customerRouter.get('/:id/ledger', customerController.ledger);
customerRouter.post('/:id/payments', validate(paymentSchema), customerController.payment);
customerRouter.post('/:id/reminder-draft', validate(reminderSchema), customerController.reminderDraft);
