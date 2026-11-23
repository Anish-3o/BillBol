import { useCallback, useEffect, useRef, useState } from 'react';
import { RECOGNITION_ERRORS, recognitionConstructor, type Recognition } from '../lib/recognition';

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
        setError(RECOGNITION_ERRORS[event.error] ?? 'Speech recognition failed. Try again, or type instead.');
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
