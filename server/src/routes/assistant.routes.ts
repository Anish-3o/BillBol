import { Router } from 'express';
import * as assistantController from '../controllers/assistant.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { assistantCustomerSchema, assistantMessageSchema } from '../validators/assistant.validator';

export const assistantRouter = Router();

// Owners and staff both use the assistant at the counter.
assistantRouter.use(authenticate);

assistantRouter.get('/status', assistantController.status);
// Answers a question or updates the DRAFT bill. Never saves a bill (Rule 2).
assistantRouter.post('/message', validate(assistantMessageSchema), assistantController.message);
// Finds the customer named in speech before a voice bill is saved. Reads only.
assistantRouter.post('/customer', validate(assistantCustomerSchema), assistantController.customer);
