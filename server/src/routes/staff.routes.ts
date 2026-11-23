import { Router } from 'express';
import * as staffController from '../controllers/staff.controller';
import { authenticate, requireRole } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { addStaffSchema } from '../validators/staff.validator';

export const staffRouter = Router();

// Only the owner decides who can log in to the shop.
staffRouter.use(authenticate, requireRole('owner'));
staffRouter.get('/', staffController.list);
staffRouter.post('/', validate(addStaffSchema), staffController.add);
staffRouter.delete('/:id', staffController.remove);
