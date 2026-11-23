import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { getBill } from '../api/bills';
import { ApiError } from '../api/client';
import { getProduct } from '../api/products';
import { CancelBillDialog } from '../components/CancelBillDialog';
import { Icon } from '../components/Icon';
import { PrintOptions } from '../components/PrintOptions';
import { PageLoader } from '../components/RouteGuards';
import { useSession } from '../hooks/useAuth';
import { usePrinterSettings } from '../hooks/usePrinterSettings';
import { formatDateTime } from '../lib/datetime';
import { formatPaise } from '../lib/money';
import { printBill } from '../lib/printer';
import { formatQuantity, unitShort } from '../lib/quantity';
import type { AssistantDraft } from '../types/assistant';
import { PAYMENT_LABELS, STAFF_CANCEL_WINDOW_MS, type Bill, type StockWarning } from '../types/bill';
import type { Product } from '../types/product';

type LocationState = { justCreated?: boolean; stockWarnings?: StockWarning[]; printed?: boolean } | null;

// A plain-text copy of the bill for WhatsApp (amounts are the saved ones, never recalculated).
function billAsText(bill: Bill, shopName: string): string {
  const lines = bill.items.map((i) => `${i.name} × ${formatQuantity(i.quantityMilli, i.unit)} = ${formatPaise(i.totalPaise)}`);
  return [`*${shopName}*`, `Bill ${bill.number} · ${formatDateTime(bill.createdAt)}`, '', ...lines, '', `*Total: ${formatPaise(bill.totalPaise)}*`, `Paid by: ${PAYMENT_LABELS[bill.paymentMode]}`, '', 'Dhanyavaad! 🙏'].join('\n');
}

