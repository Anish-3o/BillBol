import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMark } from './AppLayout';
import { Icon } from './Icon';

type Props = {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
};

// Shared frame for the login and register pages: a brand panel (wide screens) and the form.
export function AuthLayout({ title, subtitle, footer, children }: Props) {
  return (
    <main className="auth-page">
      <section className="auth-aside" aria-hidden="true">
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand-name">
            Bill<span>Bol</span>
          </span>
        </Link>
        <div>
          <h2>Your shop's munim, khata and cash counter. In one phone.</h2>
          <ul>
            <li>
              <Icon name="mic" /> Bill by voice in Hindi, Hinglish or Marathi
            </li>
            <li>
              <Icon name="sparkles" /> "Hey Ramu" hands-free assistant
            </li>
            <li>
              <Icon name="scan" /> Barcode billing with any scanner, printed receipts
            </li>
            <li>
              <Icon name="phone" /> UPI "scan to pay" QR with the exact amount
            </li>
            <li>
              <Icon name="book" /> Udhaar khata with WhatsApp reminders
            </li>
            <li>
              <Icon name="chart" /> Daily AI briefing and smart restock
            </li>
          </ul>
        </div>
        <div className="auth-quote">
          "Pehle din bhar register likhta tha. Ab bas bolta hoon, bill ban jaata hai."
          <strong>— the shopkeeper we are building for</strong>
        </div>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <Link to="/" className="brand" aria-label="BillBol home">
            <BrandMark />
            <span className="brand-name">
              Bill<span>Bol</span>
            </span>
          </Link>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
          <p className="auth-footer">{footer}</p>
        </div>
      </section>
    </main>
  );
}
