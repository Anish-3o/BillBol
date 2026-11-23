import { detectIntent, detectPeriod, parseOrderLocally } from '../src/ai/localParser';
import type { CatalogueEntry } from '../src/ai/voiceOrder';

const catalogue: CatalogueEntry[] = [
  { ref: 'P1', name: 'Sugar (loose)', localName: 'चीनी', unit: 'kg' },
  { ref: 'P2', name: 'Lux Soap 100g', localName: 'साबुन', unit: 'piece' },
  { ref: 'P3', name: 'Maggi Noodles 70g', localName: 'मैगी', unit: 'packet' },
  { ref: 'P4', name: 'Toor Dal (loose)', localName: 'तूर दाल', unit: 'kg' },
  { ref: 'P5', name: 'Eggs', localName: 'अंडे', unit: 'piece' },
  { ref: 'P6', name: 'Amul Milk 500ml', localName: 'दूध', unit: 'packet' },
  { ref: 'P7', name: 'Tata Tea Gold 250g', localName: 'चाय पत्ती', unit: 'packet' },
];

const parse = (text: string, ignore: string[] = []) => parseOrderLocally(text, catalogue, ignore);
const simple = (text: string) => parse(text).items.map((i) => [i.ref, i.quantity]);

describe('parseOrderLocally', () => {
  it('reads Hinglish quantities, units and product names', () => {
    expect(simple('do kilo cheeni aur ek sabun')).toEqual([
      ['P1', 2],
      ['P2', 1],
    ]);
  });

  it('splits items without separators, the way speech recognition writes them', () => {
    expect(simple('dedh kilo cheeni teen maggi do lux sabun')).toEqual([
      ['P1', 1.5],
      ['P3', 3],
      ['P2', 2],
    ]);
  });

  it('understands Devanagari speech and local names', () => {
    expect(simple('दो किलो चीनी और तीन मैगी')).toEqual([
      ['P1', 2],
      ['P3', 3],
    ]);
  });

  it('converts grams and dozens into the product unit', () => {
    expect(simple('250 gram toor dal aur ek dozen ande')).toEqual([
      ['P4', 0.25],
      ['P5', 12],
    ]);
  });

  it('treats "de do" and a trailing "do" as "give", not as the number two', () => {
    expect(simple('bhaiya ek doodh de do')).toEqual([['P6', 1]]);
    expect(simple('chai patti do')).toEqual([['P7', 1]]);
  });

  it('ignores prices, filler words and the wake word', () => {
    expect(simple('hey ramu 50 rupaye ka ek maggi dena')).toEqual([['P3', 1]]);
    expect(parse('ramu do maggi', ['ramu']).items).toEqual([{ ref: 'P3', quantity: 2, heard: 'do maggi' }]);
  });

  it('defaults to 1 when no quantity is said and splits two products said together', () => {
    expect(simple('cheeni sabun')).toEqual([
      ['P1', 1],
      ['P2', 1],
    ]);
  });

  it('reports things that are not in the catalogue instead of guessing', () => {
    const order = parse('ek maggi aur do kilo basmati');
    expect(order.items.map((i) => i.ref)).toEqual(['P3']);
    expect(order.unmatched).toEqual(['basmati']);
  });

  it('accepts a quantity said after the product', () => {
    expect(simple('cheeni do kilo')).toEqual([['P1', 2]]);
  });
});

describe('detectIntent', () => {
  it.each([
    ['aaj ki bikri kitni hui', 'sales'],
    ['kaunsa stock khatam ho raha hai', 'restock'],
    ['Sharma ji ka udhaar kitna hai', 'udhaar'],
    ['cancel karo', 'clear'],
    ['namaste ramu', 'greeting'],
    ['do kilo cheeni', 'order'],
    ['आज की बिक्री', 'sales'],
  ])('"%s" -> %s', (text, intent) => {
    expect(detectIntent(text)).toBe(intent);
  });

  it('works out the period for a sales question', () => {
    expect(detectPeriod('kal ki bikri')).toBe('yesterday');
    expect(detectPeriod('is hafte ki sales')).toBe('last_7_days');
    expect(detectPeriod('aaj kitna becha')).toBe('today');
  });
});

describe('Marathi', () => {
  it('reads a Marathi order with Marathi product words', () => {
    expect(simple('मला दोन किलो साखर आणि तीन मॅगी द्या')).toEqual([
      ['P1', 2],
      ['P3', 3],
    ]);
    expect(simple('दीड किलो साखर आणि चहा')).toEqual([
      ['P1', 1.5],
      ['P7', 1],
    ]);
  });

  it.each([
    ['आजची विक्री किती झाली', 'sales'],
    ['काय काय संपत आलं आहे', 'restock'],
    ['उधारी किती बाकी आहे', 'udhaar'],
    ['बिल नको', 'clear'],
    ['नमस्कार रामू', 'greeting'],
  ])('"%s" -> %s', (text, intent) => {
    expect(detectIntent(text)).toBe(intent);
  });

  it('works out Marathi periods', () => {
    expect(detectPeriod('कालची विक्री')).toBe('yesterday');
    expect(detectPeriod('या आठवड्यात किती विकलं')).toBe('last_7_days');
  });
});
