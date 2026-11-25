import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { demoErrorMessage } from './demo';
import { parsePriceList, toPriceListCsv } from './priceList';
import { upiLink } from './upi';

describe('upiLink', () => {
  const link = upiLink({ upiId: 'sharmakirana@okaxis', payeeName: 'Sharma Kirana Store', amountPaise: 13150, note: 'Bill 2026-27/0042' });
  const params = new URL(link.replace('upi://', 'https://upi.invalid/')).searchParams;

  it('carries the exact amount from paise, without floating point', () => {
    expect(params.get('am')).toBe('131.50');
    expect(upiLink({ upiId: 'a@b', payeeName: 'x', amountPaise: 5, note: '' })).toContain('am=0.05');
  });

  it('fills in the shop, currency and bill note', () => {
    expect(link.startsWith('upi://pay?')).toBe(true);
    expect(params.get('pa')).toBe('sharmakirana@okaxis');
    expect(params.get('pn')).toBe('Sharma Kirana Store');
    expect(params.get('cu')).toBe('INR');
    expect(params.get('tn')).toBe('Bill 2026-27/0042');
  });

  it('encodes spaces as %20, not +, which some UPI apps show literally', () => {
    expect(link).toContain('Sharma%20Kirana%20Store');
    expect(link).not.toContain('+');
  });
});

describe('parsePriceList', () => {
  it('reads a CSV with a header row, in any column order', () => {
    const { rows, problems } = parsePriceList('MRP,Product,Rate\n30,Parle-G 250g,28\n,"Atta, 5kg",245.50\n');
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { name: 'Parle-G 250g', pricePaise: 2800, mrpPaise: 3000 },
      // Empty MRP cell: keep the saved MRP (no mrpPaise key at all).
      { name: 'Atta, 5kg', pricePaise: 24550 },
    ]);
  });

  it('reads rows pasted from Excel (tab separated, no header)', () => {
    const { rows } = parsePriceList('Maggi 70g\t14\t15');
    expect(rows).toEqual([{ name: 'Maggi 70g', pricePaise: 1400, mrpPaise: 1500 }]);
  });

  it('reports bad lines by number instead of guessing', () => {
    const { rows, problems } = parsePriceList('Name,Price\nSugar,abc\n,40\nSalt,28');
    expect(rows).toEqual([{ name: 'Salt', pricePaise: 2800 }]);
    expect(problems).toEqual(['Line 2: "abc" is not a valid price.', 'Line 3: no product name or barcode.']);
  });

  it('reads back what toPriceListCsv writes (download, edit, upload)', () => {
    const csv = toPriceListCsv([
      { name: 'Tea "Premium" 250g', barcode: '8901234567890', pricePaise: 14000, mrpPaise: 15000 },
      { name: 'Loose sugar', barcode: null, pricePaise: 4450, mrpPaise: null },
    ]);
    expect(parsePriceList(csv).rows).toEqual([
      { name: 'Tea "Premium" 250g', barcode: '8901234567890', pricePaise: 14000, mrpPaise: 15000 },
      { name: 'Loose sugar', pricePaise: 4450 },
    ]);
  });
});

describe('demoErrorMessage', () => {
  it('tells visitors the demo is refreshing, and developers how to seed it', () => {
    const missing = new ApiError(401, 'Invalid phone/email or password');
    expect(demoErrorMessage(missing, false)).toBe('The demo shop is being refreshed. Please try again in a minute.');
    expect(demoErrorMessage(missing, true)).toContain('npm run seed:demo');
  });

  it('passes on the server message for other errors (e.g. rate limit)', () => {
    const limited = new ApiError(429, 'Too many wrong attempts. Please wait 15 minutes and try again.');
    expect(demoErrorMessage(limited, false)).toBe(limited.message);
  });

  it('never mentions developer commands to visitors when offline', () => {
    const msg = demoErrorMessage(new TypeError('Failed to fetch'), false);
    expect(msg).toBe('Could not connect. Check your internet and try again.');
  });
});
