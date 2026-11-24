import { Router } from 'express';
import { assistantRouter } from './assistant.routes';
import { authRouter } from './auth.routes';
import { billRouter } from './bill.routes';
import { customerRouter } from './customer.routes';
import { healthRouter } from './health.routes';
import { insightsRouter } from './insights.routes';
import { productRouter } from './product.routes';
import { shopRouter } from './shop.routes';
import { staffRouter } from './staff.routes';
import { stockRouter } from './stock.routes';
import { voiceRouter } from './voice.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/bills', billRouter);
apiRouter.use('/customers', customerRouter); // udhaar ledger
apiRouter.use('/stock', stockRouter); // receiving goods (stock-in)
apiRouter.use('/shop', shopRouter); // shop details: address, GSTIN, UPI ID
apiRouter.use('/staff', staffRouter); // owner manages helpers' logins

apiRouter.use('/insights', insightsRouter); // dashboard numbers and the morning briefing
apiRouter.use('/assistant', assistantRouter); // "Hey Ramu" voice assistant
apiRouter.use('/voice', voiceRouter); // natural speech in and out (Sarvam), when configured
