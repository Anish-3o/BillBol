// One place for all API calls. credentials: 'include' sends the httpOnly auth cookies.
// The page never sees the tokens themselves; the browser attaches them for us.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Per-field validation messages from the server, e.g. { phone: ['Enter a valid...'] }
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// For these endpoints a 401 means "wrong password" or "no session", not "access token
// expired", so refreshing and retrying would be pointless (and /refresh would loop).
const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

// AuthContext registers this so it hears when the session is gone for good
// (refresh failed) and can send the user to the login page.
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

export async function api<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  let res = await send(path, method, body);

  // The access token lives 15 minutes. When it expires, get a new one with the refresh
  // cookie and retry the original request exactly once, so the user never notices.
  if (res.status === 401 && !NO_REFRESH_PATHS.includes(path)) {
    if (await refreshSession()) {
      res = await send(path, method, body);
    } else {
      onSessionExpired?.();
    }
  }

  return parse<T>(res);
}

// For requests that are not JSON: a voice recording going up, or speech audio coming back.
// Same session handling as api(): one refresh-and-retry when the access token has expired.
export async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const go = () => fetch(`/api${path}`, { ...init, credentials: 'include' });
  let res = await go();
  if (res.status === 401) {
    if (await refreshSession()) res = await go();
    else onSessionExpired?.();
  }
  if (!res.ok) await parse(res); // throws an ApiError with the server's message
  return res;
}

export const apiGet = <T>(path: string) => api<T>(path, 'GET');
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, 'POST', body);

function send(path: string, method: Method, body: unknown): Promise<Response> {
  return fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.message ?? `Request failed (${res.status})`,
      data?.error?.details,
    );
  }
  return data as T;
}

// The server rotates refresh tokens: each one works once, and reusing an old one is treated
// as theft and ends the session. So two refreshes must never run at the same time:
// - inside this tab, all callers that hit a 401 together share one in-flight refresh;
// - across tabs, a Web Lock makes other tabs wait. When they get the lock, the browser's
//   shared cookie jar already holds the new refresh token, so their refresh is valid too.
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= withCrossTabLock(() =>
    fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then(
      (res) => res.ok,
      () => false, // network error: treat as "could not refresh"
    ),
  ).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
  // navigator.locks only exists on https or localhost. On plain http (e.g. testing on a phone
  // over the LAN) we fall back to the in-tab protection alone.
  if (!navigator.locks) return task();
  return await navigator.locks.request('billbol-auth-refresh', task);
}

// Turns any error from a form submit into something the form can display.
export type FormErrors = { message: string | null; fields: Record<string, string[]> };

export function toFormErrors(err: unknown): FormErrors {
  if (err instanceof ApiError) {
    return {
      message: err.details ? 'Please fix the highlighted fields.' : err.message,
      fields: err.details ?? {},
    };
  }
  return { message: 'Could not reach BillBol. Check your internet and try again.', fields: {} };
}
