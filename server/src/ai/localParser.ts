import type { CatalogueEntry, VoiceOrder } from './voiceOrder';

// The offline "brain": understands a spoken order with plain rules, no LLM.
//
// Why have it at all when Claude does this better?
// - A kirana counter often has patchy internet, and a shop may not have an API key yet.
//   Billing must never stop because a cloud service is unreachable.
// - It is instant (no network round trip), and it costs nothing.
// It returns exactly the same shape as the Claude extractor (VoiceOrder), so the rest of the
// code does not care which one produced the draft. Either way the result is only a draft
// that the shopkeeper confirms (Rule 2), and prices come from the database (Rule 3).

// --- Words people use -------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  // Hindi / Hinglish
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, chhah: 6,
  saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, baarah: 12, pandrah: 15,
  bees: 20, pachas: 50,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  बारह: 12, पंद्रह: 15, बीस: 20,
  // Marathi
  don: 2, दोन: 2, पाच: 5, सहा: 6, नऊ: 9, दहा: 10, बारा: 12, वीस: 20,
  दीड: 1.5, sawa: 1.25, सव्वा: 1.25, अर्धी: 0.5, ardhi: 0.5, deed: 1.5,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, twenty: 20, a: 1, an: 1,
  // Fractions people say instead of numbers
  aadha: 0.5, adha: 0.5, aadhaa: 0.5, aadhi: 0.5, ardha: 0.5, half: 0.5, आधा: 0.5, आधी: 0.5, अर्धा: 0.5,
  paav: 0.25, pao: 0.25, quarter: 0.25, पाव: 0.25,
  pauna: 0.75, पौना: 0.75,
  sava: 1.25, सवा: 1.25,
  dedh: 1.5, deedh: 1.5, derh: 1.5, डेढ: 1.5,
  dhai: 2.5, adhai: 2.5, ढाई: 2.5, अडीच: 2.5,
};

// How a spoken unit converts to the product's own unit (see toProductQuantity).
type SpokenUnit = 'kg' | 'g' | 'l' | 'ml' | 'dozen' | 'count';
const UNIT_WORDS: Record<string, SpokenUnit> = {
  kilo: 'kg', kg: 'kg', kgs: 'kg', kilogram: 'kg', किलो: 'kg',
  gram: 'g', grams: 'g', gm: 'g', gms: 'g', g: 'g', ग्राम: 'g',
  litre: 'l', liter: 'l', litres: 'l', liters: 'l', ltr: 'l', l: 'l', लीटर: 'l', लिटर: 'l',
  ml: 'ml', मिली: 'ml',
  dozen: 'dozen', darjan: 'dozen', दर्जन: 'dozen', डझन: 'dozen',
  packet: 'count', packets: 'count', pack: 'count', paket: 'count', पैकेट: 'count', पाकीट: 'count',
  piece: 'count', pieces: 'count', pc: 'count', pcs: 'count', nag: 'count', नग: 'count',
  box: 'count', dabba: 'count', डब्बा: 'count', bottle: 'count', bottles: 'count', बोतल: 'count',
};

// Words that separate one item from the next.
const SEPARATORS = new Set(['aur', 'and', 'और', 'ani', 'आणि', 'plus', 'phir', 'फिर', 'then', 'tatha', ',']);

// Words that are not items. "do" is NOT here: it means "two" ("do kilo") as well as "give"
// ("de do"); the tokenizer decides which from its position.
const FILLER = new Set([
  'hey', 'hi', 'hello', 'ok', 'okay', 'namaste', 'bhaiya', 'bhaiyya', 'bhai', 'ji', 'please', 'plz',
  'mujhe', 'muje', 'hume', 'humein', 'hamein', 'chahiye', 'chaiye', 'dena', 'dedo', 'dijiye', 'dijie',
  'de', 'bill', 'banao', 'banado', 'bana', 'kar', 'karo', 'karna', 'add', 'jodo', 'jod', 'likho',
  'likh', 'ka', 'ki', 'ke', 'ko', 'wala', 'wali', 'vala', 'the', 'of', 'for', 'me', 'mein', 'main',
  'se', 'bhi', 'sirf', 'make', 'create', 'give', 'order', 'item', 'items', 'new', 'naya', 'customer',
  'मुझे', 'चाहिए', 'दीजिए', 'दे', 'देना', 'बिल', 'बनाओ', 'बना', 'का', 'की', 'के', 'को', 'भी', 'वाला',
  'हे', 'नमस्ते', 'भैया', 'जी', 'करो', 'कर',
  // "... ke udhaar mein likh do": who pays is handled separately from the items.
  'udhaar', 'udhar', 'khata', 'khate', 'khaate', 'baaki', 'likhna', 'उधार', 'खाता', 'खाते', 'में', 'लिखो', 'लिख',
  // Marathi: "mala ... dya", "... havay", "bill kara", "khatyat liha"
  'मला', 'द्या', 'दया', 'हवं', 'हवे', 'हवा', 'हवंय', 'पाहिजे', 'करा', 'बनवा', 'टाका', 'लिहा', 'नमस्कार',
  'चा', 'ची', 'चे', 'च्या', 'ला', 'उधारी', 'खात्यात', 'खात्यावर', 'mala', 'dya', 'have', 'havay', 'pahije', 'kara',
]);

