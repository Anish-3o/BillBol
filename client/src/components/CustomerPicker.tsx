import { useEffect, useState } from 'react';
import { listCustomers } from '../api/customers';
import { describeBalance } from '../lib/money';
import type { Customer } from '../types/customer';
import { AddCustomerForm } from './AddCustomerForm';

type Props = {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
};

// Choose whose khata an udhaar bill goes into: search existing customers or add one on the spot.
export function CustomerPicker({ value, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (value) return;
    let cancelled = false;
    // An empty search shows the customers who owe the most: the usual udhaar regulars.
    const timer = setTimeout(() => {
      listCustomers({ q: search.trim() || undefined, limit: 6 })
        .then((r) => !cancelled && setResults(r.items))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, value]);

  if (value) {
    const balance = describeBalance(value.balancePaise);
    return (
      <div className="picked-customer">
        <div className="product-main">
          <span className="product-name">{value.name}</span>
          <span className={`balance balance-${balance.tone}`}>{balance.text}</span>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  if (adding) {
    return (
      <AddCustomerForm
        initialName={search.trim()}
        onCreated={(customer) => {
          setAdding(false);
          onChange(customer);
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }

  return (
    <div className="customer-picker">
      <input
        type="search"
        className="search"
        placeholder="Whose khata? Search name or mobile"
        aria-label="Search customer for udhaar"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="search-results" aria-label="Customers">
          {results.map((c) => {
            const balance = describeBalance(c.balancePaise);
            return (
              <li key={c.id}>
                <button type="button" className="search-result" onClick={() => onChange(c)}>
                  <span className="product-main">
                    <span className="product-name">{c.name}</span>
                    {c.phone && <span className="product-local">{c.phone}</span>}
                  </span>
                  <span className={`balance balance-${balance.tone}`}>{balance.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="link-button add-link" onClick={() => setAdding(true)}>
        + New customer{search.trim() ? ` "${search.trim()}"` : ''}
      </button>
    </div>
  );
}
