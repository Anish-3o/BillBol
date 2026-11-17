import { Router } from 'express';
import { authRouter } from './auth.routes';
import { billRouter } from './bill.routes';
import { healthRouter } from './health.routes';
import { productRouter } from './product.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/bills', billRouter);

// Coming next:
// Week 3: apiRouter.use('/customers', customerRouter);   // udhaar ledger
