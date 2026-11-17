import { Router } from 'express';
import * as billController from '../controllers/bill.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createBillSchema, quoteBillSchema, voiceDraftSchema } from '../validators/bill.validator';

export const billRouter = Router();

// Owners and staff both make bills, so login is the only requirement.
billRouter.use(authenticate);

// Calculate totals without saving (used live by the billing screen).
billRouter.post('/quote', validate(quoteBillSchema), billController.quote);
// Voice: turn what the customer said into a DRAFT cart (saves nothing; see voiceBill.service).
billRouter.post('/voice-draft', validate(voiceDraftSchema), billController.voiceDraft);
// Confirm: save the bill and take the items out of stock.
billRouter.post('/', validate(createBillSchema), billController.create);
billRouter.get('/', billController.list);
billRouter.get('/:id', billController.get);
