import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, toFormErrors, type FormErrors } from '../api/client';
import { addStaff, listStaff, removeStaff, updateShop } from '../api/shop';
import { Field, FormAlert, SelectField } from '../components/FormField';
import { Icon } from '../components/Icon';
import { PrintOptions } from '../components/PrintOptions';
import { UpiQr } from '../components/UpiQr';
import { INDIAN_STATES } from '../constants/indianStates';
import { useAuth, useSession } from '../hooks/useAuth';
import { usePrinterSettings } from '../hooks/usePrinterSettings';
import type { Staff } from '../types/stock';

const NO_ERRORS: FormErrors = { message: null, fields: {} };

// Owner-only (the route and the API both check): the shop's details as printed on receipts,
// the UPI ID customers pay into, who can log in, and this counter's printer.
export default function SettingsPage() {
  return (
    <main className="page page-narrow">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Your shop's details, UPI, staff logins and printer.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        <ShopDetails />
        <StaffAccounts />
        <PrinterCard />
      </div>
    </main>
  );
}

function ShopDetails() {
  const { tenant } = useSession();
  const { setTenant } = useAuth();
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const err = (f: string) => errors.fields[f]?.[0];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    setBusy(true);
    setSaved(false);
    setErrors(NO_ERRORS);
    try {
      // "" clears an optional field on the server.
      const updated = await updateShop({
        name: text('name'),
        phone: text('phone'),
        state: text('state'),
        address: text('address'),
        gstin: text('gstin'),
        upiId: text('upiId'),
      });
      setTenant(updated);
      setSaved(true);
    } catch (error) {
      setErrors(toFormErrors(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <Icon name="store" size={18} /> Shop details
        </h2>
        <span className="card-sub">Printed on every receipt</span>
      </div>
      <form className="settings-form" onSubmit={submit}>
        <FormAlert message={errors.message} />
        <Field label="Shop name" name="name" required maxLength={100} defaultValue={tenant.name} error={err('name')} />
        <Field
          label="Address (optional)"
          name="address"
          maxLength={200}
          placeholder="Shop 4, Main Road, Kothrud, Pune"
          defaultValue={tenant.address ?? ''}
          error={err('address')}
        />
        <div className="field-row">
          <Field label="Shop phone" name="phone" inputMode="tel" required defaultValue={tenant.phone} error={err('phone')} />
          <SelectField label="State" name="state" defaultValue={tenant.state} error={err('state')}>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
        </div>
        <Field
          label="GSTIN (optional)"
          name="gstin"
          maxLength={15}
          placeholder="27AAPFU0939F1ZV"
          hint="With a GSTIN, new bills are tax invoices with CGST/SGST. Bills already saved do not change."
          defaultValue={tenant.gstin ?? ''}
          error={err('gstin')}
        />
        <Field
          label="UPI ID (optional)"
          name="upiId"
          placeholder="sharmakirana@okaxis"
          autoComplete="off"
          hint="Find it in PhonePe / Google Pay / Paytm under your profile. Customers will pay into this account."
          defaultValue={tenant.upiId ?? ''}
          error={err('upiId')}
        />
        {saved && (
          <p className="form-success" role="status">
            ✓ Saved
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save shop details'}
        </button>
      </form>

      {tenant.upiId && (
        <div className="upi-test">
          <p className="checkout-label">Check your UPI QR</p>
          {/* A ₹1 test: scan it with your own phone and make sure the money lands in your account
              before customers start paying with it. */}
          <UpiQr amountPaise={100} note="BillBol test" caption="Scan and pay ₹1 to check it reaches your account." />
        </div>
      )}
    </section>
  );
}

function StaffAccounts() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const err = (f: string) => errors.fields[f]?.[0];

  useEffect(() => {
    listStaff()
      .then(setStaff)
      .catch(() => setLoadError('Could not load staff.'));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const added = await addStaff({
        name: String(form.get('name') ?? ''),
        phone: String(form.get('phone') ?? ''),
        password: String(form.get('password') ?? ''),
      });
      setStaff((s) => [...(s ?? []), added]);
      formEl.reset();
    } catch (error) {
      setErrors(toFormErrors(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: Staff) {
    if (!window.confirm(`Remove ${member.name}? They will not be able to log in any more. Bills they made stay as they are.`)) return;
    try {
      await removeStaff(member.id);
      setStaff((s) => (s ?? []).filter((m) => m.id !== member.id));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Could not remove. Please try again.');
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <Icon name="user" size={18} /> Staff logins
        </h2>
        <span className="card-sub">Helpers can bill and receive goods, not change prices or settings</span>
      </div>
      {loadError && <div className="form-alert">{loadError}</div>}
      {staff === null && !loadError && <div className="skeleton" style={{ height: 60 }} />}
      {staff && staff.length === 0 && <p className="muted">No staff yet. Add a helper so they log in with their own phone.</p>}
      {staff && staff.length > 0 && (
        <ul className="rows" style={{ marginBottom: 14 }}>
          {staff.map((m) => (
            <li key={m.id} className="row">
              <span className="row-icon">{m.name.slice(0, 1)}</span>
              <span className="row-main">
                <span className="row-title">{m.name}</span>
                <span className="row-sub">{m.phone}</span>
              </span>
              <button type="button" className="link-button" style={{ color: 'var(--danger)' }} onClick={() => remove(m)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="settings-form" onSubmit={submit}>
        <FormAlert message={errors.message} />
        <div className="field-row">
          <Field label="Name" name="name" required maxLength={100} placeholder="Raju" error={err('name')} />
          <Field label="Mobile number" name="phone" inputMode="tel" required placeholder="98111 22233" error={err('phone')} />
        </div>
        <Field
          label="Starting password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters. Tell it to them; they log in with their mobile number and this password."
          error={err('password')}
        />
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          <Icon name="plus" size={16} /> {busy ? 'Adding…' : 'Add staff'}
        </button>
      </form>
    </section>
  );
}

function PrinterCard() {
  const [printer, setPrinter] = usePrinterSettings();
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">
          <Icon name="printer" size={18} /> Printer on this device
        </h2>
        <span className="card-sub">Each counter remembers its own printer</span>
      </div>
      <PrintOptions settings={printer} onChange={setPrinter} showAutoPrint />
      <p className="field-hint" style={{ marginTop: 10 }}>
        Any printer installed on this computer or phone works, including 58/80 mm thermal receipt printers. For printing
        without the print dialog, start Chrome or Edge with <code>--kiosk-printing</code>.
      </p>
    </section>
  );
}
