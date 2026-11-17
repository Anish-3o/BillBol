// The API stores quantities as integer thousandths of the unit (2.5 kg = 2500), like paise.
// These lists mirror server/src/models/Product.ts.

export const COUNT_UNITS = ['piece', 'packet', 'box', 'dozen'] as const;
export const MEASURED_UNITS = ['kg', 'litre'] as const;
export const UNITS = [...COUNT_UNITS, ...MEASURED_UNITS] as const;
export type Unit = (typeof UNITS)[number];

export const UNIT_LABELS: Record<Unit, { short: string; long: string }> = {
  piece: { short: 'pc', long: 'Piece' },
  packet: { short: 'pkt', long: 'Packet' },
  box: { short: 'box', long: 'Box' },
  dozen: { short: 'dozen', long: 'Dozen' },
  kg: { short: 'kg', long: 'Kilogram (kg)' },
  litre: { short: 'L', long: 'Litre (L)' },
};

export function isCountUnit(unit: string): boolean {
  return (COUNT_UNITS as readonly string[]).includes(unit);
}

// 'kg' -> "kg", 'piece' -> "pc"
export function unitShort(unit: string): string {
  return UNIT_LABELS[unit as Unit]?.short ?? unit;
}

// 25500, 'kg' -> "25.5 kg". Display only.
export function formatQuantity(milli: number, unit: string): string {
  const value = (milli / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  return `${value} ${unitShort(unit)}`;
}

// "2.5" -> 2500. Exact text parsing, at most 3 decimals (1 gram / 1 ml). Null if invalid.
export function quantityToMilli(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}

// 2500 -> "2.5", 24000 -> "24" (for pre-filling an input).
export function milliToInput(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const rest = milli % 1000;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}
