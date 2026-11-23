// Matching names across scripts: "सुरेश पाटील" (what Hindi/Marathi speech recognition writes)
// against "Suresh Patil" (how the customer was saved).
//
// Approach: romanise Devanagari letter by letter, then reduce both sides to a consonant
// "skeleton" (drop vowels and h, merge doubled letters). Spellings that differ only in vowels
// or aspiration end up identical: suresh / सुरेश -> "srs", patil / पाटील -> "ptl",
// kulkarni / कुलकर्णी -> "klkrn". Simple and explainable; good enough for a shop's few hundred
// regulars, where the name is also checked against the udhaar context.

const LETTERS: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऋ: 'ri', ऍ: 'e', ऑ: 'o',
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'f', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', ळ: 'l', व: 'v',
  श: 'sh', ष: 'sh', स: 's', ह: 'h',
  // vowel signs, nasal marks, virama, nukta
  // (quoted: these are combining marks, which cannot start an unquoted key)
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri',
  'ॅ': 'e', 'ॉ': 'o', 'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '', '़': '',
};

export function romanize(text: string): string {
  return Array.from(text.normalize('NFC'), (ch) => LETTERS[ch] ?? ch).join('');
}

// "Suresh" and "सुरेश" -> "srs". Empty for words with no consonants.
export function phoneticKey(word: string): string {
  return romanize(word.toLowerCase())
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/[^a-z]/g, '')
    .replace(/[aeiouh]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// True when two single words sound like the same name.
export function sameName(a: string, b: string): boolean {
  const ka = phoneticKey(a);
  return ka.length >= 2 && ka === phoneticKey(b);
}
