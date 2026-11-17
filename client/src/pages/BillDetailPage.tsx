import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { getBill } from '../api/bills';
import { ApiError } from '../api/client';
import { PageLoader } from '../components/RouteGuards';
import { formatDateTime } from '../lib/datetime';
import { formatPaise } from '../lib/money';
import { formatQuantity, unitShort } from '../lib/quantity';
import { PAYMENT_LABELS, type Bill, type StockWarning } from '../types/bill';

type LocationState = { justCreated?: boolean; stockWarnings?: StockWarning[] } | null;

export default function BillDetailPage() {
  const { id } = useParams();
  const state = useLocation().state as LocationState;
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <main className="page">
        <div className="form-alert" role="alert">
          {error}
        </div>
        <Link to="/bills">← All bills</Link>
      </main>
    );
  }
  if (!bill) return <PageLoader inline />;

  const warnings = state?.justCreated ? (state.stockWarnings ?? []) : [];

  return (
    <main className="page">
      {state?.justCreated && (
        <div className="success-banner" role="status">
          <strong>✓ Bill saved</strong>
          <span>Stock has been updated.</span>
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

      <section className="info-card bill-card">
        <div className="bill-head">
          <div>
            <p className="page-sub">Bill no.</p>
            <h1 className="bill-number">{bill.number}</h1>
          </div>
          <span className="badge">{PAYMENT_LABELS[bill.paymentMode]}</span>
        </div>
        <p className="page-sub">
          {formatDateTime(bill.createdAt)} · by {bill.createdByName}
        </p>

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
                    {formatQuantity(item.quantityMilli, item.unit)} × {formatPaise(item.unitPricePaise)}/
                    {unitShort(item.unit)}
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
        {bill.taxMode === 'none' && <p className="page-sub">No GST charged: this shop is not GST-registered.</p>}
      </section>

      <div className="button-row">
        <Link to="/bills/new" className="btn btn-primary">
          New bill
        </Link>
        <Link to="/bills" className="btn btn-secondary">
          All bills
        </Link>
      </div>
    </main>
  );
}
