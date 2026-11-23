import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toFormErrors, type FormErrors } from '../api/client';
import { AuthLayout } from '../components/AuthLayout';
import { Field, FormAlert } from '../components/FormField';
import { Icon } from '../components/Icon';
import { useAuth } from '../hooks/useAuth';
import { useFocusFirstError } from '../hooks/useFocusFirstError';
import { DEMO_LOGIN } from '../lib/demo';

const NO_ERRORS: FormErrors = { message: null, fields: {} };

export default function LoginPage() {
  const { login } = useAuth();
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(errors);

  async function signIn(identifier: string, password: string) {
    setSubmitting(true);
    setErrors(NO_ERRORS);
    try {
      await login(identifier, password);
      // No navigate() here: <RequireGuest> sees the new status and redirects.
    } catch (err) {
      setErrors(toFormErrors(err));
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void signIn(String(form.get('identifier')), String(form.get('password')));
  }

  // Fills the form too, so it is visible what the demo login is.
  function loginAsDemo() {
    const form = formRef.current;
    if (form) {
      (form.elements.namedItem('identifier') as HTMLInputElement).value = DEMO_LOGIN.phone;
      (form.elements.namedItem('password') as HTMLInputElement).value = DEMO_LOGIN.password;
    }
    void signIn(DEMO_LOGIN.phone, DEMO_LOGIN.password);
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
      <div className="demo-box">
        <Icon name="store" size={22} style={{ color: 'var(--accent-strong)' }} />
        <p>
          <strong>Just looking?</strong>
          Open the demo shop with a month of sample bills.
        </p>
        <button type="button" className="btn btn-accent btn-sm" onClick={loginAsDemo} disabled={submitting}>
          Use demo
        </button>
      </div>
      <div className="divider">or log in</div>
      <form onSubmit={handleSubmit} ref={formRef}>
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
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthLayout>
  );
}
