import { Router } from 'express';
import * as cronController from '../controllers/cron.controller';
import { cronAuth } from '../middleware/cronAuth';

// Scheduled jobs, called by Vercel Cron (see the "crons" list in /vercel.json).
// Serverless functions cannot run timers between requests, so a schedule outside the app sends
// an HTTP request instead. Vercel Cron always uses GET.
export const cronRouter = Router();

cronRouter.use(cronAuth);

// Every night: visitors to the live demo can cancel bills, change prices, edit the UPI ID or add
// staff, and they all share one demo shop. Rebuilding it nightly undoes all of that.
cronRouter.get('/reset-demo', cronController.resetDemo);
