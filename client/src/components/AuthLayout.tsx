import type { ReactNode } from 'react';
import { Link } from 'react-router';

type Props = {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
};

// Shared frame for the login and register pages: logo, heading, card, footer link.
export function AuthLayout({ title, subtitle, footer, children }: Props) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-brand" aria-label="BillBol home">
          <img src="/favicon.svg" alt="" width={44} height={44} />
          <span>BillBol</span>
        </Link>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
        <p className="auth-footer">{footer}</p>
      </div>
    </main>
  );
}
