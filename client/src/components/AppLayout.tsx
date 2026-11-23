import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { phaseLabel } from '../context/assistant-context';
import { AssistantProvider } from '../context/AssistantProvider';
import { useAssistant } from '../hooks/useAssistant';
import { useAuth, useSession } from '../hooks/useAuth';
import { Icon, type IconName } from './Icon';
import { RamuOrb, RamuPanel } from './RamuPanel';

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <Icon name="mic" size={size * 0.5} />
    </span>
  );
}

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/bills/new', label: 'New bill', icon: 'plus' },
  { to: '/bills', label: 'Bills', icon: 'receipt' },
  { to: '/customers', label: 'Udhaar khata', icon: 'book' },
  { to: '/products', label: 'Products & stock', icon: 'package' },
  { to: '/stock/receive', label: 'Receive goods', icon: 'scan' },
];

// The frame around every logged-in page. The assistant lives here, so a conversation (and
// hands-free listening) carries on while the shopkeeper moves between pages.
export function AppLayout() {
  return (
    <AssistantProvider>
      <Shell />
    </AssistantProvider>
  );
}

function Shell() {
  const { logout } = useAuth();
  const { tenant, user } = useSession();
  const assistant = useAssistant();
  const [loggingOut, setLoggingOut] = useState(false);
  const { pathname } = useLocation();

  // "Bills" is active on the list and on one bill, but not on /bills/new (its own item).
  const isActive = (to: string) =>
    to === '/bills' ? pathname === '/bills' || (pathname.startsWith('/bills/') && pathname !== '/bills/new') : pathname.startsWith(to);
  const navClass = (to: string, base: string) => (isActive(to) ? `${base} active` : base);

  async function handleLogout() {
    setLoggingOut(true);
    await logout(); // <RequireAuth> then redirects to /login
  }

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <NavLink to="/dashboard" className="brand">
          <BrandMark />
          <span>
            <span className="brand-name">
              Bill<span>Bol</span>
            </span>
            <span className="brand-shop">{tenant.name}</span>
          </span>
        </NavLink>

        <div className="nav-section">Shop</div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className={() => navClass(item.to, 'nav-item')}>
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
        {user.role === 'owner' && (
          <NavLink to="/settings" className={() => navClass('/settings', 'nav-item')}>
            <Icon name="settings" />
            Settings
          </NavLink>
        )}

        <div className="nav-section">Assistant</div>
        <button type="button" className="nav-item" onClick={() => assistant.setOpen(true)}>
          <Icon name="sparkles" />
          Hey {assistant.settings.name}
          {assistant.settings.handsFree && <span className="kbd">ON</span>}
        </button>

        <div className="sidebar-ramu">
          <strong>Hands-free billing</strong>
          <p>Say "Hey {assistant.settings.name}, do kilo cheeni aur ek sabun" and confirm with "haan".</p>
          <button type="button" className="btn btn-accent btn-sm btn-block" onClick={() => assistant.setOpen(true)}>
            <Icon name="mic" size={16} /> Try it
          </button>
        </div>

        <div className="sidebar-foot">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-user">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </span>
          <button type="button" className="icon-btn" onClick={handleLogout} disabled={loggingOut} aria-label="Log out" title="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="mobile-top">
          <NavLink to="/dashboard" className="brand">
            <BrandMark size={32} />
            <span>
              <span className="brand-name">
                Bill<span>Bol</span>
              </span>
              <span className="brand-shop">{tenant.name}</span>
            </span>
          </NavLink>
          <div className="button-row">
            {assistant.settings.handsFree && (
              <span className="listening-pill">
                <span className={`live-dot${assistant.phase === 'standby' ? ' on' : ' hot'}`} /> {assistant.settings.name}
              </span>
            )}
            {user.role === 'owner' && (
              <NavLink to="/settings" className="icon-btn" aria-label="Settings">
                <Icon name="settings" />
              </NavLink>
            )}
            <button type="button" className="icon-btn" onClick={handleLogout} disabled={loggingOut} aria-label="Log out">
              <Icon name="logout" />
            </button>
          </div>
        </header>

        <Outlet />
      </div>

      {/* Phones: bottom tabs with the assistant in the middle. */}
      <nav className="bottom-nav" aria-label="Main">
        <NavLink to="/dashboard" className={() => navClass('/dashboard', '')}>
          <Icon name="dashboard" size={22} />
          Home
        </NavLink>
        <NavLink to="/bills" className={() => navClass('/bills', '')}>
          <Icon name="receipt" size={22} />
          Bills
        </NavLink>
        <button type="button" className="nav-mic" onClick={() => assistant.setOpen(true)} aria-label={`Open ${assistant.settings.name}`}>
          <span className="nav-mic-orb">
            <Icon name="mic" size={26} />
          </span>
          {assistant.settings.name}
        </button>
        <NavLink to="/customers" className={() => navClass('/customers', '')}>
          <Icon name="book" size={22} />
          Khata
        </NavLink>
        <NavLink to="/products" className={() => navClass('/products', '')}>
          <Icon name="package" size={22} />
          Stock
        </NavLink>
      </nav>

      {/* Desktop: floating assistant button. */}
      {!assistant.open && (
        <button type="button" className="ramu-fab" onClick={() => assistant.setOpen(true)}>
          <RamuOrb phase={assistant.phase} />
          <span>
            Hey {assistant.settings.name}
            <small>{phaseLabel(assistant.phase, assistant.settings.name)}</small>
          </span>
        </button>
      )}
      <RamuPanel />
    </div>
  );
}
