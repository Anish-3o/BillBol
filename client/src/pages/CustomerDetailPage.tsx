import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { getCustomer, getLedger, recordPayment } from '../api/customers';
import { draftReminder } from '../api/insights';
import { Icon } from '../components/Icon';
import { PageLoader } from '../components/RouteGuards';
import { UpiQr } from '../components/UpiQr';
import { formatDateTime } from '../lib/datetime';
import { describeBalance, formatPaise, paiseToInput, rupeesToPaise } from '../lib/money';
import type { CashMode, Customer, LedgerEntry } from '../types/customer';
import type { ReminderDraft, WriterLanguage } from '../types/insights';

const LANGS: { code: WriterLanguage; label: string }[] = [
  { code: 'hinglish', label: 'Hinglish' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
  { code: 'en', label: 'English' },
];

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Payment form
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<CashMode>('cash');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paidMsg, setPaidMsg] = useState<string | null>(null);

  // WhatsApp reminder
  const [reminder, setReminder] = useState<ReminderDraft | null>(null);
  const [reminderLang, setReminderLang] = useState<WriterLanguage>('hinglish');
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    Promise.all([getCustomer(id), getLedger(id, 50)])
      .then(([c, l]) => {
        setCustomer(c);
        setLedger(l.items);
      })
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? 'Customer not found.' : 'Could not load this customer.'));
  }, [id]);

  useEffect(load, [load]);

  const makeReminder = useCallback(
    async (lang: WriterLanguage) => {
      setReminderBusy(true);
      setReminderError(null);
      setCopied(false);
      try {
        setReminder(await draftReminder(id, lang));
      } catch (err) {
        setReminderError(err instanceof ApiError ? err.message : 'Could not draft the reminder.');
      } finally {
        setReminderBusy(false);
      }
    },
    [id],
  );

  // Opened from "Remind" on the dashboard: draft the message straight away.
  useEffect(() => {
    if (params.get('remind') === '1' && customer && customer.balancePaise > 0 && !reminder && !reminderBusy) {
      void makeReminder(reminderLang);
    }
  }, [params, customer, reminder, reminderBusy, reminderLang, makeReminder]);

  async function pay(e: FormEvent) {
    e.preventDefault();
    const amountPaise = rupeesToPaise(amount);
    if (!amountPaise) {
      setPayError('Enter an amount like 500 or 249.50');
      return;
    }
    setPaying(true);
    setPayError(null);
    setPaidMsg(null);
    try {
      const { customer: updated } = await recordPayment(id, { amountPaise, paymentMode: mode });
      setCustomer(updated);
      setAmount('');
      setReminder(null);
      setPaidMsg(`Received ${formatPaise(amountPaise)}. New balance: ${describeBalance(updated.balancePaise).text}.`);
      load();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Could not record the payment.');
    } finally {
      setPaying(false);
    }
  }

  if (error) {
    return (
      <main className="page page-narrow">
        <div className="form-alert">{error}</div>
        <Link to="/customers" className="back-link">
          <Icon name="arrowLeft" size={16} /> Khata
        </Link>
      </main>
    );
  }
  if (!customer || !ledger) return <PageLoader inline />;

  const balance = describeBalance(customer.balancePaise);

  return (
    <main className="page">
      <Link to="/customers" className="back-link">
        <Icon name="arrowLeft" size={16} /> Udhaar khata
      </Link>

      <div className="dash-grid">
        <section className="span-12" style={{ display: 'grid', gap: 14 }}>
          <div className="owed-card" style={customer.balancePaise > 0 ? undefined : { background: 'linear-gradient(135deg, #15803d, #14532d)' }}>
            <span>{customer.phone ? `${customer.name} · ${customer.phone}` : customer.name}</span>
            <strong>{customer.balancePaise > 0 ? formatPaise(customer.balancePaise) : balance.text}</strong>
            <p>{customer.balancePaise > 0 ? 'to collect' : customer.balancePaise < 0 ? 'paid in advance' : 'All dues are clear'}</p>
          </div>
        </section>

        <section className="card span-6">
          <h2 className="card-title" style={{ marginBottom: 14 }}>
            <Icon name="wallet" size={18} /> Record a payment
          </h2>
          <form onSubmit={pay}>
            <div className="field">
              <label htmlFor="pay-amount">Amount received (₹)</label>
              <input
                id="pay-amount"
                inputMode="decimal"
                placeholder={customer.balancePaise > 0 ? paiseToInput(customer.balancePaise) : '500'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {customer.balancePaise > 0 && (
                <button type="button" className="link-button" style={{ alignSelf: 'flex-start' }} onClick={() => setAmount(paiseToInput(customer.balancePaise))}>
                  Full amount: {formatPaise(customer.balancePaise)}
                </button>
              )}
            </div>
            <div className="chip-row" role="radiogroup" aria-label="Paid by" style={{ marginBottom: 16 }}>
              {(['cash', 'upi', 'card'] as const).map((m) => (
                <button key={m} type="button" className="chip" role="radio" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {payError && <div className="form-alert">{payError}</div>}
            {paidMsg && <div className="success-banner">{paidMsg}</div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={paying || !amount.trim()}>
              <Icon name="check" size={18} /> {paying ? 'Saving…' : 'Save payment'}
            </button>
          </form>
        </section>

        <section className="card span-6">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="message" size={18} /> WhatsApp reminder
            </h2>
            <span className="badge badge-small badge-ai">✦ Drafted for you</span>
          </div>
          {customer.balancePaise <= 0 ? (
            <p className="muted">Nothing to remind: {customer.name} has no dues.</p>
          ) : (
            <>
              {/* Collect at the counter: the customer scans and pays the exact balance. After
                  the money arrives, record it with "Save payment" (mode UPI). */}
              <div style={{ marginBottom: 14 }}>
                <UpiQr
                  amountPaise={customer.balancePaise}
                  note={`Udhaar ${customer.name}`}
                  caption={`${customer.name} scans to pay the full balance. Then record it with "Save payment".`}
                />
              </div>
              <p className="card-sub" style={{ marginBottom: 12 }}>
                A polite message with the exact amount. You review it and press send in WhatsApp.
              </p>
              <div className="chip-row" style={{ marginBottom: 12 }}>
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    className="chip"
                    aria-pressed={reminderLang === l.code}
                    onClick={() => {
                      setReminderLang(l.code);
                      if (reminder) void makeReminder(l.code);
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              {reminderError && <div className="form-alert">{reminderError}</div>}
              {reminder ? (
                <div className="reminder-box">
                  <span className="badge badge-small badge-ok">{reminder.source === 'ai' ? 'Written by Claude' : 'Template'}</span>
                  <p className="reminder-text">{reminder.text}</p>
                  <div className="button-row">
                    {reminder.whatsappUrl ? (
                      <a className="btn btn-whatsapp" href={reminder.whatsappUrl} target="_blank" rel="noopener noreferrer">
                        <Icon name="message" size={18} /> Open in WhatsApp
                      </a>
                    ) : (
                      <span className="muted" style={{ fontSize: 13 }}>
                        Add a mobile number to send on WhatsApp.
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        void navigator.clipboard?.writeText(reminder.text).then(() => setCopied(true));
                      }}
                    >
                      <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => makeReminder(reminderLang)} disabled={reminderBusy}>
                  <Icon name="sparkles" size={18} /> {reminderBusy ? 'Drafting…' : 'Draft reminder'}
                </button>
              )}
            </>
          )}
        </section>

        <section className="card span-12">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="book" size={18} /> Khata history
            </h2>
            <span className="card-sub">Every entry, newest first. Entries are never edited.</span>
          </div>
          {ledger.length === 0 ? (
            <p className="empty">No entries yet.</p>
          ) : (
            <ul className="ledger">
              {ledger.map((e) => {
                // payment and bill_cancelled both reduce what the customer owes.
                const reduces = e.type !== 'credit_sale';
                return (
                <li key={e.id}>
                  <span className={`ledger-dot ${reduces ? 'payment' : 'sale'}`}>
                    <Icon name={e.type === 'payment' ? 'wallet' : e.type === 'bill_cancelled' ? 'x' : 'receipt'} size={16} />
                  </span>
                  <div className="row-main">
                    <span className="row-title">
                      {e.type === 'payment'
                        ? `Payment received${e.paymentMode ? ` · ${e.paymentMode.toUpperCase()}` : ''}`
                        : e.type === 'bill_cancelled'
                          ? 'Bill cancelled'
                          : 'Udhaar purchase'}
                      {e.billId && (
                        <>
                          {' · '}
                          <Link to={`/bills/${e.billId}`}>Bill {e.billNumber}</Link>
                        </>
                      )}
                    </span>
                    <span className="row-sub">
                      {formatDateTime(e.createdAt)}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                  </div>
                  <div className="row-side">
                    <span className="row-amount" style={{ color: reduces ? 'var(--ok)' : 'var(--warn)' }}>
                      {reduces ? '−' : '+'}
                      {formatPaise(e.amountPaise)}
                    </span>
                    <span className="row-sub">Bal {formatPaise(e.balanceAfterPaise)}</span>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
