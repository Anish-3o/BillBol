import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { createBill, quoteBill, voiceDraft } from '../api/bills';
import { ApiError } from '../api/client';
import { listProducts } from '../api/products';
import { VoiceInput } from '../components/VoiceInput';
import { formatPaise } from '../lib/money';
import { formatQuantity, isCountUnit, milliToInput, quantityToMilli, unitShort } from '../lib/quantity';
import {
  PAYMENT_LABELS,
  PAYMENT_MODES,
  type BillQuote,
  type PaymentMode,
  type VoiceDraft,
} from '../types/bill';
import type { Product } from '../types/product';

// One line in the cart. The quantity is kept as the text the user typed ("1.5"), so typing
// "1." on the way to "1.5" is not rejected mid-keystroke; it is converted to thousandths
// only when we need a number.
type CartLine = { product: Product; qty: string };

const lineMilli = (line: CartLine) => quantityToMilli(line.qty);

function lineProblem(line: CartLine): string | null {
  const milli = lineMilli(line);
  if (milli === null || milli === 0) return 'Enter a quantity';
  if (isCountUnit(line.product.unit) && milli % 1000 !== 0) return 'Whole numbers only';
  return null;
}

// Adds voice-draft lines to the cart. A product already in the cart gets the extra quantity.
function addDraftToCart(cart: CartLine[], draft: VoiceDraft): CartLine[] {
  const next = [...cart];
  for (const item of draft.items) {
    const index = next.findIndex((l) => l.product.id === item.product.id);
    if (index >= 0) {
      const current = lineMilli(next[index]) ?? 0;
      next[index] = { ...next[index], qty: milliToInput(current + item.quantityMilli) };
    } else {
      next.push({ product: item.product, qty: milliToInput(item.quantityMilli) });
    }
  }
  return next;
}

