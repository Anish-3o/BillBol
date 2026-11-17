import {
  financialYear,
  lineAmounts,
  lineTotalPaise,
  splitInclusiveGst,
  sumAmounts,
} from '../src/services/gst';

describe('lineTotalPaise', () => {
  it('multiplies price by quantity in thousandths', () => {
    expect(lineTotalPaise(4600, 1250)).toBe(5750); // ₹46/kg x 1.25 kg = ₹57.50
    expect(lineTotalPaise(3800, 3000)).toBe(11400); // ₹38 x 3 pieces = ₹114
  });

  it('rounds half a paisa up', () => {
    expect(lineTotalPaise(1, 500)).toBe(1); // 0.5 paise -> 1
    expect(lineTotalPaise(1, 499)).toBe(0); // 0.499 paise -> 0
    expect(lineTotalPaise(4599, 500)).toBe(2300); // ₹45.99 x 0.5 kg = 2299.5 paise -> 2300
    expect(lineTotalPaise(4599, 333)).toBe(1531); // 1531.467 paise -> 1531
  });

  it('stays exact beyond the safe range of plain JS numbers', () => {
    // ₹1 crore x 10,000 units: 10^9 x 10^7 = 10^16 before dividing, past 2^53.
    expect(lineTotalPaise(1_000_000_000, 10_000_000)).toBe(10_000_000_000_000);
  });
});

describe('splitInclusiveGst', () => {
  it('works the tax backwards out of a GST-inclusive price', () => {
    // ₹114 at 5%: half-tax = 11400 x 5 / 210 = 271.43 -> 271 each; taxable = 11400 - 542
    // (exact taxable would be 10857.14; 10858 is within 1 paisa)
    expect(splitInclusiveGst(11400, 5, 'gst')).toEqual({
      totalPaise: 11400,
      taxablePaise: 10858,
      cgstPaise: 271,
      sgstPaise: 271,
    });
  });

  it('always adds up exactly, with CGST = SGST and taxable within 1 paisa of exact', () => {
    for (const rate of [5, 18, 28, 40]) {
      for (let total = 1; total <= 5000; total += 7) {
        const a = splitInclusiveGst(total, rate, 'gst');
        expect(a.taxablePaise + a.cgstPaise + a.sgstPaise).toBe(total);
        expect(a.cgstPaise).toBe(a.sgstPaise);
        // |taxable - total x 100 / (100 + rate)| <= 1, compared in integers
        expect(Math.abs(a.taxablePaise * (100 + rate) - total * 100)).toBeLessThanOrEqual(100 + rate);
      }
    }
  });

  it('charges no tax on 0% items or for unregistered shops', () => {
    expect(splitInclusiveGst(22000, 0, 'gst')).toEqual({
      totalPaise: 22000,
      taxablePaise: 22000,
      cgstPaise: 0,
      sgstPaise: 0,
    });
    expect(splitInclusiveGst(11400, 18, 'none')).toMatchObject({ taxablePaise: 11400, cgstPaise: 0 });
  });
});

describe('sumAmounts', () => {
  it('adds up a bill', () => {
    const lines = [
      lineAmounts(3800, 3000, 5, 'gst'), // soap
      lineAmounts(4600, 1250, 5, 'gst'), // sugar
      lineAmounts(11000, 2000, 0, 'gst'), // rice
    ];
    expect(sumAmounts(lines)).toEqual({
      totalPaise: 39150,
      taxablePaise: 38334,
      cgstPaise: 408,
      sgstPaise: 408,
    });
  });
});

describe('financialYear', () => {
  it('runs from 1 April to 31 March', () => {
    expect(financialYear(new Date('2026-11-17T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-02-01T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2099-12-31T10:00:00Z'))).toBe('2099-00');
  });

  it('switches at midnight India time, not UTC', () => {
    // 23:59:59 IST on 31 March 2026
    expect(financialYear(new Date('2026-03-31T18:29:59Z'))).toBe('2025-26');
    // 00:00:00 IST on 1 April 2026 (still 31 March in UTC)
    expect(financialYear(new Date('2026-03-31T18:30:00Z'))).toBe('2026-27');
  });
});