// What customers say -> words that appear in product names or local names.
const SYNONYMS: Record<string, string[]> = {
  cheeni: ['sugar'], chini: ['sugar'], shakkar: ['sugar'], sakhar: ['sugar'], शक्कर: ['sugar', 'चीनी'], साखर: ['sugar', 'चीनी'],
  chawal: ['rice'], chaawal: ['rice'], tandul: ['rice'], तांदूळ: ['rice', 'चावल'],
  toor: ['toor'], tuvar: ['toor'], arhar: ['toor'], tur: ['toor'],
  dal: ['dal'], daal: ['dal'], डाळ: ['dal', 'दाल'],
  moong: ['moong'], mung: ['moong'],
  aata: ['atta'], atta: ['atta'], gehu: ['atta'],
  namak: ['salt'], mith: ['salt'], मीठ: ['salt', 'नमक'],
  tel: ['oil'],
  doodh: ['milk'], dudh: ['milk'],
  makhan: ['butter'], makkhan: ['butter'],
  anda: ['eggs'], ande: ['eggs'], anday: ['eggs'], egg: ['eggs'], अंडा: ['eggs', 'अंडे'], अंडी: ['eggs', 'अंडे'],
  biscuit: ['parle', 'बिस्किट'], biskut: ['parle'], biskit: ['parle'], biscuits: ['parle'], बिस्कुट: ['parle', 'बिस्किट'],
  maggie: ['maggi'], noodles: ['maggi'],
  namkeen: ['bhujia'], sev: ['bhujia'],
  coke: ['coca'], cola: ['coca'], thanda: ['coca'], colddrink: ['coca'],
  sabun: ['soap'], saabun: ['soap'], sabon: ['soap'], साबण: ['soap', 'साबुन'],
  manjan: ['toothpaste'], paste: ['toothpaste'], toothpaste: ['toothpaste'],
  nariyal: ['coconut'],
  sarf: ['surf'], washing: ['surf'], detergent: ['surf'],
  machis: ['matchbox'], maachis: ['matchbox'], matchbox: ['matchbox'],
  agarbati: ['agarbatti'],
  chai: ['tea'], chaipatti: ['tea'], patti: ['tea'],
  haldi: ['turmeric'],
  mirch: ['chilli'], mirchi: ['chilli'],
  pohe: ['poha'],
  // Marathi words and spellings that differ from the Hindi local names
  मॅगी: ['maggi'], चहा: ['tea'], chaha: ['tea'], चहापत्ती: ['tea'], पोहे: ['poha', 'पोहा'],
  बिस्कीट: ['parle'], साबु: ['soap'], अंडे: ['eggs'], हळद: ['turmeric', 'हल्दी'], मिरची: ['chilli'],
  तिखट: ['chilli'], आटा: ['atta'], गव्हाचे: ['atta'], काडेपेटी: ['matchbox'], लोणी: ['butter'],
};

// Prices the customer mentions ("50 rupaye ka") are never quantities.
const PRICE_PATTERN = /(₹|rs\.?)\s*\d+(\.\d+)?|\d+(\.\d+)?\s*(rupaye|rupay|rupees|rupee|rs|रुपये|रुपए|रुपया)/gi;

// --- Text normalisation -----------------------------------------------------------------

// Devanagari spelled with or without a nukta / chandrabindu should match ("डेढ़" = "डेढ").
function normaliseScript(s: string): string {
  // Nukta (U+093C) is dropped; chandrabindu (U+0901) becomes anusvara (U+0902).
  return s.normalize('NFC').replace(/़/g, '').replace(/ँ/g, 'ं');
}

