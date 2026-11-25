import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { apiRouter } from './routes';

// Builds the Express app without starting it, so tests can use it directly.
export function createApp() {
  const app = express();

  // On Vercel, requests reach Express through Vercel's proxy, which puts the visitor's real
  // address in X-Forwarded-For. Trusting exactly one proxy hop makes req.ip that address, which
  // the rate limiters need. Locally there is no proxy, so this stays off and nobody can fake
  // their address by sending the header themselves.
  if (process.env.VERCEL) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV === 'development') app.use(morgan('dev'));

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
