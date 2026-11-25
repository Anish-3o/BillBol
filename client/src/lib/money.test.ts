import { describe, expect, it } from 'vitest';
import { describeBalance, formatPaise, paiseToInput, rupeesToPaise } from './money';
import { formatQuantity, milliToInput, quantityToMilli } from './quantity';

// Money and quantities are integers (paise, thousandths) everywhere (Rule 4). These helpers are
// the only place the UI turns typed text into those integers, so they must be exact.

describe('rupeesToPaise', () => {
  it.each([
    ['45', 4500],
    ['12.5', 1250],
    ['12.05', 1205],
    ['0.1', 10],
    ['₹1,234.50', 123450],
    [' 7 ', 700],
  ])('"%s" -> %i paise', (input, paise) => {
    expect(rupeesToPaise(input)).toBe(paise);
  });

  it('is exact where floating point is not (0.29 * 100 = 28.999...)', () => {
    expect(rupeesToPaise('0.29')).toBe(29);
    expect(rupeesToPaise('1.15')).toBe(115);
  });

  it.each(['', 'abc', '12.345', '-5', '1.2.3', '₹'])('rejects "%s"', (input) => {
    expect(rupeesToPaise(input)).toBeNull();
  });
});

describe('formatPaise', () => {
  it('shows whole rupees without decimals and uses Indian digit grouping', () => {
    expect(formatPaise(4500)).toBe('₹45');
    expect(formatPaise(12345600)).toBe('₹1,23,456');
  });

  it('shows paise when there are any', () => {
    expect(formatPaise(3850)).toBe('₹38.50');
  });
});

describe('paiseToInput', () => {
  it('round-trips with rupeesToPaise', () => {
    for (const paise of [0, 5, 50, 1205, 4500, 123456]) {
      expect(rupeesToPaise(paiseToInput(paise))).toBe(paise);
    }
  });
});

describe('describeBalance (udhaar)', () => {
  it('positive means the customer owes the shop', () => {
    expect(describeBalance(25000)).toEqual({ text: 'Owes ₹250', tone: 'owes' });
  });
  it('negative means paid in advance', () => {
    expect(describeBalance(-5000)).toEqual({ text: 'Advance ₹50', tone: 'advance' });
  });
  it('zero means no dues', () => {
    expect(describeBalance(0).tone).toBe('clear');
  });
});

describe('quantities (thousandths of a unit)', () => {
  it.each([
    ['2.5', 2500],
    ['0.25', 250],
    ['1.005', 1005],
    ['24', 24000],
  ])('"%s" -> %i', (input, milli) => {
    expect(quantityToMilli(input)).toBe(milli);
  });

  it.each(['', '1.0005', '-1', 'two'])('rejects "%s"', (input) => {
    expect(quantityToMilli(input)).toBeNull();
  });

  it('round-trips for pre-filling inputs', () => {
    for (const milli of [250, 1005, 2500, 24000]) {
      expect(quantityToMilli(milliToInput(milli))).toBe(milli);
    }
  });

  it('formats with the short unit name', () => {
    expect(formatQuantity(25500, 'kg')).toBe('25.5 kg');
    expect(formatQuantity(3000, 'piece')).toBe('3 pc');
  });
});
