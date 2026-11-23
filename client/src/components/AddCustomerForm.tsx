import { useState, type FormEvent } from 'react';
import { toFormErrors, type FormErrors } from '../api/client';
import { createCustomer } from '../api/customers';
import { useFocusFirstError } from '../hooks/useFocusFirstError';
import type { Customer } from '../types/customer';
import { Field, FormAlert } from './FormField';

const NO_ERRORS: FormErrors = { message: null, fields: {} };

type Props = {
  onCreated: (customer: Customer) => void;
  onCancel?: () => void;
  // Pre-fill the name, e.g. with what was typed into a search box.
  initialName?: string;
};

// A short form used on the udhaar page and right at the counter (new customer mid-bill).
export function AddCustomerForm({ onCreated, onCancel, initialName = '' }: Props) {
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  useFocusFirstError(errors);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Don't let this inner form submit an outer one (it sits inside the billing screen).
    e.stopPropagation();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setErrors(NO_ERRORS);
    try {
      const customer = await createCustomer({
        name: String(form.get('name') ?? '').trim(),
        phone: String(form.get('phone') ?? '').trim() || null,
      });
      onCreated(customer);
    } catch (err) {
      setErrors(toFormErrors(err));
      setBusy(false);
    }
  }

  return (
    <form className="add-customer" onSubmit={handleSubmit}>
      <FormAlert message={errors.message} />
      <div className="field-row">
        <Field
          label="Customer name"
          name="name"
          id="new-customer-name"
          required
          maxLength={100}
          defaultValue={initialName}
          autoComplete="off"
          error={errors.fields.name?.[0]}
        />
        <Field
          label="Mobile (optional)"
          name="phone"
          id="new-customer-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="For WhatsApp reminders later"
          error={errors.fields.phone?.[0]}
        />
      </div>
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save customer'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
