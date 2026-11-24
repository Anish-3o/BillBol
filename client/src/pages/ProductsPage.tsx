import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { listProducts } from '../api/products';
import { Icon } from '../components/Icon';
import { PageLoader } from '../components/RouteGuards';
import { useSession } from '../hooks/useAuth';
import { formatPaise } from '../lib/money';
import { formatQuantity, unitShort } from '../lib/quantity';
import { isLowStock, type Product, type ProductList } from '../types/product';

const PAGE_SIZE = 100;

// How full the shelf is, relative to 3x the low-stock level (a rough "healthy" amount).
function stockLevel(p: Product): { pct: number; cls: string; label: string } {
  if (p.stockMilli <= 0) return { pct: 0, cls: 'out', label: 'Out of stock' };
  if (isLowStock(p)) return { pct: Math.max(8, (p.stockMilli / (p.lowStockMilli * 3)) * 100), cls: 'low', label: 'Low' };
  const healthy = p.lowStockMilli > 0 ? p.lowStockMilli * 3 : p.stockMilli;
  return { pct: Math.min(100, (p.stockMilli / healthy) * 100), cls: '', label: 'In stock' };
}

export default function ProductsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const isOwner = user.role === 'owner';
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [data, setData] = useState<ProductList | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce: wait until typing pauses for 300 ms before searching,
  // instead of sending a request on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    // If the user types "su" then "sugar", the "su" response might arrive last.
    // `cancelled` drops stale responses so the list always matches the search box.
    let cancelled = false;
    listProducts({ q: query || undefined, limit: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch(() => !cancelled && setError('Could not load products. Please try again.'));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const items = data ? data.items.filter((p) => !onlyLow || isLowStock(p) || p.stockMilli <= 0) : [];
  const lowCount = data ? data.items.filter((p) => isLowStock(p) && p.stockMilli > 0).length : 0;
  const outCount = data ? data.items.filter((p) => p.stockMilli <= 0).length : 0;

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Products & stock</h1>
          {data && (
            <p className="page-sub">
              {data.total} {data.total === 1 ? 'product' : 'products'}
              {query && ` matching "${query}"`}
            </p>
          )}
        </div>
        <div className="button-row">
          <Link to="/stock/receive" className="btn btn-secondary">
            <Icon name="scan" size={18} /> Receive goods
          </Link>
          {isOwner && (
            <Link to="/products/prices" className="btn btn-secondary">
              <Icon name="rupee" size={18} /> Update prices
            </Link>
          )}
          {isOwner && (
            <Link to="/products/new" className="btn btn-primary">
              <Icon name="plus" size={18} /> Add product
            </Link>
          )}
        </div>
      </div>

      {data && !query && (
        <div className="summary-strip">
          <div className="kpi">
            <span className="kpi-top">Products</span>
            <span className="kpi-value">{data.total}</span>
          </div>
          <div className="kpi">
            <span className="kpi-top">Running low</span>
            <span className="kpi-value" style={{ color: lowCount ? 'var(--warn)' : undefined }}>
              {lowCount}
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-top">Out of stock</span>
            <span className="kpi-value" style={{ color: outCount ? 'var(--danger)' : undefined }}>
              {outCount}
            </span>
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" size={18} />
          <input
            type="search"
            className="search"
            placeholder="Search by name or Hindi name"
            aria-label="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className="chip" aria-pressed={onlyLow} onClick={() => setOnlyLow((v) => !v)}>
          <Icon name="alert" size={15} /> Low stock only
        </button>
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
            <Icon name="package" />
          </span>
          {query ? (
            <p>No products match "{query}".</p>
          ) : (
            <>
              <p className="empty-title">No products yet</p>
              <p>
                {isOwner
                  ? 'Add the items you sell, with price and stock, to start billing.'
                  : 'The shop owner has not added any products yet.'}
              </p>
              {isOwner && (
                <Link to="/products/new" className="btn btn-primary">
                  Add your first product
                </Link>
              )}
            </>
          )}
        </div>
      )}

      {data && data.items.length > 0 && (
        <section className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col" className="hide-sm">
                  GST
                </th>
                <th scope="col">Stock</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const level = stockLevel(p);
                return (
                  <tr
                    key={p.id}
                    className={isOwner ? 'clickable' : undefined}
                    onClick={isOwner ? () => navigate(`/products/${p.id}/edit`) : undefined}
                  >
                    <td>
                      <div style={{ fontWeight: 650 }}>{p.name}</div>
                      {p.localName && <div className="row-sub">{p.localName}</div>}
                    </td>
                    <td className="num">
                      <strong>{formatPaise(p.pricePaise)}</strong>
                      <span className="product-per"> / {unitShort(p.unit)}</span>
                      {p.mrpPaise !== null && p.mrpPaise > p.pricePaise && (
                        <div className="row-sub">MRP {formatPaise(p.mrpPaise)}</div>
                      )}
                    </td>
                    <td className="hide-sm">
                      <span className="badge badge-small badge-neutral">{p.gstRate}%</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className={`stock-bar ${level.cls}`}>
                          <span style={{ width: `${level.pct}%` }} />
                        </span>
                        <span className={level.cls ? 'stock stock-low' : 'stock'} style={{ whiteSpace: 'nowrap' }}>
                          {formatQuantity(p.stockMilli, p.unit)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length === 0 && <p className="empty">Nothing is running low. 👍</p>}
        </section>
      )}

      {data && data.total > data.items.length && (
        <p className="page-sub">
          Showing the first {data.items.length} of {data.total}. Search to find others.
        </p>
      )}
    </main>
  );
}
