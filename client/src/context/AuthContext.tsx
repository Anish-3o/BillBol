import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiGet, apiPost, setSessionExpiredHandler } from '../api/client';
import type { RegisterInput, Session } from '../types/auth';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

type AuthState = { status: AuthStatus; session: Session | null };

const LOGGED_OUT: AuthState = { status: 'anonymous', session: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', session: null });

  useEffect(() => {
    // If a refresh fails anywhere in the app (e.g. the session was revoked),
    // the user is logged out and the route guard sends them to /login.
    setSessionExpiredHandler(() => setState(LOGGED_OUT));

    // The tokens are in httpOnly cookies that JavaScript cannot read, so the only way to know
    // whether we are logged in is to ask the server. If the access token has expired, the API
    // client refreshes it and retries automatically before this resolves.
    let cancelled = false;
    const checkSession = () => {
      apiGet<Session>('/auth/me')
        .then((session) => !cancelled && setState({ status: 'authenticated', session }))
        .catch((err: unknown) => {
          if (cancelled) return;
          // Opened with no internet (the installed app starts from its cache): the server could
          // not be asked, which is not the same as "logged out". The login cookies are still
          // valid, so keep showing the spinner (under the "No internet" banner) and ask again
          // the moment the connection is back, instead of a login screen that cannot work offline.
          if (!(err instanceof ApiError) && !navigator.onLine) {
            window.addEventListener('online', checkSession, { once: true });
            return;
          }
          setState(LOGGED_OUT);
        });
    };
    checkSession();

    // React StrictMode runs effects twice in development; this ignores the first run's result.
    return () => {
      cancelled = true;
      window.removeEventListener('online', checkSession);
      setSessionExpiredHandler(null);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      async login(identifier, password) {
        const session = await apiPost<Session>('/auth/login', { identifier, password });
        setState({ status: 'authenticated', session });
      },
      async register(input: RegisterInput) {
        const session = await apiPost<Session>('/auth/register', input);
        setState({ status: 'authenticated', session });
      },
      async logout() {
        try {
          await apiPost('/auth/logout');
        } finally {
          // Even if the network call fails, forget the session on this screen.
          setState(LOGGED_OUT);
        }
      },
      // After the owner edits shop details, every screen (receipts, UPI QR) uses the new ones.
      setTenant(tenant) {
        setState((s) => (s.session ? { ...s, session: { ...s.session, tenant } } : s));
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
