import { useState, type FormEvent } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { Icon } from './Icon';

const LANGUAGES = [
  { code: 'hi-IN', label: 'हिंदी / Hinglish' },
  { code: 'mr-IN', label: 'मराठी' },
  { code: 'en-IN', label: 'English' },
] as const;

const LANGUAGE_KEY = 'billbol.voiceLanguage';

// Remembering the language is a per-device convenience; storage can be unavailable
// (private mode), so every access is wrapped and falls back to Hindi.
function savedLanguage(): string {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (LANGUAGES.some((l) => l.code === saved)) return saved!;
  } catch {
    // ignore
  }
  return 'hi-IN';
}

type Props = {
  // Called with what was heard (or typed). The parent turns it into draft cart lines.
  onTranscript: (text: string) => void;
  busy: boolean;
};

export function VoiceInput({ onTranscript, busy }: Props) {
  const [language, setLanguage] = useState(savedLanguage);
  const [typed, setTyped] = useState('');
  const speech = useSpeechRecognition(onTranscript);

  function changeLanguage(code: string) {
    setLanguage(code);
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch {
      // ignore
    }
  }

  function submitTyped(e: FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    onTranscript(text);
    setTyped('');
  }

  return (
    <section className="voice-card" aria-label="Voice order">
      <div className="voice-row">
        {speech.supported && (
          <button
            type="button"
            className={speech.listening ? 'mic mic-on' : 'mic'}
            onClick={speech.listening ? speech.stop : () => speech.start(language)}
            disabled={busy}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? 'Done speaking' : 'Speak the order'}
          >
            <Icon name={speech.listening ? 'stop' : 'mic'} size={28} />
          </button>
        )}
        <div className="voice-copy">
          <strong>{speech.listening ? 'Listening… tap when done' : busy ? 'Understanding the order…' : 'Speak the order'}</strong>
          <span>
            {speech.supported
              ? 'e.g. "do kilo cheeni, ek Tata namak aur teen Maggi"'
              : 'Voice works in Chrome or Edge. Type the order below.'}
          </span>
        </div>
        <select
          className="voice-lang"
          aria-label="Language the customer speaks"
          value={language}
          onChange={(e) => changeLanguage(e.target.value)}
          disabled={speech.listening}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {speech.listening && (
        <p className="voice-live" aria-live="polite">
          {speech.interim || '…'}
        </p>
      )}
      {speech.error && <p className="field-error">{speech.error}</p>}

      {/* Also the fallback for browsers without speech recognition, and handy for demos. */}
      <details className="voice-type" open={!speech.supported || undefined}>
        <summary>Type the order instead</summary>
        <form onSubmit={submitTyped}>
          <input
            aria-label="Order in words"
            placeholder="e.g. do kilo cheeni aur ek sabun"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={500}
          />
          <button type="submit" className="btn btn-light" disabled={busy || !typed.trim()}>
            Add
          </button>
        </form>
      </details>
    </section>
  );
}
