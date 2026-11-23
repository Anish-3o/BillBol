import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toFormErrors, type FormErrors } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Field, FormAlert, SelectField } from '../components/FormField';
import { INDIAN_STATES } from '../constants/indianStates';
import { useAuth } from '../hooks/useAuth';
import type { RegisterInput } from '../types/auth';
import { useFocusFirstError } from '../hooks/useFocusFirstError';

const NO_ERRORS: FormErrors = { message: null, fields: {} };

// The browser checks the basics (required, length, email format) before submitting.
// The server's Zod schema stays the source of truth: its per-field messages (bad phone,
// bad GSTIN, phone already registered...) are shown under the matching input.
export default function RegisterPage() {
  const { register } = useAuth();
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  useFocusFirstError(errors);
  const fieldError = (name: keyof RegisterInput) => errors.fields[name]?.[0];

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (name: keyof RegisterInput) => String(form.get(name) ?? '');
    setSubmitting(true);
    setErrors(NO_ERRORS);
    try {
      // Empty optional fields are sent as "", which the server treats as "not provided".
      await register({
        shopName: value('shopName'),
        ownerName: value('ownerName'),
        phone: value('phone'),
        email: value('email'),
        state: value('state'),
        gstin: value('gstin'),
        password: value('password'),
      });
    } catch (err) {
      setErrors(toFormErrors(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your shop"
      subtitle="Set up BillBol in under a minute."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormAlert message={errors.message} />
        <Field
          label="Shop name"
          name="shopName"
          autoComplete="organization"
          placeholder="Sharma Kirana Store"
          required
          minLength={2}
          maxLength={100}
          error={fieldError('shopName')}
        />
        <Field
          label="Your name"
          name="ownerName"
          autoComplete="name"
          placeholder="Ramesh Sharma"
          required
          minLength={2}
          maxLength={100}
          error={fieldError('ownerName')}
        />
        <Field
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="98765 43210"
          required
          hint="You will log in with this number."
          error={fieldError('phone')}
        />
        <Field
          label="Email (optional)"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          error={fieldError('email')}
        />
        <SelectField label="State" name="state" required defaultValue="" error={fieldError('state')}>
          <option value="" disabled>
            Select your state
          </option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
        <Field
          label="GSTIN (optional)"
          name="gstin"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={15}
          placeholder="27ABCDE1234F1Z5"
          hint="Leave empty if your shop is not GST-registered."
          error={fieldError('gstin')}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          hint="At least 8 characters."
          error={fieldError('password')}
        />
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting ? 'Creating your shop…' : 'Create shop'}
        </button>
      </form>
    </AuthLayout>
  );
}
