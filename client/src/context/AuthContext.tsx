import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet, apiPost, setSessionExpiredHandler } from '../api/client';
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
    apiGet<Session>('/auth/me')
      .then((session) => !cancelled && setState({ status: 'authenticated', session }))
      .catch(() => !cancelled && setState(LOGGED_OUT));

    // React StrictMode runs effects twice in development; this ignores the first run's result.
    return () => {
      cancelled = true;
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
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
