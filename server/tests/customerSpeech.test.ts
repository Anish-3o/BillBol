import { parseCustomerSpeech } from '../src/ai/customerSpeech';

describe('parseCustomerSpeech', () => {
  it('reads a plain name', () => {
    expect(parseCustomerSpeech('suresh patil')).toEqual({ name: 'Suresh Patil', phone: null });
  });

  it('reads a number said in groups, with or without +91', () => {
    expect(parseCustomerSpeech('98223 34455').phone).toBe('9822334455');
    expect(parseCustomerSpeech('+91 98223-34455').phone).toBe('9822334455');
  });

  it('reads both, ignoring the words around them', () => {
    expect(parseCustomerSpeech('naam Ramesh Kumar aur number 9876500011')).toEqual({ name: 'Ramesh Kumar', phone: '9876500011' });
  });

  it('understands Devanagari digits and Hindi/Marathi filler words', () => {
    expect(parseCustomerSpeech('नाम सुरेश पाटील नंबर ९८२२३३४४५५')).toEqual({ name: 'सुरेश पाटील', phone: '9822334455' });
    expect(parseCustomerSpeech('नाव अनिता आहे')).toEqual({ name: 'अनिता', phone: null });
  });

  it('rejects numbers that are not Indian mobile numbers, and long sentences as names', () => {
    expect(parseCustomerSpeech('12345').phone).toBeNull();
    expect(parseCustomerSpeech('1234567890').phone).toBeNull(); // mobiles start with 6-9
    expect(parseCustomerSpeech('do kilo cheeni aur ek sabun dena').name).toBeNull();
  });
});
