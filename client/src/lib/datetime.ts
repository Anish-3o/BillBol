// Always show times in India time, whatever time zone the device is set to.
const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

// "17 Nov 2026, 12:30 pm"
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}
