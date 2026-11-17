import type { CookieOptions, Response } from 'express';
import { env } from '../config/env';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../services/token.service';

export const ACCESS_COOKIE = 'accessToken';
export const REFRESH_COOKIE = 'refreshToken';

// The access token goes with every API call. The refresh token is only sent to /api/auth
// (refresh, logout), so the long-lived token travels over the network as rarely as possible.
const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/auth';

const baseCookie: CookieOptions = {
  // httpOnly: JavaScript in the page cannot read the token, so an XSS bug cannot steal it.
  httpOnly: true,
  // Browsers only send secure cookies over HTTPS; local dev runs on plain http.
  secure: env.NODE_ENV === 'production',
  // lax: the cookie is not sent on cross-site POSTs, which blocks basic CSRF attacks.
  sameSite: 'lax',
};

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookie,
    path: ACCESS_PATH,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000, // Express takes milliseconds
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie,
    path: REFRESH_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

// A browser only deletes a cookie when name, path and flags match the ones it was set with,
// which is why the same options are reused here.
export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie, path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie, path: REFRESH_PATH });
}
