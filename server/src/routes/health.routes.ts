import { Router } from 'express';
import mongoose from 'mongoose';

export const healthRouter = Router();

// Used by the frontend, Docker and hosting platforms to check the API is alive.
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'billbol-api',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});
