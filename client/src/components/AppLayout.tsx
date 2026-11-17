import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth, useSession } from '../hooks/useAuth';

// The frame around every logged-in page: shop name, navigation and logout.
// The top bar's content uses the same max width as the page, so its edges line up with
// the cards below on wide screens.
export function AppLayout() {
  const { logout } = useAuth();
  const { tenant } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);
  const { pathname } = useLocation();
  // "Bills" is highlighted on the list and on a single bill (/bills/:id), but not on
  // /bills/new, which has its own tab. NavLink's prefix matching cannot express that.
  const onBills =
    pathname === '/bills' || (pathname.startsWith('/bills/') && pathname !== '/bills/new');

  async function handleLogout() {
    setLoggingOut(true);
    // The auth status becomes 'anonymous' and <RequireAuth> redirects to /login.
    await logout();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-brand">
            <img src="/favicon.svg" alt="" width={32} height={32} />
            <span className="topbar-shop">{tenant.name}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
        <nav className="tabs" aria-label="Main">
          <NavLink to="/dashboard" className="tab">
            Home
          </NavLink>
          <NavLink to="/bills/new" className="tab">
            New bill
          </NavLink>
          {/* A function className replaces NavLink's own "active" class (a plain string
              would still get "active" added by prefix matching on /bills/new). */}
          <NavLink to="/bills" className={() => (onBills ? 'tab active' : 'tab')}>
            Bills
          </NavLink>
          <NavLink to="/products" className="tab">
            Products
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
