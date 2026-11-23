// The Web Speech API is not in TypeScript's DOM library (it is still non-standard and
// prefixed in Chrome), so we declare just the parts we use. Shared by the billing screen's
// mic and the "Hey Ramu" assistant.
export type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
export type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
export type RecognitionErrorEvent = { error: string };
export interface Recognition {
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
export type RecognitionConstructor = new () => Recognition;

export function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone for this site, then try again.',
  'service-not-allowed': 'Microphone access is blocked. Allow the microphone for this site, then try again.',
  'no-speech': "Didn't hear anything. Tap the mic and speak again.",
  'audio-capture': 'No microphone was found on this device.',
  network: 'Speech recognition needs an internet connection.',
  'language-not-supported': 'This browser cannot recognise that language. Pick another, or type instead.',
};
