// The API stores money as integer paise. These helpers convert at the edges of the UI.

const withPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});
const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

// 4500 -> "₹45", 3850 -> "₹38.50", 12345600 -> "₹1,23,456" (Indian digit grouping).
// Dividing by 100 is fine here because the result is only displayed, never stored.
export function formatPaise(paise: number): string {
  return (paise % 100 === 0 ? wholeRupees : withPaise).format(paise / 100);
}

// "12.5" -> 1250. Parses the text digit by digit instead of Math.round(parseFloat(x) * 100),
// so there is no floating-point step at all. Returns null for anything that is not a
// valid amount with at most 2 decimal places.
export function rupeesToPaise(input: string): number | null {
  const text = input.trim().replace(/^₹/, '').replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const [, rupees, paise = ''] = match;
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
}

// 1250 -> "12.50", 4500 -> "45" (for pre-filling an input).
export function paiseToInput(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`;
}

// How a customer's udhaar balance reads: positive = owes the shop, negative = paid in advance.
export function describeBalance(balancePaise: number): { text: string; tone: 'owes' | 'advance' | 'clear' } {
  if (balancePaise > 0) return { text: `Owes ${formatPaise(balancePaise)}`, tone: 'owes' };
  if (balancePaise < 0) return { text: `Advance ${formatPaise(-balancePaise)}`, tone: 'advance' };
  return { text: 'No dues', tone: 'clear' };
}