function words(text: string): string[] {
  return normaliseScript(text.toLowerCase())
    .replace(/[।|!?;:"()]/g, ' , ')
    .replace(/,/g, ' , ')
    // "1kg", "500g", "2l": split the number from the unit.
    .replace(/(\d)([a-z\p{Script=Devanagari}])/gu, '$1 $2')
    .replace(/(^|\s)de\s?do(\s|$)/g, ' ') // "de do" = "give", not "two"
    .replace(/दे\s?दो/g, ' ')
    .split(/\s+/)
    // \p{M} keeps Devanagari vowel signs (matras), which Unicode classes as marks, not letters.
    .map((w) => w.replace(/^[^\p{L}\p{M}\p{N},.]+|[^\p{L}\p{M}\p{N},.]+$/gu, '').replace(/\.$/, ''))
    .filter(Boolean);
}

// Splits "Parle-G 250g" into ["parle"] and "चाय पत्ती" into ["चाय", "पत्ती"].
function productTokens(entry: CatalogueEntry): string[] {
  const all = `${entry.name} ${entry.localName ?? ''}`;
  return normaliseScript(all.toLowerCase())
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !/^\d+(g|kg|ml|l)?$/.test(t) && !/^\d/.test(t));
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

// How well one spoken word matches one product: exact 3, prefix 2, one typo 1, else 0.
function wordScore(word: string, tokens: string[]): number {
  const candidates = [word, ...(SYNONYMS[word] ?? [])];
  let best = 0;
  for (const c of candidates) {
    for (const t of tokens) {
      if (c === t) return 3;
      if (c.length >= 4 && t.length >= 4 && (t.startsWith(c) || c.startsWith(t))) best = Math.max(best, 2);
      else if (c.length >= 5 && t.length >= 5 && editDistance(c, t) <= 1) best = Math.max(best, 1);
    }
  }
  return best;
}

// --- Order parsing ----------------------------------------------------------------------

type Group = { qty: number | null; unit: SpokenUnit | null; words: string[]; heard: string[] };

function numberOf(word: string): number | null {
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

// Turns the token stream into groups of "quantity + unit + product words".
// Handles both "do kilo cheeni, ek sabun" and the comma-less "do kilo cheeni ek sabun" that
// speech recognition produces: a new quantity after product words starts a new item.
function groupTokens(tokens: string[], ignore: Set<string>): Group[] {
  const groups: Group[] = [];
  let cur: Group = { qty: null, unit: null, words: [], heard: [] };
  const close = () => {
    if (cur.words.length > 0) groups.push(cur);
    cur = { qty: null, unit: null, words: [], heard: [] };
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (SEPARATORS.has(t)) {
      close();
      continue;
    }
    if (ignore.has(t) || FILLER.has(t)) continue;

    let n = numberOf(t);
    // "do"/"दो" at the end of a phrase means "give" ("cheeni do"), not "two".
    if ((t === 'do' || t === 'दो') && (next === undefined || SEPARATORS.has(next))) continue;
    // "a"/"an" only count as 1 before a unit or product ("a packet of maggi").
    if ((t === 'a' || t === 'an') && (next === undefined || SEPARATORS.has(next))) continue;
    if (n !== null) {
      // "sava do" = 2.25: a fraction word followed by a number.
      if ((t === 'sava' || t === 'सवा') && next !== undefined && numberOf(next) !== null) {
        n = numberOf(next)! + 0.25;
        i++;
      }
      if (cur.words.length > 0) {
        // "cheeni do kilo": a quantity right after the product, followed by a unit or the end,
        // belongs to that product. Otherwise it starts the next item.
        const after = tokens[i + 1];
        const trailing = cur.qty === null && (after === undefined || SEPARATORS.has(after) || UNIT_WORDS[after]);
        if (!trailing) close();
      }
      cur.qty = n;
      cur.heard.push(t);
      continue;
    }
    const unit = UNIT_WORDS[t];
    if (unit && (cur.qty !== null || cur.words.length === 0)) {
      cur.unit = unit;
      cur.heard.push(t);
      continue;
    }
    cur.words.push(t);
    cur.heard.push(t);
  }
  close();
  return groups;
}

// "250 gram" of a kg product is 0.25; "ek dozen" of a piece product is 12.
function toProductQuantity(qty: number, spoken: SpokenUnit | null, productUnit: string): number {
  if (spoken === 'g' && productUnit === 'kg') return qty / 1000;
  if (spoken === 'ml' && productUnit === 'litre') return qty / 1000;
  if (spoken === 'dozen' && productUnit !== 'dozen') return qty * 12;
  return qty;
}

export function parseOrderLocally(
  transcript: string,
  catalogue: CatalogueEntry[],
  ignoreWords: string[] = [],
): VoiceOrder {
  const ignore = new Set(ignoreWords.map((w) => normaliseScript(w.toLowerCase())));
  const tokens = words(transcript.replace(PRICE_PATTERN, ' '));
  const indexed = catalogue.map((entry) => ({ entry, tokens: productTokens(entry) }));
  const order: VoiceOrder = { items: [], unmatched: [] };

  for (const group of groupTokens(tokens, ignore)) {
    // Greedy: one group can hold several products when no quantities were said
    // ("cheeni sabun"). Take the best product, remove the words it used, repeat.
    let remaining = [...group.words];
    let first = true;
    while (remaining.length > 0) {
      let best: { entry: CatalogueEntry; score: number; used: string[] } | null = null;
      for (const { entry, tokens: productWords } of indexed) {
        const used = remaining.filter((w) => wordScore(w, productWords) > 0);
        const score = used.reduce((sum, w) => sum + wordScore(w, productWords), 0);
        // Ties go to the product with fewer words: "dal" alone prefers "Toor Dal" over a
        // longer name only if nothing else in the phrase decides it.
        if (score > 0 && (!best || score > best.score || (score === best.score && productWords.length < productTokens(best.entry).length))) {
          best = { entry, score, used };
        }
      }
      if (!best || best.score < 2) {
        const leftover = remaining.filter((w) => w.length >= 3).join(' ');
        if (leftover) order.unmatched.push(leftover);
        break;
      }
      const qty = first && group.qty !== null ? group.qty : 1;
      order.items.push({
        ref: best.entry.ref,
        quantity: toProductQuantity(qty, first ? group.unit : null, best.entry.unit),
        heard: first ? group.heard.join(' ') : best.used.join(' '),
      });
      remaining = remaining.filter((w) => !best!.used.includes(w));
      first = false;
    }
  }
  return order;
}

// --- Intent detection (for the assistant when it runs offline) -------------------------

// 'info': a question about a product's price or stock ("Maggi hai kya?", "tel kitne ka hai?").
export type LocalIntent = 'sales' | 'restock' | 'udhaar' | 'clear' | 'info' | 'greeting' | 'order';
export type SalesPeriod = 'today' | 'yesterday' | 'last_7_days' | 'this_month';

// Hindi/Hinglish first, then Marathi ("नको", "उधारी", "संपत आलं", "विक्री").
const INTENT_PATTERNS: [LocalIntent, RegExp][] = [
  ['clear', /\b(cancel|clear|reset|hatao|hata do|rehne do|naya bill|nako)\b|रद्द|हटाओ|रहने दो|नको|काढून टाका/i],
  ['udhaar', /\b(udhaa?r|udhaari|baa?ki|khaa?ta|credit|owes?)\b|उधार|बाकी|खाता|खात्यात|खात्यावर/i],
  // Before restock, so "maggi stock mein hai kya" asks about Maggi instead of the reorder list.
  // Bare "kitna"/"किती" (how much) is not enough: "आजची विक्री किती झाली" asks about sales.
  ['info', /\b(kitne ka|kitne ki|kitne ke|kitna hai|kitna hua|kitne hue|price|rate|bhav|bhaav|daam|keemat|kimmat|hai kya|milega|available)\b|कितने का|कितने की|कितने के|कितना है|कितना हुआ|भाव|दाम|कीमत|किंमत|है क्या|मिलेगा|आहे का|मिळेल/i],
  ['restock', /\b(stock|khatam|reorder|restock|mangana|mangwana|low|sampat)\b|स्टॉक|खत्म|ख़त्म|संपत|संपल|संपणार|मागवा/i],
  ['sales', /\b(bikri|bikree|vikri|sales?|kamai|becha|bika|galla|revenue|business|earning|kitne bill)\b|बिक्री|विक्री|कमाई|बेचा|धंधा/i],
];

export function detectIntent(text: string): LocalIntent {
  for (const [intent, pattern] of INTENT_PATTERNS) if (pattern.test(text)) return intent;
  if (/^\s*(hi|hello|hey|namaste|namaskar|नमस्ते|नमस्कार|हेलो)?[\s,!.]*$/i.test(text.replace(/\bramu\b|रामू/gi, ''))) return 'greeting';
  return 'order';
}

export function detectPeriod(text: string): SalesPeriod {
  // Devanagari "कल"/"काल" only at the start of a word: "कालची" is yesterday's, but "विकलं"
  // (Marathi "sold") also contains "कल". \b does not work for Devanagari, hence the explicit start.
  if (/\b(kal|yesterday)\b|(^|[\s,])(कल|काल)/i.test(text)) return 'yesterday';
  if (/\b(hafte|hafta|week|7 din|saat din|aathavda)\b|हफ्ते|हफ़्ते|आठवड/i.test(text)) return 'last_7_days';
  if (/\b(mahine|mahina|month)\b|महीने|महिन/i.test(text)) return 'this_month';
  return 'today';
}

// True when the text is in Devanagari (the reply should be too).
export const isDevanagari = (text: string) => /\p{Script=Devanagari}/u.test(text);
