import { phoneticKey, sameName } from '../src/utils/phonetic';

describe('phonetic name matching', () => {
  it.each([
    ['Suresh', 'सुरेश'],
    ['Patil', 'पाटील'],
    ['Kulkarni', 'कुलकर्णी'],
    ['Joshi', 'जोशी'],
    ['Vikram', 'विक्रम'],
    ['Deshmukh', 'देशमुख'],
  ])('%s sounds like %s', (latin, devanagari) => {
    expect(sameName(latin, devanagari)).toBe(true);
  });

  it('does not match different names', () => {
    expect(sameName('Suresh', 'रमेश')).toBe(false);
    expect(sameName('Patil', 'Joshi')).toBe(false);
  });

  it('ignores words with too few consonants', () => {
    expect(phoneticKey('आ')).toBe('');
    expect(sameName('a', 'आ')).toBe(false);
  });
});
