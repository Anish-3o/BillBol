import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API is not in TypeScript's DOM library (it is still non-standard and
// prefixed in Chrome), so we declare just the parts we use.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone for this site, then try again.',
  'service-not-allowed': 'Microphone access is blocked. Allow the microphone for this site, then try again.',
  'no-speech': "Didn't hear anything. Tap the mic and speak again.",
  'audio-capture': 'No microphone was found on this device.',
  network: 'Speech recognition needs an internet connection.',
  'language-not-supported': 'This browser cannot recognise that language. Pick another, or type instead.',
};

// Speech to text in the browser (Chrome and Edge). The audio goes to the browser's own speech
// service, not to our server; our server only ever receives the resulting text.
export function useSpeechRecognition(onFinal: (text: string) => void) {
  const [supported] = useState(() => recognitionConstructor() !== undefined);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  // Keep the latest callback without restarting recognition when the parent re-renders.
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const start = useCallback((lang: string) => {
    const Ctor = recognitionConstructor();
    if (!Ctor) return;
    recognitionRef.current?.abort();

    const recognition = new Ctor();
    recognition.lang = lang; // 'hi-IN', 'mr-IN', 'en-IN'
    recognition.interimResults = true; // show words as they are recognised
    // Continuous: customers pause between items ("do kilo cheeni... aur ek sabun").
    // The shopkeeper taps Stop when the customer is done.
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    let heard = '';
    recognition.onresult = (event) => {
      heard = Array.from(event.results, (r) => r[0].transcript).join(' ');
      setInterim(heard);
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        setError(ERROR_MESSAGES[event.error] ?? 'Speech recognition failed. Try again, or type instead.');
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const text = heard.replace(/\s+/g, ' ').trim();
      if (text) onFinalRef.current(text);
    };

    setError(null);
    setInterim('');
    setListening(true);
    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  // Stop the microphone if the page is left while listening.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, listening, interim, error, start, stop };
}
