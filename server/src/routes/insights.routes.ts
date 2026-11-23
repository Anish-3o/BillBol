import { Router } from 'express';
import * as insightsController from '../controllers/insights.controller';
import { authenticate } from '../middleware/authenticate';

export const insightsRouter = Router();

insightsRouter.use(authenticate);

// Numbers for the home screen, all calculated in code.
insightsRouter.get('/dashboard', insightsController.dashboard);
// The morning briefing: the same numbers turned into a few friendly sentences.
insightsRouter.get('/briefing', insightsController.briefing);
