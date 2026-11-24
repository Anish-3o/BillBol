// Reads a customer's name and mobile number from what the shopkeeper said when Ramu asked
// "Customer ka naam ya number?": "Suresh Patil", "98223 34455", "naam Suresh, number
// 9822334455", "नाम सुरेश पाटील नंबर ९८२२३३४४५५". Plain rules, no AI: this is a lookup key,
// and the result is read back to the shopkeeper before the bill is saved.

// Hindi/Marathi speech recognition sometimes writes digits in Devanagari.
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

// Words around the name and number that are not part of either.
const FILLER = new Set([
  'naam', 'name', 'nam', 'mera', 'meri', 'unka', 'unki', 'inka', 'hai', 'ka', 'ki', 'ke', 'number', 'no', 'mobile',
  'phone', 'aur', 'and', 'customer', 'grahak', 'is', 'my', 'his', 'her', 'the', 'naav', 'nav', 'aahe', 'ani',
  'नाम', 'नंबर', 'मोबाइल', 'मोबाईल', 'फ़ोन', 'फोन', 'है', 'का', 'की', 'के', 'और', 'ग्राहक', 'मेरा', 'उनका',
  'नाव', 'आहे', 'चा', 'ची', 'चे', 'आणि', 'माझं', 'त्यांचं',
]);

export type CustomerSpeech = { name: string | null; phone: string | null };

export function parseCustomerSpeech(text: string): CustomerSpeech {
  const latin = text.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));

  // The number may be said in groups ("98223 34455") or with +91 / 0 in front.
  const digits = latin.replace(/\D/g, '');
  const mobile = /([6-9]\d{9})$/.exec(digits.length > 10 ? digits.slice(-10) : digits);
  const phone = digits.length >= 10 && mobile ? mobile[1] : null;

  const words = latin
    .replace(/\+?\d[\d\s-]*/g, ' ')
    .replace(/[.,!?।:;"'()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()));
  // A name is a few words; a long sentence here means the shopkeeper said something else.
  const name = words.length > 0 && words.length <= 4 ? words.map(capitalise).join(' ') : null;
  return { name, phone };
}

// "suresh" -> "Suresh". Devanagari has no capitals and is left as it is.
const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
