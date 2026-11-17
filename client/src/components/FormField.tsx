import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Common = { label: string; name: string; error?: string; hint?: string };

// Label, input and message wired together for screen readers: aria-invalid marks the field,
// aria-describedby makes the error (or hint) be read out when the field is focused.
function Wrapper({
  id,
  label,
  error,
  hint,
  children,
}: Omit<Common, 'name'> & { id: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="field-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-msg`} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  ...input
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = input.id ?? input.name;
  return (
    <Wrapper id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        {...input}
      />
    </Wrapper>
  );
}

export function SelectField({
  label,
  error,
  hint,
  children,
  ...select
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = select.id ?? select.name;
  return (
    <Wrapper id={id} label={label} error={error} hint={hint}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        {...select}
      >
        {children}
      </select>
    </Wrapper>
  );
}

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  // role="alert" makes screen readers announce the error as soon as it appears.
  return (
    // tabIndex -1 lets useFocusFirstError focus it without adding it to the Tab order.
    <div className="form-alert" role="alert" tabIndex={-1}>
      {message}
    </div>
  );
}
