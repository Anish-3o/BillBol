import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listBills } from '../api/bills';
import { PageLoader } from '../components/RouteGuards';
import { formatDateTime } from '../lib/datetime';
import { formatPaise } from '../lib/money';
import { PAYMENT_LABELS, type BillSummary } from '../types/bill';

const PAGE_SIZE = 50;

export default function BillsPage() {
  const [data, setData] = useState<{ items: BillSummary[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBills(PAGE_SIZE)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError('Could not load bills. Please try again.'));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bills</h1>
          {data && (
            <p className="page-sub">
              {data.total} {data.total === 1 ? 'bill' : 'bills'}
            </p>
          )}
        </div>
        <Link to="/bills/new" className="btn btn-primary">
          + New bill
        </Link>
      </div>

      {error && (
        <div className="form-alert" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <PageLoader inline />}

      {data && data.items.length === 0 && (
        <div className="empty">
          <p className="empty-title">No bills yet</p>
          <p>Your bills will appear here.</p>
          <Link to="/bills/new" className="btn btn-primary">
            Make your first bill
          </Link>
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="product-list">
          {data.items.map((b) => (
            <li key={b.id}>
              <Link to={`/bills/${b.id}`} className="product-row">
                <div className="product-main">
                  <span className="product-name">{b.number}</span>
                  <span className="product-local">
                    {formatDateTime(b.createdAt)} · {b.itemCount} {b.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <div className="product-side">
                  <span className="product-price">{formatPaise(b.totalPaise)}</span>
                  <span className="badge badge-small">{PAYMENT_LABELS[b.paymentMode]}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data && data.total > data.items.length && (
        <p className="page-sub">Showing the latest {data.items.length} of {data.total}.</p>
      )}
    </main>
  );
}
