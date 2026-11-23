import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { listCustomers } from '../api/customers';
import { AddCustomerForm } from '../components/AddCustomerForm';
import { Icon } from '../components/Icon';
import { PageLoader } from '../components/RouteGuards';
import { describeBalance, formatPaise } from '../lib/money';
import type { CustomerList } from '../types/customer';

// The udhaar khata: who owes the shop, most first.
export default function CustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<CustomerList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    listCustomers({ q: query || undefined, limit: 100 })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch(() => !cancelled && setError('Could not load customers. Please try again.'));
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Udhaar khata</h1>
          <p className="page-sub">Credit sales are added automatically when you bill on udhaar.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
          <Icon name={adding ? 'x' : 'plus'} size={18} /> {adding ? 'Close' : 'Add customer'}
        </button>
      </div>

      {data && (
        <div className="khata-hero">
          <div className="owed-card">
            <span>To collect</span>
            <strong>{formatPaise(data.totalOwedPaise)}</strong>
            <p>
              from {data.customersOwing} {data.customersOwing === 1 ? 'customer' : 'customers'}
            </p>
          </div>
          <div className="kpi">
            <span className="kpi-top">
              Customers
              <span className="kpi-icon">
                <Icon name="user" size={16} />
              </span>
            </span>
            <span className="kpi-value">{data.total}</span>
            <span className="kpi-delta delta-flat">in your khata</span>
          </div>
          <div className="kpi">
            <span className="kpi-top">
              Average dues
              <span className="kpi-icon amber">
                <Icon name="wallet" size={16} />
              </span>
            </span>
            <span className="kpi-value">
              {formatPaise(data.customersOwing ? Math.round(data.totalOwedPaise / data.customersOwing) : 0)}
            </span>
            <span className="kpi-delta delta-flat">per customer owing</span>
          </div>
        </div>
      )}

      {adding && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2 className="card-title" style={{ marginBottom: 14 }}>
            <Icon name="user" size={18} /> New customer
          </h2>
          <AddCustomerForm
            initialName={search.trim()}
            onCreated={(c) => navigate(`/customers/${c.id}`)}
            onCancel={() => setAdding(false)}
          />
        </section>
      )}

      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" size={18} />
          <input
            type="search"
            className="search"
            placeholder="Search name or mobile"
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="form-alert">{error}</div>}
      {!data && !error && <PageLoader inline />}

      {data && data.items.length === 0 && (
        <div className="card empty">
          <span className="empty-icon">
            <Icon name="book" />
          </span>
          <p className="empty-title">{query ? `No customer matches "${query}"` : 'No customers yet'}</p>
          <p>Add regulars who buy on credit, or choose "Udhaar" when billing.</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <section className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col" className="hide-sm">
                  Mobile
                </th>
                <th scope="col" className="num">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => {
                const balance = describeBalance(c.balancePaise);
                return (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="row-icon">{c.name.slice(0, 1).toUpperCase()}</span>
                        <strong>{c.name}</strong>
                      </div>
                    </td>
                    <td className="hide-sm">{c.phone ?? <span className="muted">—</span>}</td>
                    <td className="num">
                      <span className={`balance balance-${balance.tone}`}>{balance.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
