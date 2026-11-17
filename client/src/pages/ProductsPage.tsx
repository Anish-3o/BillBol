import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listProducts } from '../api/products';
import { PageLoader } from '../components/RouteGuards';
import { useSession } from '../hooks/useAuth';
import { formatPaise } from '../lib/money';
import { formatQuantity, unitShort } from '../lib/quantity';
import { isLowStock, type Product, type ProductList } from '../types/product';

const PAGE_SIZE = 100;

export default function ProductsPage() {
  const { user } = useSession();
  const isOwner = user.role === 'owner';
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
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

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          {data && (
            <p className="page-sub">
              {data.total} {data.total === 1 ? 'product' : 'products'}
              {query && ` matching "${query}"`}
            </p>
          )}
        </div>
        {isOwner && (
          <Link to="/products/new" className="btn btn-primary">
            + Add
          </Link>
        )}
      </div>

      <input
        type="search"
        className="search"
        placeholder="Search by name or Hindi name"
        aria-label="Search products"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && (
        <div className="form-alert" role="alert">
          {error}
        </div>
      )}

      {!data && !error && <PageLoader inline />}

      {data && data.items.length === 0 && (
        <div className="empty">
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
        <ul className="product-list">
          {data.items.map((p) => (
            <li key={p.id}>
              {/* Owners tap a product to edit it; staff only view. */}
              {isOwner ? (
                <Link to={`/products/${p.id}/edit`} className="product-row">
                  <ProductRow product={p} />
                </Link>
              ) : (
                <div className="product-row">
                  <ProductRow product={p} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {data && data.total > data.items.length && (
        <p className="page-sub">
          Showing the first {data.items.length} of {data.total}. Search to find others.
        </p>
      )}
    </main>
  );
}

function ProductRow({ product: p }: { product: Product }) {
  const low = isLowStock(p);
  return (
    <>
      <div className="product-main">
        <span className="product-name">{p.name}</span>
        {p.localName && <span className="product-local">{p.localName}</span>}
      </div>
      <div className="product-side">
        <span className="product-price">
          {formatPaise(p.pricePaise)}
          <span className="product-per"> / {unitShort(p.unit)}</span>
        </span>
        <span className={low ? 'stock stock-low' : 'stock'}>
          {low && <span aria-hidden="true">⚠ </span>}
          {formatQuantity(p.stockMilli, p.unit)} in stock
          {low && <span className="visually-hidden"> (low stock)</span>}
        </span>
      </div>
    </>
  );
}
