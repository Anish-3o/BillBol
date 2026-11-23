import { createContext } from 'react';
import type { RegisterInput, Session, Tenant } from '../types/auth';

// 'loading' while /auth/me is in flight on first load, so route guards show a spinner
// instead of wrongly redirecting a logged-in user to the login page.
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setTenant: (tenant: Tenant) => void;
};

// Kept separate from AuthProvider so that file only exports a component
// (needed for Vite's fast refresh to work).
export const AuthContext = createContext<AuthContextValue | null>(null);
