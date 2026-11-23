import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { getBriefing, getDashboard } from '../api/insights';
import { Delta, PaymentDonut, SalesBars } from '../components/Charts';
import { Icon } from '../components/Icon';
import { useAssistant } from '../hooks/useAssistant';
import { useSession } from '../hooks/useAuth';
import { dayMonthOf, formatToday, greeting, hourRange, timeAgo } from '../lib/datetime';
import { formatPaise } from '../lib/money';
import { formatQuantity } from '../lib/quantity';
import { canSpeak, speak, stopSpeaking } from '../lib/speech';
import { PAYMENT_LABELS } from '../types/bill';
import type { Dashboard, WriterLanguage, WrittenText } from '../types/insights';

const LANG_KEY = 'billbol.briefingLang';
const LANGS: { code: WriterLanguage; label: string }[] = [
  { code: 'hinglish', label: 'Hinglish' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
  { code: 'en', label: 'English' },
];

function savedLang(): WriterLanguage {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'hi' || v === 'hinglish' || v === 'mr') return v;
  } catch {
    // ignore
  }
  return 'hinglish';
}

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

export default function DashboardPage() {
  const { user } = useSession();
  const assistant = useAssistant();
  const navigate = useNavigate();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<WriterLanguage>(savedLang);
  const [briefing, setBriefing] = useState<WrittenText | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const load = useCallback(() => {
    getDashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(() => setError('Could not load the dashboard. Is the API running?'));
  }, []);

  useEffect(() => {
    load();
    // A bill saved anywhere (including by voice through Ramu) refreshes the numbers.
    window.addEventListener('billbol:bill-created', load);
    return () => window.removeEventListener('billbol:bill-created', load);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    setBriefing(null);
    getBriefing(lang)
      .then((b) => !cancelled && setBriefing(b))
      .catch(() => !cancelled && setBriefing({ text: 'Briefing is not available right now.', source: 'template', generatedAt: '' }));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  useEffect(() => () => stopSpeaking(), []);

  function chooseLang(code: WriterLanguage) {
    setLang(code);
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch {
      // ignore
    }
  }

  async function listen() {
    if (!briefing) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    // Marathi is read in Marathi; everything else is read aloud in Hindi with a Hindi voice.
    if (lang === 'mr') {
      await speak(briefing.text, { lang: 'mr', voiceName: assistant.settings.voiceNameMr || undefined });
    } else {
      const spoken = lang === 'hi' ? briefing.text : await getBriefing('hi').then((b) => b.text, () => briefing.text);
      await speak(spoken, { lang: 'hi', voiceName: assistant.settings.voiceName || undefined, fallback: briefing.text });
    }
    setSpeaking(false);
  }

  function shareOrderList() {
    if (!data) return;
    const lines = data.restock.map((r) => `• ${r.name}: ${formatQuantity(r.suggestedMilli, r.unit)}`);
    const text = `Order list:\n${lines.join('\n')}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  const firstName = user.name.split(' ')[0];

  // This week vs the week before, from the 14 days of daily totals.
  const thisWeek = data ? sum(data.daily.slice(-7).map((d) => d.salesPaise)) : 0;
  const lastWeek = data ? sum(data.daily.slice(0, 7).map((d) => d.salesPaise)) : 0;
  const bestDay = data ? [...data.daily].sort((a, b) => b.salesPaise - a.salesPaise)[0] : null;
  const maxTop = data?.week.topProducts[0]?.salesPaise ?? 1;

  return (
    <main className="page">
      <div className="dash-greeting">
        <div>
          <p className="eyebrow">{formatToday()}</p>
          <h1>
            {greeting()}, {firstName} 👋
          </h1>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-secondary" onClick={() => assistant.setOpen(true)}>
            <Icon name="sparkles" size={18} /> Ask {assistant.settings.name}
          </button>
          <Link to="/bills/new" className="btn btn-primary">
            <Icon name="plus" size={18} /> New bill
          </Link>
        </div>
      </div>

      {error && <div className="form-alert">{error}</div>}

      <div className="dash-grid">
        {/* AI morning briefing */}
        <section className="briefing span-12" aria-label="Morning briefing">
          <div className="briefing-head">
            <span className="briefing-label">
              <Icon name="sparkles" size={16} /> {assistant.settings.name}'s briefing
            </span>
            <div className="seg-light" role="group" aria-label="Briefing language">
              {LANGS.map((l) => (
                <button key={l.code} type="button" aria-pressed={lang === l.code} onClick={() => chooseLang(l.code)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          {briefing ? (
            <p className="briefing-text">{briefing.text}</p>
          ) : (
            <div className="briefing-text">
              <div className="skeleton" style={{ height: 18, marginBottom: 10, width: '92%' }} />
              <div className="skeleton" style={{ height: 18, width: '70%' }} />
            </div>
          )}
          <div className="briefing-foot">
            {canSpeak() && (
              <button type="button" className="btn btn-light btn-sm" onClick={listen} disabled={!briefing}>
                <Icon name={speaking ? 'stop' : 'volume'} size={16} /> {speaking ? 'Stop' : 'Listen'}
              </button>
            )}
            <div className="ask-chips">
              <button type="button" className="ask-chip" onClick={() => assistant.sendText('aaj ki bikri kitni hui?')}>
                Aaj ki bikri?
              </button>
              <button type="button" className="ask-chip" onClick={() => assistant.sendText('kya kya mangwana hai?')}>
                Kya mangwana hai?
              </button>
              <button type="button" className="ask-chip" onClick={() => assistant.sendText('udhaar kitna baaki hai?')}>
                Udhaar kitna?
              </button>
            </div>
            {briefing && (
              <span className="source" style={{ marginLeft: 'auto' }}>
                {briefing.source === 'ai' ? '✦ Written by Claude from your real numbers' : 'Auto-summary from your numbers'}
              </span>
            )}
          </div>
        </section>

        {/* KPIs */}
        <div className="kpi-grid span-12">
          <div className="kpi">
            <div className="kpi-top">
              Today's sales
              <span className="kpi-icon">
                <Icon name="rupee" size={16} />
              </span>
            </div>
            <div className="kpi-value">{data ? formatPaise(data.today.salesPaise) : '—'}</div>
            <span className="kpi-delta delta-flat">Yesterday {data ? formatPaise(data.yesterday.salesPaise) : '—'}</span>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              Bills today
              <span className="kpi-icon indigo">
                <Icon name="receipt" size={16} />
              </span>
            </div>
            <div className="kpi-value">{data ? data.today.bills : '—'}</div>
            <span className="kpi-delta delta-flat">Avg bill {data ? formatPaise(data.today.avgBillPaise) : '—'}</span>
          </div>
          <div className="kpi">
            <div className="kpi-top">
              Last 7 days
              <span className="kpi-icon amber">
                <Icon name="chart" size={16} />
              </span>
            </div>
            <div className="kpi-value">{data ? formatPaise(thisWeek) : '—'}</div>
            {data ? <Delta now={thisWeek} before={lastWeek} suffix="vs week before" /> : <span className="kpi-delta">&nbsp;</span>}
          </div>
          <Link to="/customers" className="kpi" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="kpi-top">
              Udhaar to collect
              <span className="kpi-icon rose">
                <Icon name="book" size={16} />
              </span>
            </div>
            <div className="kpi-value">{data ? formatPaise(data.udhaar.totalOwedPaise) : '—'}</div>
            <span className="kpi-delta delta-flat">
              {data ? `${data.udhaar.customersOwing} customers` : '—'} <Icon name="chevronRight" size={14} />
            </span>
          </Link>
        </div>

        {/* Sales trend */}
        <section className="card span-8">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <Icon name="chart" size={18} /> Sales trend
              </h2>
              <p className="card-sub">Last 14 days · hover a bar for details</p>
            </div>
            <span className="badge badge-neutral">{data ? `${data.week.bills} bills this week` : '…'}</span>
          </div>
          {data ? <SalesBars days={data.daily} /> : <div className="skeleton" style={{ height: 210 }} />}
          {data && (
            <div className="chart-meta">
              <div>
                Best day
                <strong>{bestDay && bestDay.salesPaise > 0 ? `${dayMonthOf(bestDay.date)} · ${formatPaise(bestDay.salesPaise)}` : '—'}</strong>
              </div>
              <div>
                Daily average (7 days)
                <strong>{formatPaise(Math.round(thisWeek / 7))}</strong>
              </div>
              <div>
                Busiest hour
                <strong>{data.peakHour === null ? '—' : hourRange(data.peakHour)}</strong>
              </div>
            </div>
          )}
        </section>

        {/* Payment split */}
        <section className="card span-4">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <Icon name="wallet" size={18} /> How customers pay
              </h2>
              <p className="card-sub">Last 7 days</p>
            </div>
          </div>
          {data ? <PaymentDonut split={data.week.paymentSplit} /> : <div className="skeleton" style={{ height: 132 }} />}
          {data && (
            <ul className="rows" style={{ marginTop: 14 }}>
              {data.week.paymentSplit.map((p) => (
                <li key={p.mode} className="row" style={{ padding: '8px 0' }}>
                  <span className="pay-badge" style={{ flex: 1 }}>
                    <span className={`pay-dot pay-${p.mode}`} /> {PAYMENT_LABELS[p.mode]}
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {p.bills} bills
                  </span>
                  <strong className="tabular">{formatPaise(p.paise)}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Smart restock */}
        <section className="card span-6">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <Icon name="package" size={18} /> Smart restock
              </h2>
              <p className="card-sub">Based on how fast each item sells</p>
            </div>
            {data && data.restock.length > 0 && (
              <div className="button-row">
                <button type="button" className="btn btn-whatsapp btn-sm" onClick={shareOrderList}>
                  <Icon name="message" size={15} /> Send order
                </button>
                {/* The other half of the loop: when the order arrives, scan it in. */}
                <Link to="/stock/receive" className="btn btn-secondary btn-sm">
                  <Icon name="scan" size={15} /> Receive
                </Link>
              </div>
            )}
          </div>
          {!data && <div className="skeleton" style={{ height: 200 }} />}
          {data && data.restock.length === 0 && (
            <div className="empty">
              <span className="empty-icon">
                <Icon name="check" />
              </span>
              <p className="empty-title">Stock looks healthy</p>
            </div>
          )}
          {data && data.restock.length > 0 && (
            <ul className="rows">
              {data.restock.map((r) => (
                <li key={r.productId} className="row">
                  <span className={`row-icon urgency-${r.urgency}`}>
                    <Icon name={r.urgency === 'low' ? 'clock' : 'alert'} size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{r.name}</span>
                    <span className="row-sub">
                      {formatQuantity(Math.max(0, r.stockMilli), r.unit)} left
                      {r.daysLeft !== null ? ` · ~${r.daysLeft} ${r.daysLeft === 1 ? 'day' : 'days'} at current sales` : ''}
                    </span>
                  </span>
                  <span className="row-side">
                    <span className="badge badge-small">Order {formatQuantity(r.suggestedMilli, r.unit)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Top sellers */}
        <section className="card span-6">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <Icon name="trendUp" size={18} /> Top sellers
              </h2>
              <p className="card-sub">Last 7 days, by sales</p>
            </div>
            <Link to="/products" className="card-link">
              All products <Icon name="chevronRight" size={14} />
            </Link>
          </div>
          {!data && <div className="skeleton" style={{ height: 200 }} />}
          {data && (
            <ul className="rows">
              {data.week.topProducts.map((p, i) => (
                <li key={p.productId} className="row">
                  <span className="rank">{i + 1}</span>
                  <span className="row-main">
                    <span className="row-title">{p.name}</span>
                    <span className="meter">
                      <span style={{ width: `${(p.salesPaise / maxTop) * 100}%` }} />
                    </span>
                  </span>
                  <span className="row-side">
                    <span className="row-amount">{formatPaise(p.salesPaise)}</span>
                    <span className="row-sub">{formatQuantity(p.quantityMilli, p.unit)}</span>
                  </span>
                </li>
              ))}
              {data.week.topProducts.length === 0 && <li className="empty">No sales in the last 7 days</li>}
            </ul>
          )}
        </section>

        {/* Udhaar */}
        <section className="card span-6">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <Icon name="book" size={18} /> Udhaar to follow up
              </h2>
              <p className="card-sub">Who owes the most</p>
            </div>
            <Link to="/customers" className="card-link">
              Khata <Icon name="chevronRight" size={14} />
            </Link>
          </div>
          {!data && <div className="skeleton" style={{ height: 200 }} />}
          {data && data.udhaar.top.length === 0 && (
            <div className="empty">
              <span className="empty-icon">
                <Icon name="check" />
              </span>
              <p className="empty-title">No pending udhaar</p>
            </div>
          )}
          {data && (
            <ul className="rows">
              {data.udhaar.top.map((c) => (
                <li key={c.id} className="row">
                  <span className="row-icon">{c.name.slice(0, 1)}</span>
                  <span className="row-main">
                    <span className="row-title">{c.name}</span>
                    <span className="row-sub">Last entry {timeAgo(c.lastActivityAt)}</span>
                  </span>
                  <span className="row-amount balance-owes">{formatPaise(c.balancePaise)}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/customers/${c.id}?remind=1`)}>
                    <Icon name="message" size={14} /> Remind
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent bills */}
        <section className="card span-6">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <Icon name="receipt" size={18} /> Recent bills
              </h2>
              <p className="card-sub">Latest at the counter</p>
            </div>
            <Link to="/bills" className="card-link">
              All bills <Icon name="chevronRight" size={14} />
            </Link>
          </div>
          {!data && <div className="skeleton" style={{ height: 200 }} />}
          {data && (
            <ul className="rows">
              {data.recentBills.map((b) => (
                <li key={b.id}>
                  <Link to={`/bills/${b.id}`} className={b.status === 'cancelled' ? 'row row-cancelled' : 'row'}>
                    <span className="row-icon">
                      <span className={`pay-dot pay-${b.paymentMode}`} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">
                        {b.customerName ?? `Bill ${b.number.split('/')[1] ?? b.number}`}
                        {b.status === 'cancelled' && <span className="badge badge-small badge-danger"> Cancelled</span>}
                      </span>
                      <span className="row-sub">
                        {timeAgo(b.createdAt)} · {b.itemCount} {b.itemCount === 1 ? 'item' : 'items'} · {PAYMENT_LABELS[b.paymentMode]}
                      </span>
                    </span>
                    <span className="row-amount">{formatPaise(b.totalPaise)}</span>
                  </Link>
                </li>
              ))}
              {data.recentBills.length === 0 && <li className="empty">No bills yet</li>}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
