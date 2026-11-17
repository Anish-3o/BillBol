import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';

type FromState = { from?: string } | null;

// Full-screen spinner, or `inline` for a spinner inside a page.
export function PageLoader({ inline = false }: { inline?: boolean }) {
  return (
    <div className={inline ? 'inline-loader' : 'page-loader'} role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="visually-hidden">Loading</span>
    </div>
  );
}

// Wraps pages that need login. Anonymous users go to /login, and we remember where they were
// headed so they land back there after logging in.
// Note: this only hides UI. The real protection is the server rejecting requests without a
// valid token; anyone can edit client-side code.
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageLoader />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

// Use inside <RequireAuth>. Staff who open an owner-only page (e.g. by typing the URL)
// are sent back to the given page. The server returns 403 for them anyway.
export function RequireOwner({ fallback }: { fallback: string }) {
  const { session } = useAuth();
  if (session?.user.role !== 'owner') return <Navigate to={fallback} replace />;
  return <Outlet />;
}

// Wraps /login and /register. A logged-in user is sent on to the app. This is also what
// moves the user forward after a successful login or register: the auth status changes,
// this guard re-renders and redirects, so the pages themselves never need to navigate.
export function RequireGuest() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageLoader />;
  if (status === 'authenticated') {
    const from = (location.state as FromState)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }
  return <Outlet />;
}
