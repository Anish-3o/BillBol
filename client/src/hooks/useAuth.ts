import { useContext } from 'react';
import { AuthContext } from '../context/auth-context';
import type { Session } from '../types/auth';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// For pages behind <RequireAuth>: returns the session with non-null types.
// If it throws, a protected page was routed without the guard, which is a bug.
export function useSession(): Session {
  const { session } = useAuth();
  if (!session) throw new Error('useSession used outside a <RequireAuth> route');
  return session;
}
