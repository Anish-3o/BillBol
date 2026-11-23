import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { listBills } from '../api/bills';
import { Icon } from '../components/Icon';
import { PageLoader } from '../components/RouteGuards';
import { formatDateTime } from '../lib/datetime';
import { formatPaise } from '../lib/money';
import { PAYMENT_LABELS, PAYMENT_MODES, type BillSummary, type PaymentMode } from '../types/bill';

const PAGE_SIZE = 100;

export default function BillsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ items: BillSummary[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<PaymentMode | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listBills(PAGE_SIZE)
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setError('Could not load bills. Please try again.'));
    void load();
    window.addEventListener('billbol:bill-created', load);
    return () => {
      cancelled = true;
      window.removeEventListener('billbol:bill-created', load);
    };
  }, []);

  // Filtering the latest bills on the device is instant at the counter; searching the full
  // history server-side is a later feature.
  const shown = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.items.filter(
      (b) =>
        (mode === 'all' || b.paymentMode === mode) &&
        (!q || b.number.toLowerCase().includes(q) || (b.customerName ?? '').toLowerCase().includes(q)),
    );
  }, [data, search, mode]);
  // Cancelled bills stay in the list (with their numbers) but are not sales.
  const sales = shown.filter((b) => b.status !== 'cancelled');
  const shownTotal = sales.reduce((s, b) => s + b.totalPaise, 0);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bills</h1>
          {data && (
            <p className="page-sub">
              {data.total.toLocaleString('en-IN')} bills in total · showing the latest {data.items.length}
            </p>
          )}
        </div>
        <Link to="/bills/new" className="btn btn-primary">
          <Icon name="plus" size={18} /> New bill
        </Link>
      </div>

      {error && (
        <div className="form-alert" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <PageLoader inline />}

      {data && data.items.length === 0 && (
        <div className="card empty">
          <span className="empty-icon">
            <Icon name="receipt" />
          </span>
          <p className="empty-title">No bills yet</p>
          <p>Your bills will appear here.</p>
          <Link to="/bills/new" className="btn btn-primary">
            Make your first bill
          </Link>
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="summary-strip">
            <div className="kpi">
              <span className="kpi-top">Bills shown</span>
              <span className="kpi-value">{shown.length}</span>
            </div>
            <div className="kpi">
              <span className="kpi-top">Total value</span>
              <span className="kpi-value">{formatPaise(shownTotal)}</span>
            </div>
            <div className="kpi">
              <span className="kpi-top">Average bill</span>
              <span className="kpi-value">{formatPaise(sales.length ? Math.round(shownTotal / sales.length) : 0)}</span>
            </div>
          </div>

          <div className="toolbar">
            <div className="search-wrap">
              <Icon name="search" size={18} />
              <input
                type="search"
                className="search"
                placeholder="Search bill number or customer"
                aria-label="Search bills"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="chip-row" role="group" aria-label="Filter by payment">
              <button type="button" className="chip" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
                All
              </button>
              {PAYMENT_MODES.map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  <span className={`pay-dot pay-${m}`} /> {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <section className="card table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Bill</th>
                  <th scope="col" className="hide-sm">
                    Customer
                  </th>
                  <th scope="col" className="hide-sm">
                    Items
                  </th>
                  <th scope="col">Payment</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr
                    key={b.id}
                    className={b.status === 'cancelled' ? 'clickable row-cancelled' : 'clickable'}
                    onClick={() => navigate(`/bills/${b.id}`)}
                  >
                    <td>
                      <Link to={`/bills/${b.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 700, color: 'var(--ink)' }}>
                        {b.number}
                      </Link>
                      {b.status === 'cancelled' && <span className="badge badge-small badge-danger"> Cancelled</span>}
                      <div className="row-sub">{formatDateTime(b.createdAt)}</div>
                    </td>
                    <td className="hide-sm">{b.customerName ?? <span className="muted">Walk-in</span>}</td>
                    <td className="hide-sm">{b.itemCount}</td>
                    <td>
                      <span className="pay-badge">
                        <span className={`pay-dot pay-${b.paymentMode}`} />
                        {PAYMENT_LABELS[b.paymentMode]}
                      </span>
                    </td>
                    <td className="num" style={{ fontWeight: 750 }}>
                      {formatPaise(b.totalPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="empty">No bills match these filters.</p>}
          </section>
        </>
      )}
    </main>
  );
}
