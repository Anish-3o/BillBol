// Formats integer paise as Indian rupees for text the server writes (assistant replies,
// briefings, reminders). Indian digit grouping: 1,23,456.50. Paise are shown only when
// there are any, the way shopkeepers say amounts ("₹245", "₹46.50").
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = new Intl.NumberFormat('en-IN').format(rupees);
  const text = rest === 0 ? `₹${grouped}` : `₹${grouped}.${String(rest).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

// "1.5 kg", "12 packets": quantity in thousandths -> words a person would say.
export function formatQty(quantityMilli: number, unit: string): string {
  const qty = quantityMilli / 1000;
  const shown = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
  if (unit === 'kg' || unit === 'litre') return `${shown} ${unit === 'kg' ? 'kg' : 'L'}`;
  return `${shown} ${unit}${qty === 1 ? '' : 's'}`;
}
