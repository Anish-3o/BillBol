// Recognising "yes" and "no" to a drafted bill, in Hinglish, Hindi, Marathi and English.
//
// This runs in the app, not in the LLM, on purpose: confirming a bill is the human decision
// that Rule 2 requires, so it must be exact and instant. Only short replies made entirely of
// these words count; "haan aur do maggi" is a change to the bill, not a yes.

const FILLER = new Set([
  'ji', 'jee', 'hai', 'please', 'plz', 'bhai', 'bhaiya', 'karo', 'kar', 'do', 'de', 'bill', 'करो', 'कर', 'दो', 'जी', 'है', 'बिल', 'na',
  // Marathi: "हो, बिल करा", "बरोबर आहे", "चालेल द्या"
  'आहे', 'करा', 'द्या', 'बनवा', 'झालं', 'aahe', 'kara', 'dya',
]);
const YES = new Set([
  'haan', 'haa', 'ha', 'han', 'haanji', 'yes', 'yeah', 'yep', 'ok', 'okay', 'theek', 'thik', 'confirm',
  'confirmed', 'bana', 'banao', 'save', 'done', 'sahi', 'bilkul', 'chalega', 'हाँ', 'हां', 'हा', 'ठीक',
  'कन्फर्म', 'कन्फ़र्म', 'बना', 'बनाओ', 'बिल्कुल', 'होय', 'हो', 'चालेल', 'सही', 'बरोबर', 'हॉं', 'hoy', 'chalel', 'barobar',
]);
const NO = new Set([
  'nahi', 'nahin', 'nai', 'no', 'cancel', 'mat', 'rehne', 'rahne', 'ruko', 'stop', 'नहीं', 'नही', 'ना',
  'रहने', 'मत', 'रद्द', 'नको', 'कैंसल', 'नाही', 'nako', 'nahi',
]);

function words(text: string, ignore: string[]): string[] {
  const skip = new Set(ignore.map((w) => w.toLowerCase()));
  return text
    .toLowerCase()
    .replace(/[.,!?।]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !skip.has(w) && w !== 'hey' && w !== 'हे');
}

// Printing a saved bill: "print karo", "haan print kar do", "पिछला बिल प्रिंट करो", "बिल छापा".
const PRINT = new Set([
  'print', 'printout', 'chhapo', 'chhaapo', 'chhap', 'nikalo', 'प्रिंट', 'छापो', 'छाप', 'निकालो', 'छापा', 'काढा', 'kadha',
]);
// Words that may come along with a print request without changing it.
const PRINT_EXTRA = new Set([
  'phir', 'fir', 'dobara', 'again', 'last', 'pichla', 'pichhla', 'wala', 'karu', 'karoon', 'ka', 'ki',
  'फिर', 'दोबारा', 'पिछला', 'वाला', 'करूँ', 'करू', 'का', 'की', 'परत', 'पुन्हा', 'शेवटचं', 'शेवटचे',
]);

function onlyFrom(text: string, strong: Set<string>, ignore: string[], allowed: Set<string>[] = []): boolean {
  const list = words(text, ignore);
  if (list.length === 0 || list.length > 6) return false;
  return (
    list.some((w) => strong.has(w)) &&
    list.every((w) => strong.has(w) || FILLER.has(w) || allowed.some((set) => set.has(w)))
  );
}

export const isConfirm = (text: string, ignore: string[] = []) => onlyFrom(text, YES, ignore);
export const isCancel = (text: string, ignore: string[] = []) => onlyFrom(text, NO, ignore);
// "print karo" / "haan, print" / "pichhla bill print karo": must contain a print word.
export const isPrintRequest = (text: string, ignore: string[] = []) => onlyFrom(text, PRINT, ignore, [YES, PRINT_EXTRA]);
// "nahi" / "print mat karo" / "नको, प्रिंट नको", as the answer to "Print karoon?".
export const isPrintDecline = (text: string, ignore: string[] = []) => onlyFrom(text, NO, ignore, [PRINT, PRINT_EXTRA]);

// The words that wake the assistant. "Ramu" also gets the spellings speech recognition
// produces for it in Hindi ("रामू") and common variants.
export function wakeVariants(name: string): string[] {
  const base = name.trim().toLowerCase();
  if (!base) return [];
  const extra = base === 'ramu' ? ['raamu', 'ramoo', 'rammu', 'रामू', 'रामु', 'राम्मू'] : [];
  return [base, ...extra];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Where the wake word ends in the heard text, or -1. Matches whole words only, so "Ramu"
// does not fire on "Ramukaka" in the middle of an order.
export function findWake(text: string, variants: string[]): number {
  if (variants.length === 0) return -1;
  const names = variants.map(escapeRegex).join('|');
  const pattern = new RegExp(`(?:^|[\\s,.!?])(?:hey|hi|ok|ओके|हे|है)?\\s*(?:${names})(?=$|[\\s,.!?])`, 'iu');
  const match = pattern.exec(text);
  return match ? match.index + match[0].length : -1;
}
