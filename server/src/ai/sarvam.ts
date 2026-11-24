import { env } from '../config/env';
import { AppError } from '../utils/AppError';

// Sarvam AI: speech-to-text and text-to-speech built for Indian languages.
//
// Why not the browser's own speech? Chrome's recognition is free but weak on Marathi, on
// Hinglish (Hindi and English mixed in one sentence) and on brand names, and its Hindi or
// Marathi voices are missing or robotic on many devices. Sarvam's models are trained on Indian
// speech, accept a list of "key terms" (we send the shop's product names), and speak with
// natural Indian voices. The key stays on the server (Rule 5); the browser only sends audio
// to our API and gets text or audio back.
//
// Plain fetch instead of an SDK: two small JSON/multipart calls, documented at docs.sarvam.ai.

const BASE_URL = 'https://api.sarvam.ai';
const STT_MODEL = 'saaras:v4';
const TTS_MODEL = 'bulbul:v3';
// A customer is waiting: fail fast and let the app fall back to the browser's speech.
const TIMEOUT_MS = 15_000;
// Sarvam's limits for key terms: at most 50, each at most 64 characters.
const MAX_KEYTERMS = 50;
const MAX_KEYTERM_LENGTH = 64;

export type VoiceLanguage = 'hi' | 'mr' | 'en';
const LANGUAGE_CODES: Record<VoiceLanguage, string> = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };

export const isSarvamConfigured = (): boolean => Boolean(env.SARVAM_API_KEY);

function apiKey(): string {
  if (!env.SARVAM_API_KEY) throw new AppError(503, 'Natural voice is not set up: add SARVAM_API_KEY to server/.env');
  return env.SARVAM_API_KEY;
}

// The file name only tells Sarvam the container format; it detects the codec itself.
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

export async function transcribe(args: {
  audio: Buffer;
  mimeType: string;
  language: VoiceLanguage;
  keyterms?: string[];
}): Promise<string> {
  const mime = args.mimeType.split(';')[0].trim().toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(args.audio)], { type: mime }), `speech.${EXTENSIONS[mime] ?? 'webm'}`);
  form.append('model', STT_MODEL);
  // The shop's language is known, so it is sent rather than auto-detected: Hindi and Marathi
  // sound alike, and a wrong guess would garble the whole order.
  form.append('language_code', LANGUAGE_CODES[args.language]);
  const keyterms = (args.keyterms ?? []).map((t) => t.slice(0, MAX_KEYTERM_LENGTH)).slice(0, MAX_KEYTERMS);
  if (keyterms.length > 0) form.append('keyterms', JSON.stringify(keyterms));

  const data = (await call('/speech-to-text', { method: 'POST', body: form })) as { transcript?: string };
  return (data.transcript ?? '').trim();
}

// Returns MP3 audio: much smaller than WAV, so it reaches a phone on mobile data quickly.
export async function synthesize(text: string, language: VoiceLanguage): Promise<Buffer> {
  const data = (await call('/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      language_code: LANGUAGE_CODES[language],
      model: TTS_MODEL,
      speaker: env.SARVAM_SPEAKER,
      // Reads "₹245" and English words the way an Indian speaker would.
      enable_preprocessing: true,
      speech_sample_rate: 24000,
      output_audio_codec: 'mp3',
    }),
  })) as { audios?: string[] };
  if (!data.audios?.length) throw new AppError(502, 'The voice service returned no audio.');
  return Buffer.concat(data.audios.map((a) => Buffer.from(a, 'base64')));
}

// Turns Sarvam's errors into messages the shopkeeper (or developer) can act on.
async function call(path: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), 'api-subscription-key': apiKey() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(503, 'Could not reach the voice service. Check the internet connection.');
  }
  if (res.ok) return res.json();

  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  console.error(`Sarvam ${path} failed (${res.status}):`, body?.error?.message ?? 'no details');
  if (res.status === 401 || res.status === 403) {
    throw new AppError(503, 'The voice service is not set up correctly. Check SARVAM_API_KEY.');
  }
  if (res.status === 429) throw new AppError(503, 'The voice service is busy. Try again in a moment.');
  throw new AppError(502, 'The voice service had a problem. Please try again.');
}

// "Aashirvaad Atta 5kg" -> "Aashirvaad Atta", "Sugar (loose)" -> "Sugar": the words a
// customer actually says, without sizes and notes the speech model would not hear.
export function keytermsFor(productNames: string[]): string[] {
  const terms = productNames
    .map((n) => n.replace(/\([^)]*\)/g, ' ').replace(/\b\d+(\.\d+)?\s*(kg|g|gm|ml|l|ltr)\b/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 2);
  return [...new Set(terms)].slice(0, MAX_KEYTERMS);
}
