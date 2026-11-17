import type { Request, Response } from 'express';
import { getAuth } from '../middleware/authenticate';
import * as authService from '../services/auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../utils/authCookies';
import type { LoginInput, RegisterInput } from '../validators/auth.validator';

// Express 5 forwards errors thrown in async handlers to the error handler,
// so no try/catch or asyncHandler wrapper is needed here.
// Tokens go only in httpOnly cookies, never in the JSON body, so page scripts never see them.

export async function register(req: Request, res: Response): Promise<void> {
  const { user, tenant, tokens } = await authService.register(req.body as RegisterInput);
  setAuthCookies(res, tokens);
  res.status(201).json({ user, tenant });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { user, tenant, tokens } = await authService.login(req.body as LoginInput);
  setAuthCookies(res, tokens);
  res.json({ user, tenant });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    const { user, tenant, tokens } = await authService.refresh(readRefreshCookie(req));
    setAuthCookies(res, tokens);
    res.json({ user, tenant });
  } catch (err) {
    // A refresh token that failed once will never work, so remove the dead cookies;
    // the error handler still sends the 401.
    clearAuthCookies(res);
    throw err;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(readRefreshCookie(req));
  clearAuthCookies(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json(await authService.getCurrentUser(getAuth(req)));
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}
