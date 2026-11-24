// Text-to-speech for Ramu's replies, using the voices built into the browser and the OS.
// No audio leaves the device and nothing is paid for.
//
// Everything is spoken with a HINDI or MARATHI voice: the server sends a Devanagari version of
// each reply for speaking, so even when the screen shows Hinglish ("Kul ₹162. Confirm karun?"),
// Ramu says "कुल 162 रुपये। कन्फ़र्म करूँ?" with Indian pronunciation, not an English accent.

export type SpeechLang = 'hi' | 'mr';

export const isDevanagari = (text: string) => /\p{Script=Devanagari}/u.test(text);

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// Most human-sounding first. Microsoft's "Online (Natural)" neural voices (built into Edge)
// sound like a real person: Madhur/Swara for Hindi, Manohar/Aarohi for Marathi. Google's
// voices in Chrome are good; the older offline Windows voices are robotic, so they come last.
const RANKING: RegExp[] = [
  /(madhur|manohar).*natural/i, // male voices, to fit "Ramu"
  /(swara|aarohi).*natural/i,
  /(microsoft|online).*(natural)/i,
  /google/i,
  /microsoft/i,
];

export function voicesFor(lang: SpeechLang): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  const rank = (v: SpeechSynthesisVoice) => {
    const i = RANKING.findIndex((re) => re.test(v.name));
    return i < 0 ? RANKING.length : i;
  };
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// Chrome loads voices asynchronously: the list is empty until "voiceschanged" fires.
export function onVoicesChanged(callback: () => void): () => void {
  if (!canSpeak()) return () => {};
  window.speechSynthesis.addEventListener('voiceschanged', callback);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', callback);
}

// Turns text into what should be SAID: "₹162" -> "162 रुपये", "70g" -> "70 ग्राम", and drops
// brackets ("Sugar (loose)" -> "Sugar loose"). An Indian voice reads the numbers itself.
export function speakable(text: string, lang: SpeechLang | 'en'): string {
  const rupees = lang === 'mr' ? 'रुपये' : lang === 'hi' ? 'रुपये' : 'rupaye';
  let s = text.replace(/₹\s?([\d,]+(?:\.\d+)?)/g, (_, n: string) => `${n.replace(/,/g, '')} ${rupees}`);
  if (lang !== 'en') {
    s = s
      .replace(/(\d)\s?kg\b/gi, '$1 किलो')
      .replace(/(\d)\s?g\b/gi, '$1 ग्राम')
      .replace(/(\d)\s?ml\b/gi, '$1 एम एल')
      .replace(/(\d)\s?l\b/gi, '$1 लीटर');
  }
  return s.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

type SpeakOptions = {
  lang?: SpeechLang; // the language of `text`
  voiceName?: string; // a voice the shopkeeper picked; otherwise the best available
  // The Hinglish screen text, spoken by an Indian-English voice only when the browser has no
  // Hindi or Marathi voice at all: an English voice cannot read Devanagari.
  fallback?: string;
};

// Picks the voice: the chosen one, else the best for the language. Marathi text can be read by
// a Hindi voice (same script, close pronunciation) when no Marathi voice is installed.
function chooseVoice(lang: SpeechLang, voiceName?: string): SpeechSynthesisVoice | undefined {
  const own = voicesFor(lang);
  const all = lang === 'mr' ? [...own, ...voicesFor('hi')] : own;
  return all.find((v) => v.name === voiceName) ?? all[0];
}

// Resolves when speaking ends (or fails), so the caller can listen again afterwards:
// listening while speaking would make the assistant hear itself.
export function speak(text: string, { lang = 'hi', voiceName, fallback }: SpeakOptions = {}): Promise<void> {
  if (!canSpeak() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const voice = chooseVoice(lang, voiceName);
    const useEnglish = !voice && Boolean(fallback);
    const utterance = new SpeechSynthesisUtterance(useEnglish ? speakable(fallback!, 'en') : speakable(text, lang));
    const english = useEnglish ? window.speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-') === 'en-IN') : undefined;
    const picked = voice ?? english;
    utterance.lang = picked?.lang ?? (useEnglish ? 'en-IN' : `${lang}-IN`);
    if (picked) utterance.voice = picked;
    // A touch slower than default sounds calmer and clearer in Hindi and Marathi.
    utterance.rate = 0.95;
    // Chrome sometimes never fires onend for long text; a timeout guarantees we move on.
    const guard = window.setTimeout(resolve, 3000 + text.length * 100);
    const done = () => {
      window.clearTimeout(guard);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

// Ask once early so the voice list is ready by the first reply.
if (canSpeak()) window.speechSynthesis.getVoices();
