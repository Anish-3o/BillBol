import { useEffect } from 'react';
import type { FormErrors } from '../api/client';

// On a phone the submit button is at the bottom of a long form, so an error near the top
// would be off screen. After a failed submit, move focus to the first invalid field: the
// browser scrolls it into view and screen readers read out its error message.
// If no single field is at fault (e.g. "wrong password"), the alert box gets focus instead.
export function useFocusFirstError(errors: FormErrors): void {
  useEffect(() => {
    if (!errors.message && Object.keys(errors.fields).length === 0) return;
    const target =
      document.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      document.querySelector<HTMLElement>('.form-alert');
    target?.focus();
  }, [errors]);
}
