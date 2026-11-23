import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { findProductByBarcode, listProducts } from '../api/products';
import { listReceipts, receiveStock } from '../api/shop';
import { CameraScanner } from '../components/CameraScanner';
import { Icon } from '../components/Icon';
import { useSession } from '../hooks/useAuth';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { cameraScanSupported } from '../lib/barcodeDetector';
import { formatDateTime } from '../lib/datetime';
import { formatQuantity, isCountUnit, milliToInput, quantityToMilli, unitShort } from '../lib/quantity';
import { beep } from '../lib/sound';
import type { Product } from '../types/product';
import type { StockReceipt } from '../types/stock';

// One product coming in. The quantity is kept as typed ("2.5"), like the billing cart.
type Line = { product: Product; qty: string };
type ScanResult = { tone: 'ok' | 'error'; code: string; text: string; unknown?: boolean; at: number };

function lineProblem(line: Line): string | null {
  const milli = quantityToMilli(line.qty);
  if (milli === null || milli === 0) return 'Enter a quantity';
  if (isCountUnit(line.product.unit) && milli % 1000 !== 0) return 'Whole numbers only';
  return null;
}

// "Receive goods": the wholesaler's delivery arrives, the helper scans each packet (or types
// the count), and stock goes up. The same scanner that bills goods out counts them in.
export default function ReceiveStockPage() {
  const { user } = useSession();
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [supplier, setSupplier] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<StockReceipt | null>(null);
  const [recent, setRecent] = useState<StockReceipt[] | null>(null);
  const cache = useRef(new Map<string, Product>());

  useEffect(() => {
    listReceipts(8)
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  // Search by name as the user types (debounced); an exact barcode typed here also matches.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      listProducts({ q, limit: 8 })
        .then((r) => !cancelled && setResults(r.items))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  function add(product: Product, milli = 1000) {
    setSaved(null);
    setLines((current) => {
      const existing = current.find((l) => l.product.id === product.id);
      if (!existing) return [{ product, qty: milliToInput(milli) }, ...current];
      return current.map((l) => (l === existing ? { ...l, qty: milliToInput((quantityToMilli(l.qty) ?? 0) + milli) } : l));
    });
  }

  async function handleScan(code: string) {
    try {
      const product = cache.current.get(code) ?? (await findProductByBarcode(code));
      cache.current.set(code, product);
      add(product);
      beep('ok');
      setScan({ tone: 'ok', code, text: `${product.name} +1`, at: Date.now() });
    } catch (err) {
      beep('error');
      const unknown = err instanceof ApiError && err.status === 404;
      setScan({
        tone: 'error',
        code,
        unknown,
        text: unknown ? `No product has barcode ${code}` : 'Could not look up the barcode. Check the connection.',
        at: Date.now(),
      });
    }
  }
  useBarcodeScanner(handleScan, !cameraOpen && !busy);

  const setQty = (id: string, qty: string) => setLines((c) => c.map((l) => (l.product.id === id ? { ...l, qty } : l)));
  const remove = (id: string) => setLines((c) => c.filter((l) => l.product.id !== id));
  const hasProblems = lines.some((l) => lineProblem(l) !== null);

  async function save() {
    if (lines.length === 0 || hasProblems) return;
    setBusy(true);
    setError(null);
    try {
      const receipt = await receiveStock({
        items: lines.map((l) => ({ productId: l.product.id, quantityMilli: quantityToMilli(l.qty)! })),
        supplier: supplier.trim() || undefined,
      });
      setSaved(receipt);
      setLines([]);
      setSupplier('');
      setScan(null);
      cache.current.clear(); // cached products now show old stock numbers
      setRecent((r) => [receipt, ...(r ?? [])].slice(0, 8));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Link to="/products" className="back-link">
        <Icon name="arrowLeft" size={16} /> Products
      </Link>
      <div className="page-header">
        <div>
          <h1 className="page-title">Receive goods</h1>
          <p className="page-sub">A delivery came in? Scan each packet or search and type the count. Stock goes up when you save.</p>
        </div>
      </div>

      {saved && (
        <div className="success-banner" role="status">
          <strong>✓ Stock updated</strong>
          <span>
            {saved.items.length} {saved.items.length === 1 ? 'product' : 'products'} added
            {saved.supplier ? ` from ${saved.supplier}` : ''}.
          </span>
        </div>
      )}

      <div className="receive-grid">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="scan" size={18} /> Add items
            </h2>
            <span className="scan-ready">
              <span className="live-dot on" /> Scanner ready
            </span>
            {cameraScanSupported() && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCameraOpen(true)}>
                <Icon name="camera" size={16} /> Scan with camera
              </button>
            )}
          </div>
          {scan && (
            <div className={`scan-flash scan-${scan.tone}`} role="status" key={scan.at}>
              <Icon name={scan.tone === 'ok' ? 'check' : 'alert'} size={16} />
              <span>{scan.text}</span>
              {scan.unknown && user.role === 'owner' && (
                <Link to={`/products/new?barcode=${encodeURIComponent(scan.code)}`} target="_blank" rel="noopener">
                  Add as new product
                </Link>
              )}
            </div>
          )}
          <div className="search-wrap">
            <Icon name="search" size={18} />
            <input
              type="search"
              className="search"
              placeholder="Search product to add (e.g. Maggi, चीनी)"
              aria-label="Search product to add"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) {
                  e.preventDefault();
                  add(results[0]);
                  setSearch('');
                }
              }}
            />
          </div>
          {results.length > 0 && (
            <ul className="pick-list">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      add(p);
                      setSearch('');
                    }}
                  >
                    <span>
                      <strong>{p.name}</strong> {p.localName && <span className="muted">{p.localName}</span>}
                    </span>
                    <span className="muted">{formatQuantity(p.stockMilli, p.unit)} in stock</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {lines.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">
                <Icon name="package" />
              </span>
              <p className="empty-title">Nothing added yet</p>
              <p>Scan the first packet, or search above.</p>
            </div>
          ) : (
            <ul className="cart receive-lines">
              {lines.map((line) => {
                const { product } = line;
                const milli = quantityToMilli(line.qty);
                const problem = lineProblem(line);
                return (
                  <li key={product.id} className="cart-line">
                    <div className="cart-top">
                      <div className="product-main">
                        <span className="product-name">{product.name}</span>
                        <span className="product-local">
                          Stock {formatQuantity(product.stockMilli, product.unit)}
                          {milli ? ` → ${formatQuantity(product.stockMilli + milli, product.unit)}` : ''}
                        </span>
                      </div>
                      <button type="button" className="link-button" onClick={() => remove(product.id)}>
                        Remove
                      </button>
                    </div>
                    <div className="cart-controls">
                      <div className="stepper">
                        <button
                          type="button"
                          aria-label={`One less ${product.name}`}
                          onClick={() => (milli ?? 0) > 1000 && setQty(product.id, milliToInput((milli ?? 0) - 1000))}
                        >
                          −
                        </button>
                        <input
                          inputMode="decimal"
                          aria-label={`Quantity of ${product.name} received, in ${unitShort(product.unit)}`}
                          value={line.qty}
                          onChange={(e) => setQty(product.id, e.target.value)}
                          aria-invalid={problem ? true : undefined}
                        />
                        <button type="button" aria-label={`One more ${product.name}`} onClick={() => add(product)}>
                          +
                        </button>
                      </div>
                      <span className="product-per">{unitShort(product.unit)}</span>
                      {/* Wholesale packs: cartons of 12 or 24 are typed far more often than 1. */}
                      {isCountUnit(product.unit) && (
                        <>
                          <button type="button" className="chip" onClick={() => add(product, 12_000)}>
                            +12
                          </button>
                          <button type="button" className="chip" onClick={() => add(product, 24_000)}>
                            +24
                          </button>
                        </>
                      )}
                    </div>
                    {problem && <p className="field-error">{problem}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {lines.length > 0 && (
            <div className="receive-save">
              <input
                className="reason-input"
                aria-label="Supplier (optional)"
                placeholder="Supplier (optional), e.g. Gupta Traders"
                maxLength={100}
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
              {error && (
                <div className="form-alert" role="alert">
                  {error}
                </div>
              )}
              <button type="button" className="btn btn-primary btn-block btn-lg" disabled={busy || hasProblems} onClick={save}>
                <Icon name="check" size={20} />
                {busy ? 'Saving…' : `Add to stock · ${lines.length} ${lines.length === 1 ? 'product' : 'products'}`}
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="clock" size={18} /> Recent deliveries
            </h2>
          </div>
          {recent === null && <div className="skeleton" style={{ height: 120 }} />}
          {recent && recent.length === 0 && <p className="empty">No deliveries recorded yet.</p>}
          {recent && recent.length > 0 && (
            <ul className="rows">
              {recent.map((r) => (
                <li key={r.id} className="row">
                  <span className="row-icon">
                    <Icon name="package" size={15} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{r.supplier ?? 'Delivery'}</span>
                    <span className="row-sub">
                      {r.items
                        .slice(0, 3)
                        .map((i) => `${i.name} ${formatQuantity(i.quantityMilli, i.unit)}`)
                        .join(', ')}
                      {r.items.length > 3 ? ` +${r.items.length - 3} more` : ''}
                    </span>
                    <span className="row-sub">
                      {formatDateTime(r.createdAt)} · {r.createdByName}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {cameraOpen && (
        <CameraScanner
          onScan={handleScan}
          onClose={() => setCameraOpen(false)}
          status={scan && <span className={`scan-flash scan-${scan.tone}`}>{scan.text}</span>}
        />
      )}
    </main>
  );
}