// The counter screen: speak or search, adjust quantities, confirm.
// Totals always come from the server's /bills/quote (Rule 3: money is calculated in one
// place, on the server). The screen never adds up money itself.
export default function NewBillPage() {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quote, setQuote] = useState<BillQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceDraft | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // --- Voice: what the customer said -> draft lines in the cart ---
  // Rule 2: the AI only fills the cart. Nothing is saved until the shopkeeper checks the
  // lines and presses Confirm, which goes through exactly the same path as a typed bill.
  async function handleTranscript(text: string) {
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceResult(null);
    try {
      const draft = await voiceDraft(text);
      setCart((current) => addDraftToCart(current, draft));
      setVoiceResult(draft);
    } catch (err) {
      setVoiceError(err instanceof ApiError ? err.message : 'Could not reach BillBol. Add the items by hand.');
    } finally {
      setVoiceBusy(false);
    }
  }

  // --- Product search (debounced, stale responses dropped) ---
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

  // --- Cart -> items for the server ---
  const hasProblems = cart.some((l) => lineProblem(l) !== null);
  // A string key so the quote effect only re-runs when the items really change.
  const itemsKey = useMemo(
    () =>
      JSON.stringify(
        cart
          .filter((l) => lineProblem(l) === null)
          .map((l) => ({ productId: l.product.id, quantityMilli: lineMilli(l)! })),
      ),
    [cart],
  );

  // --- Live quote from the server ---
  useEffect(() => {
    const items = JSON.parse(itemsKey) as { productId: string; quantityMilli: number }[];
    if (items.length === 0) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      quoteBill(items)
        .then((q) => {
          if (cancelled) return;
          setQuote(q);
          setQuoteError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(err instanceof ApiError ? err.message : 'Could not calculate the total.');
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [itemsKey]);

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((l) => l.product.id === product.id);
      if (existing) {
        // Tapping the same product again adds one more.
        return current.map((l) =>
          l === existing ? { ...l, qty: milliToInput((lineMilli(l) ?? 0) + 1000) } : l,
        );
      }
      return [...current, { product, qty: '1' }];
    });
    setSearch('');
    setResults([]);
    // Ready for the next item straight away: fast at a busy counter.
    searchRef.current?.focus();
  }

  function setQty(productId: string, qty: string) {
    setCart((current) => current.map((l) => (l.product.id === productId ? { ...l, qty } : l)));
  }

  function step(line: CartLine, delta: number) {
    const next = (lineMilli(line) ?? 0) + delta;
    if (next > 0) setQty(line.product.id, milliToInput(next));
  }

  function remove(productId: string) {
    setCart((current) => current.filter((l) => l.product.id !== productId));
  }

  // Enter in the search box adds the top result (for counters with a keyboard).
  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && results[0]) {
      e.preventDefault();
      addToCart(results[0]);
    }
  }

  async function confirm() {
    if (!quote) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const items = quote.lines.map((l) => ({ productId: l.productId, quantityMilli: l.quantityMilli }));
      const { bill, stockWarnings } = await createBill(items, paymentMode);
      navigate(`/bills/${bill.id}`, { state: { justCreated: true, stockWarnings } });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not save the bill. Please try again.');
      setSubmitting(false);
    }
  }

  const quoteLine = (productId: string) => quote?.lines.find((l) => l.productId === productId);
  const warningFor = (productId: string) => quote?.stockWarnings.find((w) => w.productId === productId);
  const canConfirm = cart.length > 0 && !hasProblems && quote !== null && !submitting;

  return (
    <main className="page bill-page">
      <h1 className="page-title">New bill</h1>

      <VoiceInput onTranscript={handleTranscript} busy={voiceBusy} />
      {voiceError && (
        <div className="form-alert" role="alert">
          {voiceError}
        </div>
      )}
      {voiceResult && (
        <div className="voice-result" role="status">
          <p>
            Heard: <q>{voiceResult.transcript}</q>
          </p>
          {voiceResult.items.length > 0 ? (
            <p>
              <strong>
                Added {voiceResult.items.length} {voiceResult.items.length === 1 ? 'item' : 'items'}.
              </strong>{' '}
              Check the quantities before confirming.
            </p>
          ) : (
            <p>
              <strong>No matching products found.</strong> Try again or search below.
            </p>
          )}
          {voiceResult.unmatched.length > 0 && (
            <p className="voice-unmatched">Not in your products: {voiceResult.unmatched.join(', ')}</p>
          )}
        </div>
      )}

      <div className="bill-search">
        <input
          ref={searchRef}
          type="search"
          className="search"
          placeholder="Search product to add (e.g. sugar, चीनी)"
          aria-label="Search product to add"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        {results.length > 0 && (
          <ul className="search-results" aria-label="Search results">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" className="search-result" onClick={() => addToCart(p)}>
                  <span className="product-main">
                    <span className="product-name">{p.name}</span>
                    {p.localName && <span className="product-local">{p.localName}</span>}
                  </span>
                  <span className="product-side">
                    <span className="product-price">
                      {formatPaise(p.pricePaise)}
                      <span className="product-per"> / {unitShort(p.unit)}</span>
                    </span>
                    <span className="stock">{formatQuantity(p.stockMilli, p.unit)} in stock</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {search.trim() && results.length === 0 && <p className="page-sub">No matching products.</p>}
      </div>

      {cart.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Cart is empty</p>
          <p>Speak the order, or search above and tap a product.</p>
        </div>
      ) : (
        <ul className="cart" aria-label="Items in this bill">
          {cart.map((line) => {
            const { product } = line;
            const problem = lineProblem(line);
            const priced = quoteLine(product.id);
            const warning = warningFor(product.id);
            const qtyId = `qty-${product.id}`;
            return (
              <li key={product.id} className="cart-line">
                <div className="cart-top">
                  <div className="product-main">
                    <span className="product-name">{product.name}</span>
                    <span className="product-local">
                      {formatPaise(priced?.unitPricePaise ?? product.pricePaise)} / {unitShort(product.unit)}
                    </span>
                  </div>
                  <span className="cart-total">{priced ? formatPaise(priced.totalPaise) : '—'}</span>
                </div>
                <div className="cart-controls">
                  <div className="stepper">
                    <button type="button" aria-label={`One less ${product.name}`} onClick={() => step(line, -1000)}>
                      −
                    </button>
                    <label htmlFor={qtyId} className="visually-hidden">
                      Quantity of {product.name} in {unitShort(product.unit)}
                    </label>
                    <input
                      id={qtyId}
                      inputMode="decimal"
                      value={line.qty}
                      onChange={(e) => setQty(product.id, e.target.value)}
                      aria-invalid={problem ? true : undefined}
                    />
                    <button type="button" aria-label={`One more ${product.name}`} onClick={() => step(line, 1000)}>
                      +
                    </button>
                  </div>
                  <span className="product-per">{unitShort(product.unit)}</span>
                  <button type="button" className="link-button" onClick={() => remove(product.id)}>
                    Remove
                  </button>
                </div>
                {problem && <p className="field-error">{problem}</p>}
                {!problem && warning && (
                  <p className="cart-warning">
                    {warning.stockMilli > 0
                      ? `Only ${formatQuantity(warning.stockMilli, warning.unit)} in stock.`
                      : 'Out of stock in your records.'}{' '}
                    You can still sell it.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {quoteError && (
        <div className="form-alert" role="alert">
          {quoteError}
        </div>
      )}

      {cart.length > 0 && (
        <section className="checkout" aria-label="Payment">
          <div className="checkout-total">
            <span>Total</span>
            <strong>{quote ? formatPaise(quote.totalPaise) : '—'}</strong>
          </div>
          {quote?.taxMode === 'gst' && (
            <p className="checkout-tax">
              Includes GST: taxable {formatPaise(quote.taxablePaise)} · CGST {formatPaise(quote.cgstPaise)} · SGST{' '}
              {formatPaise(quote.sgstPaise)}
            </p>
          )}
          <div className="segmented" role="radiogroup" aria-label="Payment mode">
            {PAYMENT_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={paymentMode === mode}
                className={paymentMode === mode ? 'segment segment-on' : 'segment'}
                onClick={() => setPaymentMode(mode)}
              >
                {PAYMENT_LABELS[mode]}
              </button>
            ))}
          </div>
          {submitError && (
            <div className="form-alert" role="alert">
              {submitError}
            </div>
          )}
          <button type="button" className="btn btn-primary btn-block" disabled={!canConfirm} onClick={confirm}>
            {submitting ? 'Saving bill…' : quote ? `Confirm bill · ${formatPaise(quote.totalPaise)}` : 'Confirm bill'}
          </button>
        </section>
      )}
    </main>
  );
}
