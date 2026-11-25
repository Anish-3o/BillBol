import { describe, expect, it } from 'vitest';
import { findWake, isBillComplete, isCancel, isConfirm, isPrintRequest, isSkip, wakeVariants } from './intent';

// Confirming a voice bill is the human decision Rule 2 requires, so "yes" must be recognised
// exactly: a real yes in any of the shop's languages, and never a sentence that changes the bill.

describe('isConfirm', () => {
  it.each(['haan', 'haan ji', 'theek hai', 'ok bill karo', 'हाँ', 'हाँ जी बिल बनाओ', 'होय', 'बरोबर आहे', 'yes'])(
    'accepts "%s"',
    (text) => {
      expect(isConfirm(text)).toBe(true);
    },
  );

  it.each(['haan aur do maggi', 'nahi', 'ek kilo cheeni', '', 'haan haan haan haan haan haan haan'])(
    'does not treat "%s" as yes',
    (text) => {
      expect(isConfirm(text)).toBe(false);
    },
  );

  it('ignores the assistant name, so "Ramu haan" is still a yes', () => {
    expect(isConfirm('Ramu haan', ['ramu'])).toBe(true);
  });
});

describe('isCancel', () => {
  it.each(['nahi', 'cancel karo', 'rehne do', 'नको', 'नहीं'])('accepts "%s"', (text) => {
    expect(isCancel(text)).toBe(true);
  });

  it('does not cancel on an order', () => {
    expect(isCancel('nahi do packet doodh')).toBe(false);
  });
});

describe('finishing a voice bill', () => {
  it('recognises "bill complete" style phrases', () => {
    expect(isBillComplete('bas itna hi')).toBe(true);
    expect(isBillComplete('ho gaya')).toBe(true);
    expect(isBillComplete('बिल झालं')).toBe(true);
    expect(isBillComplete('ek aur maggi')).toBe(false);
  });

  it('recognises skipping the customer name', () => {
    expect(isSkip('skip')).toBe(true);
    expect(isSkip('naam nahi chahiye')).toBe(true);
    expect(isSkip('Suresh Patil')).toBe(false);
  });

  it('recognises a print request but not a random sentence', () => {
    expect(isPrintRequest('print karo')).toBe(true);
    expect(isPrintRequest('pichla bill print karo')).toBe(true);
    expect(isPrintRequest('do kilo atta')).toBe(false);
  });
});

describe('wake word', () => {
  const ramu = wakeVariants('Ramu');

  it('includes Hindi spellings of Ramu', () => {
    expect(ramu).toContain('रामू');
  });

  it('finds "Hey Ramu" and returns where the order starts', () => {
    const text = 'Hey Ramu do kilo cheeni';
    expect(text.slice(findWake(text, ramu)).trim()).toBe('do kilo cheeni');
  });

  it('matches whole words only', () => {
    expect(findWake('Ramukaka ka saman', ramu)).toBe(-1);
    expect(findWake('do kilo cheeni', ramu)).toBe(-1);
  });
});
