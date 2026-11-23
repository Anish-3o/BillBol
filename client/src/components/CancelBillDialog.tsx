import { useState } from 'react';
import { cancelBill } from '../api/bills';
import { ApiError } from '../api/client';
import { formatPaise } from '../lib/money';
import type { Bill } from '../types/bill';
import { Icon } from './Icon';

// The common reasons, one tap each. The server requires a reason (it is the owner's audit
// trail), and a cashier with a queue will not type one.
const REASONS = ['Wrong item or quantity', 'Customer returned the goods', 'Wrong payment mode', 'Duplicate bill'];

type Props = {
  bill: Bill;
  onClose: () => void;
  // correct = true: the cashier wants a new bill with the same items, to fix and save again.
  onCancelled: (bill: Bill, correct: boolean) => void;
};

export function CancelBillDialog({ bill, onClose, onCancelled }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<false | 'cancel' | 'correct'>(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(correct: boolean) {
    if (!reason.trim()) {
      setError('Choose or type a reason.');
      return;
    }
    setBusy(correct ? 'correct' : 'cancel');
    setError(null);
    try {
      onCancelled(await cancelBill(bill.id, reason.trim()), correct);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel the bill. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="cancel-title">Cancel bill {bill.number}?</h2>
        <p className="modal-sub">
          {formatPaise(bill.totalPaise)} · the items go back into stock
          {bill.paymentMode === 'udhaar' && bill.customer ? ` and ${bill.customer.name}'s khata is reduced` : ''}. The bill
          stays in your records, marked cancelled.
        </p>

        <span className="checkout-label">Why?</span>
        <div className="reason-chips">
          {REASONS.map((r) => (
            <button key={r} type="button" className={reason === r ? 'chip chip-on' : 'chip'} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <input
          className="reason-input"
          aria-label="Reason for cancelling"
          placeholder="Or type a reason"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <div className="form-alert" role="alert">
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={!!busy}>
            Keep bill
          </button>
          <button type="button" className="btn btn-danger" onClick={() => submit(false)} disabled={!!busy}>
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel bill'}
          </button>
        </div>
        {/* The most common case at the counter: one item was wrong. Cancel and start again
            with the same items in the cart, instead of building the whole bill again. */}
        <button type="button" className="btn btn-primary btn-block" onClick={() => submit(true)} disabled={!!busy}>
          <Icon name="edit" size={18} />
          {busy === 'correct' ? 'Cancelling…' : 'Cancel & make a corrected bill'}
        </button>
      </div>
    </div>
  );
}
