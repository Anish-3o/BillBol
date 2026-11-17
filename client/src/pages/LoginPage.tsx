import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toFormErrors, type FormErrors } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Field, FormAlert } from '../components/FormField';
import { useAuth } from '../hooks/useAuth';
import { useFocusFirstError } from '../hooks/useFocusFirstError';

const NO_ERRORS: FormErrors = { message: null, fields: {} };

export default function LoginPage() {
  const { login } = useAuth();
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  useFocusFirstError(errors);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setErrors(NO_ERRORS);
    try {
      await login(String(form.get('identifier')), String(form.get('password')));
      // No navigate() here: <RequireGuest> sees the new status and redirects.
    } catch (err) {
      setErrors(toFormErrors(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your shop."
      footer={
        <>
          New to BillBol? <Link to="/register">Create your shop</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormAlert message={errors.message} />
        <Field
          label="Mobile number or email"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          placeholder="98765 43210"
          required
          error={errors.fields.identifier?.[0]}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.fields.password?.[0]}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthLayout>
  );
}
