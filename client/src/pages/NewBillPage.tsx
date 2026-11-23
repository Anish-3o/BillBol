import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { createBill, quoteBill, voiceDraft } from '../api/bills';
import { ApiError } from '../api/client';
import { findProductByBarcode, listProducts } from '../api/products';
import { CameraScanner } from '../components/CameraScanner';
import { CustomerPicker } from '../components/CustomerPicker';
import { Icon } from '../components/Icon';
import { PrintOptions } from '../components/PrintOptions';
import { VoiceInput } from '../components/VoiceInput';
import { useSession } from '../hooks/useAuth';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { usePrinterSettings } from '../hooks/usePrinterSettings';
import { cameraScanSupported } from '../lib/barcodeDetector';
import { formatPaise, paiseToInput, rupeesToPaise } from '../lib/money';
import { loadHeld, MAX_HELD, newHeldId, saveHeld, type HeldBill } from '../lib/heldBills';
import { formatTime } from '../lib/datetime';
import { printBill } from '../lib/printer';
import { UpiQr } from '../components/UpiQr';
import { beep } from '../lib/sound';
import { formatQuantity, isCountUnit, milliToInput, quantityToMilli, unitShort } from '../lib/quantity';
import type { AssistantDraft } from '../types/assistant';
import { PAYMENT_LABELS, PAYMENT_MODES, type BillQuote, type PaymentMode, type VoiceDraft } from '../types/bill';
import type { Customer } from '../types/customer';
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
function addDraftToCart(cart: CartLine[], items: { product: Product; quantityMilli: number }[]): CartLine[] {
  const next = [...cart];
  for (const item of items) {
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

// The last scan, shown under the products header (and inside the camera view).
type ScanResult = { tone: 'ok' | 'error'; code: string; text: string; unknown?: boolean; at: number };

// "Customer gave ₹500, return how much?" The bill total comes from the server's quote; this
// only subtracts it from the note the customer handed over, for display. Nothing here is
// saved or sent anywhere, so it is not part of the money rules the server enforces.
function CashChange({ totalPaise, given, onChange }: { totalPaise: number; given: string; onChange: (v: string) => void }) {
  const givenPaise = rupeesToPaise(given);
  // Quick buttons: the notes a customer is likely to hand over for this total.
  const suggestions = [...new Set([10_00, 50_00, 100_00, 500_00].map((note) => Math.ceil(totalPaise / note) * note))]
    .filter((p) => p > totalPaise)
    .slice(0, 3);
  return (
    <div className="checkout-section cash-change">
      <label className="checkout-label" htmlFor="cash-given">
        Cash received
      </label>
      <div className="cash-row">
        <input
          id="cash-given"
          inputMode="decimal"
          placeholder="₹"
          value={given}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
        {suggestions.map((p) => (
          <button key={p} type="button" className="chip" onClick={() => onChange(paiseToInput(p))}>
            {formatPaise(p)}
          </button>
        ))}
      </div>
      {givenPaise !== null && given.trim() !== '' && (
        <p className={givenPaise >= totalPaise ? 'cash-result cash-ok' : 'cash-result cash-short'} role="status">
          {givenPaise >= totalPaise
            ? `Return ${formatPaise(givenPaise - totalPaise)}`
            : `${formatPaise(totalPaise - givenPaise)} short`}
        </p>
      )}
    </div>
  );
}

const PAY_ICONS ={ cash: 'wallet', upi: 'phone', card: 'receipt', udhaar: 'book' } as const;

// The counter screen: speak or tap products, adjust quantities, confirm.
// Totals always come from the server's /bills/quote (Rule 3: money is calculated in one
// place, on the server). The screen never adds up money itself.
export default function NewBillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as { assistantDraft?: AssistantDraft | null; correcting?: string } | null;
  // A cart handed over by Ramu ("edit in billing") or by "Cancel & make a corrected bill".
  const handedOver = routeState?.assistantDraft ?? null;
  const correcting = routeState?.correcting ?? null;
  const searchRef = useRef<HTMLInputElement>(null);
  const { tenant, user } = useSession();
  const [printer, setPrinter] = usePrinterSettings();

  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[] | null>(null);
  // A draft Ramu handed over ("edit in billing") starts the cart.
  const [cart, setCart] = useState<CartLine[]>(() => (handedOver ? addDraftToCart([], handedOver.items) : []));
  const [quote, setQuote] = useState<BillQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  // Which cart (itemsKey) the quote above was calculated for.
  const [quotedKey, setQuotedKey] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(handedOver?.paymentMode ?? 'cash');
  const [customer, setCustomer] = useState<Customer | null>(
    handedOver?.customer ? { ...handedOver.customer, phone: null, createdAt: '' } : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceDraft | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Codes already looked up on this screen: a cashier scans the same Maggi again and again,
  // and the second scan should be instant. Prices still come from the server's quote.
  const scanCache = useRef(new Map<string, Product>());
  const [held, setHeld] = useState<HeldBill[]>(loadHeld);
  // What the customer handed over in cash, as typed ("500"). Only for the change calculation.
  const [cashGiven, setCashGiven] = useState('');

  function updateHeld(next: HeldBill[]) {
    setHeld(next);
    saveHeld(next);
  }

  function resetCart() {
    setCart([]);
    setPaymentMode('cash');
    setCustomer(null);
    setCashGiven('');
    setSubmitError(null);
  }

  // Park this cart and start an empty one for the next customer.
  function holdCurrent(list = held): HeldBill[] {
    if (cart.length === 0) return list;
    const entry: HeldBill = {
      id: newHeldId(),
      heldAt: new Date().toISOString(),
      lines: cart,
      paymentMode,
      customer,
      totalPaise: quoteIsCurrent ? quote!.totalPaise : null,
    };
    const next = [entry, ...list].slice(0, MAX_HELD);
    updateHeld(next);
    resetCart();
    return next;
  }

  // Bring a held cart back. Whatever is on screen now is held in its place (a swap), so
  // switching between two waiting customers never loses either cart.
  function resumeHeld(entry: HeldBill) {
    const rest = holdCurrent(held.filter((h) => h.id !== entry.id)).filter((h) => h.id !== entry.id);
    updateHeld(rest);
    setCart(entry.lines);
    setPaymentMode(entry.paymentMode);
    setCustomer(entry.customer);
    setCashGiven('');
  }

  // --- Barcode: a scanner gun (any brand, see useBarcodeScanner) or the phone camera ---
  // Each scan adds one unit, like a supermarket till: scan three packets, get quantity 3.
  async function handleScan(code: string) {
    try {
      const product = scanCache.current.get(code) ?? (await findProductByBarcode(code));
      scanCache.current.set(code, product);
      addToCart(product);
      beep('ok');
      setScan({ tone: 'ok', code, text: `${product.name} added`, at: Date.now() });
    } catch (err) {
      beep('error');
      const unknown = err instanceof ApiError && err.status === 404;
      setScan({
        tone: 'error',
        code,
        unknown,
        at: Date.now(),
        text: unknown ? `No product has barcode ${code}` : 'Could not look up the barcode. Check the connection.',
      });
    }
  }
  // Paused while the camera is open (it reports scans itself) and while saving.
  useBarcodeScanner(handleScan, !cameraOpen && !submitting);

  // --- Voice: what the customer said -> draft lines in the cart ---
  // Rule 2: the AI only fills the cart. Nothing is saved until the shopkeeper checks the
  // lines and presses Confirm, which goes through exactly the same path as a typed bill.
  async function handleTranscript(text: string) {
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceResult(null);
    try {
      const draft = await voiceDraft(text);
      setCart((current) => addDraftToCart(current, draft.items));
      setVoiceResult(draft);
    } catch (err) {
      setVoiceError(err instanceof ApiError ? err.message : 'Could not reach BillBol. Add the items by hand.');
    } finally {
      setVoiceBusy(false);
    }
  }

  // --- Product tiles: the shop's products, filtered by the search box (debounced) ---
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        listProducts({ q: search.trim() || undefined, limit: 24 })
          .then((r) => !cancelled && setProducts(r.items))
          .catch(() => !cancelled && setProducts([]));
      },
      search ? 200 : 0,
    );
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
        cart.filter((l) => lineProblem(l) === null).map((l) => ({ productId: l.product.id, quantityMilli: lineMilli(l)! })),
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
          setQuotedKey(itemsKey);
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
        return current.map((l) => (l === existing ? { ...l, qty: milliToInput((lineMilli(l) ?? 0) + 1000) } : l));
      }
      return [...current, { product, qty: '1' }];
    });
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
    if (e.key === 'Enter' && products?.[0]) {
      e.preventDefault();
      addToCart(products[0]);
      setSearch('');
    }
  }

  async function confirm() {
    if (!quote || !canConfirm) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const items = quote.lines.map((l) => ({ productId: l.productId, quantityMilli: l.quantityMilli }));
      const { bill, stockWarnings } = await createBill(items, paymentMode, paymentMode === 'udhaar' ? customer?.id : undefined);
      window.dispatchEvent(new CustomEvent('billbol:bill-created', { detail: bill }));
      // Printed from the saved bill the server returned (its number and amounts), never from
      // the cart on screen. The print frame lives outside React, so navigating does not stop it.
      if (printer.autoPrint) printBill(bill, tenant, printer.paper);
      navigate(`/bills/${bill.id}`, { state: { justCreated: true, stockWarnings, printed: printer.autoPrint } });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not save the bill. Please try again.');
      setSubmitting(false);
    }
  }

  const quoteLine = (productId: string) => quote?.lines.find((l) => l.productId === productId);
  const warningFor = (productId: string) => quote?.stockWarnings.find((w) => w.productId === productId);
  const needsCustomer = paymentMode === 'udhaar' && !customer;
  // The quote must be for the cart as it is now. A packet scanned a moment before pressing F9
  // is still being priced (the quote waits 250 ms), and saving the older quote would leave it out.
  const quoteIsCurrent = quote !== null && quotedKey === itemsKey;
  const canConfirm = cart.length > 0 && !hasProblems && quoteIsCurrent && !submitting && !needsCustomer;
  const inCart = new Set(cart.map((l) => l.product.id));

  // Keyboard counters (scanner + keyboard): F9 or Ctrl+Enter saves (and prints) the bill, so
  // the cashier never reaches for the mouse. A ref keeps the listener reading the latest state.
  const confirmRef = useRef(confirm);
  useEffect(() => {
    confirmRef.current = confirm;
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        void confirmRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">New bill</h1>
          <p className="page-sub">Speak the order, scan barcodes, or tap products. Nothing is saved until you confirm.</p>
        </div>
      </div>

      {correcting && (
        <div className="warning-banner" role="status">
          <strong>Correcting bill {correcting}</strong>
          <span>
            The old bill is cancelled. Its items are in the cart: fix what was wrong and save.
            {handedOver && handedOver.unmatched.length > 0 && ` Not available any more: ${handedOver.unmatched.join(', ')}.`}
          </span>
        </div>
      )}

      {held.length > 0 && (
        <div className="held-bar" aria-label="Held bills">
          <span className="held-label">
            <Icon name="clock" size={16} /> On hold
          </span>
          {held.map((h) => (
            <button key={h.id} type="button" className="held-chip" onClick={() => resumeHeld(h)} title="Resume this bill">
              <strong>{h.customer?.name ?? `${h.lines.length} ${h.lines.length === 1 ? 'item' : 'items'}`}</strong>
              <span>
                {h.totalPaise !== null ? formatPaise(h.totalPaise) : '…'} · {formatTime(h.heldAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="pos">
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <VoiceInput onTranscript={handleTranscript} busy={voiceBusy} />
          {voiceError && (
            <div className="form-alert" role="alert">
              {voiceError}
            </div>
          )}
          {voiceResult && (
            <div className="voice-result" role="status">
              <p>
                Heard: <q>{voiceResult.transcript}</q>{' '}
                <span className={voiceResult.engine === 'claude' ? 'badge badge-small badge-ai' : 'badge badge-small badge-neutral'}>
                  {voiceResult.engine === 'claude' ? '✦ Claude' : 'Offline parser'}
                </span>
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
                  <strong>No matching products found.</strong> Try again or tap a product below.
                </p>
              )}
              {voiceResult.unmatched.length > 0 && (
                <p className="voice-unmatched">Not in your products: {voiceResult.unmatched.join(', ')}</p>
              )}
            </div>
          )}

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">
                <Icon name="package" size={18} /> Products
              </h2>
              <span className="scan-ready" title="Plug in any USB or Bluetooth barcode scanner and scan a packet">
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
                  // A new tab, so the bill being made is not lost while the product is added.
                  <Link to={`/products/new?barcode=${encodeURIComponent(scan.code)}`} target="_blank" rel="noopener">
                    Add as new product
                  </Link>
                )}
              </div>
            )}
            <div className="search-wrap" style={{ marginBottom: 14 }}>
              <Icon name="search" size={18} />
              <input
                ref={searchRef}
                type="search"
                className="search"
                placeholder="Search (sugar, चीनी) or barcode · Enter adds the first"
                aria-label="Search product to add"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            </div>
            {products === null && <div className="skeleton" style={{ height: 160 }} />}
            {products && products.length === 0 && <p className="page-sub">No matching products.</p>}
            {products && products.length > 0 && (
              <div className="tile-grid">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={inCart.has(p.id) ? 'tile in-cart' : 'tile'}
                    onClick={() => addToCart(p)}
                  >
                    <span className="tile-name">{p.name}</span>
                    {p.localName && <span className="tile-local">{p.localName}</span>}
                    <span className="tile-price">
                      {formatPaise(p.pricePaise)} <small>/ {unitShort(p.unit)}</small>
                    </span>
                    <span className={p.lowStockMilli > 0 && p.stockMilli <= p.lowStockMilli ? 'stock stock-low' : 'stock'}>
                      {formatQuantity(p.stockMilli, p.unit)} in stock
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {cart.length > 0 && (
          <a href="#current-bill" className="mobile-cart-bar">
            <span>
              {cart.length} {cart.length === 1 ? 'item' : 'items'} · <strong>{quote ? formatPaise(quote.totalPaise) : '…'}</strong>
            </span>
            <span className="btn btn-primary btn-sm">
              View bill <Icon name="chevronRight" size={16} />
            </span>
          </a>
        )}

        <aside className="pos-cart" id="current-bill">
          <section className="card cart-panel" aria-label="Current bill">
            <div className="cart-head">
              <h2 className="card-title">
                <Icon name="cart" size={18} /> Current bill
              </h2>
              {cart.length > 0 && (
                <div className="cart-head-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => holdCurrent()}
                    title={held.length >= MAX_HELD ? `Up to ${MAX_HELD} bills can wait; the oldest is dropped` : 'Park this bill and serve the next customer'}
                  >
                    <Icon name="clock" size={15} /> Hold
                  </button>
                  <button type="button" className="link-button" style={{ color: 'var(--muted)' }} onClick={resetCart}>
                    Clear
                  </button>
                </div>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="empty cart-empty">
                <span className="empty-icon">
                  <Icon name="mic" />
                </span>
                <p className="empty-title">Cart is empty</p>
                <p>Speak the order, or tap a product.</p>
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

            {cart.length > 0 && (
              <div className="checkout">
                {quoteError && (
                  <div className="form-alert" role="alert">
                    {quoteError}
                  </div>
                )}
                <div className="checkout-total">
                  <span>Total</span>
                  <strong>{quote ? formatPaise(quote.totalPaise) : '—'}</strong>
                </div>
                {quote?.taxMode === 'gst' ? (
                  <p className="checkout-tax">
                    Incl. GST · taxable {formatPaise(quote.taxablePaise)} · CGST {formatPaise(quote.cgstPaise)} · SGST{' '}
                    {formatPaise(quote.sgstPaise)}
                  </p>
                ) : (
                  <p className="checkout-tax">{cart.length} {cart.length === 1 ? 'item' : 'items'}</p>
                )}

                <div className="checkout-section">
                  <span className="checkout-label">Payment</span>
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
                        <Icon name={PAY_ICONS[mode]} size={18} />
                        {PAYMENT_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                </div>

                {paymentMode === 'udhaar' && (
                  <div className="checkout-section">
                    <span className="checkout-label">Write in whose khata?</span>
                    <CustomerPicker value={customer} onChange={setCustomer} />
                  </div>
                )}

                {/* UPI: show the QR with the exact amount; save once the shopkeeper's phone or
                    soundbox says the money arrived. Only for a quote of the cart as it is now. */}
                {paymentMode === 'upi' && quote && quoteIsCurrent && (
                  <div className="checkout-section">
                    <UpiQr
                      amountPaise={quote.totalPaise}
                      note={`Bill at ${tenant.name}`}
                      caption="Customer scans to pay. Save the bill when the money arrives."
                    />
                  </div>
                )}

                {paymentMode === 'cash' && quote && quoteIsCurrent && (
                  <CashChange totalPaise={quote.totalPaise} given={cashGiven} onChange={setCashGiven} />
                )}

                {submitError && (
                  <div className="form-alert" role="alert">
                    {submitError}
                  </div>
                )}
                <PrintOptions settings={printer} onChange={setPrinter} showAutoPrint />
                <button type="button" className="btn btn-primary btn-block btn-lg" disabled={!canConfirm} onClick={confirm}>
                  <Icon name={printer.autoPrint ? 'printer' : 'check'} size={20} />
                  {submitting
                    ? 'Saving bill…'
                    : needsCustomer
                      ? 'Choose the customer'
                      : `${printer.autoPrint ? 'Save & print' : 'Confirm bill'}${quote ? ` · ${formatPaise(quote.totalPaise)}` : ''}`}
                </button>
                <p className="shortcut-hint">
                  Shortcut: <kbd>F9</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
                </p>
              </div>
            )}
          </section>
        </aside>
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
