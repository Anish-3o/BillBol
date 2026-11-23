import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import * as staffService from '../services/staff.service';
import type { AddStaffInput } from '../validators/staff.validator';

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await staffService.listStaff(getAuth(req).tenantId));
}

export async function add(req: Request, res: Response): Promise<void> {
  res.status(201).json(await staffService.addStaff(getAuth(req).tenantId, req.body as AddStaffInput));
}

export async function remove(req: Request<{ id: string }>, res: Response): Promise<void> {
  await staffService.removeStaff(getAuth(req).tenantId, req.params.id);
  res.status(204).end();
}
