import { Router } from 'express';
import * as stockController from '../controllers/stock.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { receiveStockSchema } from '../validators/stock.validator';

export const stockRouter = Router();

// Owner and staff: receiving a delivery is everyday counter work, and every receipt records
// who counted the goods in. Changing prices or deleting products stays owner-only.
stockRouter.use(authenticate);
stockRouter.post('/receive', validate(receiveStockSchema), stockController.receive);
stockRouter.get('/receipts', stockController.receipts);
