// Bill arithmetic. Pure functions on integers: paise for money, thousandths for quantity.
// Rule 3: totals and GST are worked out here in code, never by an LLM.

// 'gst': the shop is GST-registered (has a GSTIN), so each line's price is split into taxable
//        value + CGST + SGST.
// 'none': an unregistered shop cannot legally charge GST, so there is no tax breakup.
export type TaxMode = 'gst' | 'none';

export type LineAmounts = {
  totalPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
};

// a / b rounded to the nearest whole number, halves rounded up (a, b >= 0).
// BigInt because price x quantity can pass 2^53, where plain JS numbers stop being exact
// (₹1 crore = 10^9 paise times 10^9 thousandths = 10^18).
function divRound(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (2n * b);
}

// ₹46/kg x 1.25 kg: 4600 paise x 1250 thousandths / 1000 = 5750 paise.
export function lineTotalPaise(unitPricePaise: number, quantityMilli: number): number {
  return Number(divRound(BigInt(unitPricePaise) * BigInt(quantityMilli), 1000n));
}

// Prices on a kirana shelf include GST (B2C), so the tax is worked backwards from the total.
//
// Counter sales happen in the shop's own state, so GST is split into CGST (central) and
// SGST (state), each exactly half; IGST only applies to sales to another state.
// CGST and SGST must be equal, so we round the half-tax ONCE and use it for both:
//   half    = total x rate / (2 x (100 + rate)), rounded
//   taxable = total - 2 x half
// The taxable value absorbs the rounding (it stays within 1 paisa of the exact value), and
// taxable + CGST + SGST always adds up to the price the customer pays, to the paisa.
// (Rounding the tax and then giving an odd paisa to one side would make CGST and SGST differ,
// and on a long bill those paise add up.)
export function splitInclusiveGst(totalPaise: number, gstRate: number, mode: TaxMode): LineAmounts {
  if (mode === 'none' || gstRate === 0) {
    return { totalPaise, taxablePaise: totalPaise, cgstPaise: 0, sgstPaise: 0 };
  }
  const halfTax = Number(divRound(BigInt(totalPaise) * BigInt(gstRate), 2n * BigInt(100 + gstRate)));
  return { totalPaise, taxablePaise: totalPaise - 2 * halfTax, cgstPaise: halfTax, sgstPaise: halfTax };
}

export function lineAmounts(
  unitPricePaise: number,
  quantityMilli: number,
  gstRate: number,
  mode: TaxMode,
): LineAmounts {
  return splitInclusiveGst(lineTotalPaise(unitPricePaise, quantityMilli), gstRate, mode);
}

export function sumAmounts(lines: LineAmounts[]): LineAmounts {
  return lines.reduce(
    (sum, l) => ({
      totalPaise: sum.totalPaise + l.totalPaise,
      taxablePaise: sum.taxablePaise + l.taxablePaise,
      cgstPaise: sum.cgstPaise + l.cgstPaise,
      sgstPaise: sum.sgstPaise + l.sgstPaise,
    }),
    { totalPaise: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0 },
  );
}

// Indian financial year (1 April to 31 March) in India time, e.g. "2026-27".
// GST requires invoice numbers to be unique and sequential within a financial year,
// so bill numbering restarts every April. The +5:30 shift matters: a bill at 00:10 on
// 1 April IST is still 31 March in UTC.
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  const startYear = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
