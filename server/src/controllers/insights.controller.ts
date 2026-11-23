import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import { parseOrThrow } from '../middleware/validate';
import { getBriefing } from '../services/briefing.service';
import { getDashboard } from '../services/insights.service';
import { briefingQuerySchema } from '../validators/assistant.validator';

export async function dashboard(req: Request, res: Response): Promise<void> {
  res.json(await getDashboard(getAuth(req).tenantId));
}

export async function briefing(req: Request, res: Response): Promise<void> {
  const { lang } = parseOrThrow(briefingQuerySchema, req.query);
  res.json(await getBriefing(getAuth(req).tenantId, lang));
}