export default function BillDetailPage() {
  const { id } = useParams();
  const { tenant, user } = useSession();
  const navigate = useNavigate();
  const state = useLocation().state as LocationState;
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printer, setPrinter] = usePrinterSettings();
  const [cancelOpen, setCancelOpen] = useState(false);

  // Cancelled: either stay here (the page now shows it as cancelled), or open a new bill with
  // the same items, customer and payment mode, ready to fix and save. Products archived since
  // the sale cannot be sold again, so they are listed as "not found" instead.
  async function onCancelled(updated: Bill, correct: boolean) {
    setBill(updated);
    setCancelOpen(false);
    if (!correct) return;
    const found = await Promise.all(updated.items.map((i) => getProduct(i.productId).catch(() => null)));
    const items: { product: Product; quantityMilli: number }[] = [];
    const missing: string[] = [];
    updated.items.forEach((item, i) => {
      const product = found[i];
      if (product?.isActive) items.push({ product, quantityMilli: item.quantityMilli });
      else missing.push(item.name);
    });
    const draft: AssistantDraft = {
      items,
      unmatched: missing,
      paymentMode: updated.paymentMode,
      customer: updated.customer ? { ...updated.customer, balancePaise: 0 } : null,
      quote: null,
    };
    navigate('/bills/new', { state: { assistantDraft: draft, correcting: updated.number } });
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getBill(id)
      .then((b) => !cancelled && setBill(b))
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.status === 404 ? 'Bill not found.' : 'Could not load this bill.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <main className="page page-narrow">
        <div className="form-alert" role="alert">
          {error}
        </div>
        <Link to="/bills" className="back-link">
          <Icon name="arrowLeft" size={16} /> All bills
        </Link>
      </main>
    );
  }
  if (!bill) return <PageLoader inline />;

  const warnings = state?.justCreated ? (state.stockWarnings ?? []) : [];
  // The server decides (owner: any bill; staff: own bill for 10 minutes); this only hides a
  // button that would be refused.
  const canCancel =
    bill.status !== 'cancelled' &&
    (user.role === 'owner' ||
      (bill.createdById === user.id && Date.now() - new Date(bill.createdAt).getTime() < STAFF_CANCEL_WINDOW_MS));

  return (
    <main className="page page-narrow">
      <Link to="/bills" className="back-link no-print">
        <Icon name="arrowLeft" size={16} /> All bills
      </Link>
      {bill.cancelled && (
        <div className="cancelled-banner" role="status">
          <strong>Cancelled</strong>
          <span>
            {formatDateTime(bill.cancelled.at)} by {bill.cancelled.byName}: {bill.cancelled.reason}. Not counted in sales; stock
            was put back{bill.paymentMode === 'udhaar' ? ' and the khata was reduced' : ''}.
          </span>
        </div>
      )}
      {state?.justCreated && !bill.cancelled && (
        <div className="success-banner" role="status">
          <strong>✓ Bill saved</strong>
          <span>
            Stock has been updated{bill.paymentMode === 'udhaar' && bill.customer ? ` and ${bill.customer.name}'s khata has the entry` : ''}.
            {state.printed && ' Sent to the printer.'}
          </span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="warning-banner">
          <strong>Stock needs a recount</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w.productId}>
                {w.name}: sold {formatQuantity(w.requestedMilli, w.unit)}, but your records showed{' '}
                {w.stockMilli > 0 ? `only ${formatQuantity(w.stockMilli, w.unit)}` : 'none in stock'}.
              </li>
            ))}
          </ul>
        </div>
      )}

      <article className={bill.cancelled ? 'receipt receipt-cancelled' : 'receipt'}>
        <header className="receipt-shop">
          <h2>{tenant.name}</h2>
          {tenant.address && <p>{tenant.address}</p>}
          <p>
            {tenant.state} · Ph {tenant.phone}
          </p>
          {tenant.gstin && <p>GSTIN {tenant.gstin}</p>}
          <p style={{ marginTop: 6, fontWeight: 700, color: 'var(--ink-2)' }}>
            {bill.taxMode === 'gst' ? 'TAX INVOICE' : 'BILL OF SUPPLY'}
          </p>
        </header>

        <div className="receipt-meta">
          <div>
            <span>Bill no.</span>
            <strong>{bill.number}</strong>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span>Date</span>
            <strong>{formatDateTime(bill.createdAt)}</strong>
          </div>
          <div>
            <span>Payment</span>
            <strong className="pay-badge">
              <span className={`pay-dot pay-${bill.paymentMode}`} />
              {PAYMENT_LABELS[bill.paymentMode]}
            </strong>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span>{bill.customer ? 'Customer' : 'Billed by'}</span>
            <strong>
              {bill.customer ? <Link to={`/customers/${bill.customer.id}`}>{bill.customer.name}</Link> : bill.createdByName}
            </strong>
          </div>
        </div>

        <table className="bill-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((item) => (
              <tr key={item.productId}>
                <td>
                  <span className="product-name">{item.name}</span>
                  <span className="product-local">
                    {formatQuantity(item.quantityMilli, item.unit)} × {formatPaise(item.unitPricePaise)}/{unitShort(item.unit)}
                    {bill.taxMode === 'gst' && ` · GST ${item.gstRate}%`}
                  </span>
                </td>
                <td className="num">{formatPaise(item.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {bill.taxMode === 'gst' && (
              <>
                <tr className="tax-row">
                  <td>Taxable value</td>
                  <td className="num">{formatPaise(bill.taxablePaise)}</td>
                </tr>
                <tr className="tax-row">
                  <td>CGST</td>
                  <td className="num">{formatPaise(bill.cgstPaise)}</td>
                </tr>
                <tr className="tax-row">
                  <td>SGST</td>
                  <td className="num">{formatPaise(bill.sgstPaise)}</td>
                </tr>
              </>
            )}
            <tr className="total-row">
              <td>Total</td>
              <td className="num">{formatPaise(bill.totalPaise)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="receipt-foot">
          {bill.taxMode === 'none' ? 'No GST charged: this shop is not GST-registered. ' : 'Prices include GST. '}
          Dhanyavaad, phir padhariye! 🙏
        </p>
      </article>

      <div className="receipt-actions">
        <button type="button" className="btn btn-secondary" onClick={() => printBill(bill, tenant, printer.paper)}>
          <Icon name="printer" size={18} /> {state?.printed ? 'Print again' : 'Print'}
        </button>
        <PrintOptions settings={printer} onChange={setPrinter} />
        {!bill.cancelled && (
          <a
            className="btn btn-whatsapp"
            href={`https://wa.me/?text=${encodeURIComponent(billAsText(bill, tenant.name))}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="message" size={18} /> Share on WhatsApp
          </a>
        )}
        <Link to="/bills/new" className="btn btn-primary">
          <Icon name="plus" size={18} /> New bill
        </Link>
        {canCancel && (
          <button type="button" className="btn btn-danger-ghost" onClick={() => setCancelOpen(true)}>
            <Icon name="x" size={18} /> Cancel or correct this bill
          </button>
        )}
      </div>
      {cancelOpen && <CancelBillDialog bill={bill} onClose={() => setCancelOpen(false)} onCancelled={onCancelled} />}
    </main>
  );
}
