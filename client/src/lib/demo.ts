import { ApiError } from '../api/client';

// The demo shop created by `npm run seed:demo` and rebuilt nightly on the live site
// (server/src/services/demoShop.service.ts). These are public, throwaway credentials for a
// shared demo shop, not secrets.
export const DEMO_LOGIN = { phone: '9000000001', password: 'demo@1234' };

// What to tell someone whose "Try the live demo" click failed. Visitors (often at a pitch) get a
// plain message; only a developer running the app locally is told how to fix a missing demo shop.
export function demoErrorMessage(err: unknown, isDev: boolean): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return isDev
        ? 'The demo shop is not set up yet. Run "npm run seed:demo", then try again.'
        : 'The demo shop is being refreshed. Please try again in a minute.';
    }
    // 429 (rate limit), 503 (database waking up) and friends: the server's own message is
    // already written for people ("Too many wrong attempts...", "Server is busy...").
    return err.message;
  }
  // fetch() itself failed: no internet, or (locally) the API is not running.
  return isDev ? 'Could not reach the API. Is it running? (npm run dev)' : 'Could not connect. Check your internet and try again.';
}
