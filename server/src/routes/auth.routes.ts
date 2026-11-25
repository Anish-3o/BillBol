import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema } from '../validators/auth.validator';

export const authRouter = Router();

// The limiters run first, so even malformed spam is counted and turned away cheaply.
authRouter.post('/register', registerLimiter, validate(registerSchema), authController.register);
authRouter.post('/login', loginLimiter, validate(loginSchema), authController.login);
// refresh and logout use the refresh cookie, not the access token: they must keep working
// after the 15-minute access token has expired.
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authenticate, authController.me);
