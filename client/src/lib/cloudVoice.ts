import { apiFetch } from '../api/client';

// Natural voice through the server (Sarvam AI), used when the server has a Sarvam key.
//
// Listening: we record the microphone ourselves and send the clip to /api/voice/transcribe,
// which is far more accurate for Hindi, Marathi and Hinglish than the browser's recognition.
// The browser's recognition is still used for the wake word ("Hey Ramu"), but never at the
// same time as this recorder: on Android, two users of the microphone at once fail.
//
// Speaking: /api/voice/speak returns MP3 of a natural Indian voice, played with <audio>.
// Every function here throws on failure, and the caller falls back to the browser's speech.

export type CloudLang = 'hi' | 'mr' | 'en';

export const canRecord = (): boolean =>
  typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia);

// --- Microphone -------------------------------------------------------------------------

// Opened once and reused, so each turn starts instantly and the browser does not ask again.
let stream: MediaStream | null = null;

async function microphone(): Promise<MediaStream> {
  if (stream?.active) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    // The browser's own cleanup helps a lot at a noisy counter.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  return stream;
}

// Turns the microphone off (and the browser's red "recording" dot with it).
export function releaseMicrophone(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function recorderType(): string | undefined {
  // Chrome/Edge/Firefox record WebM/Opus; Safari records MP4/AAC. Sarvam accepts all of them.
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
}

export type Recording = {
  // Stops and returns the clip, and whether anyone actually spoke (no speech = nothing to send).
  stop: () => Promise<{ blob: Blob | null; heardSpeech: boolean }>;
  cancel: () => void;
};

type RecordOptions = {
  waitMs: number; // give up if nobody starts speaking within this time
  pauseMs: number; // after speech, this much silence ends the turn
  maxMs: number; // hard limit (the quick speech API is meant for clips under 30 s)
  onEnd: () => void; // silence or limit reached: the caller should stop() now
};

// Records until the speaker pauses. "Pause" is measured from the loudness of the signal:
// the first moments set the background noise level, and speech is anything clearly above it.
// That adapts to a quiet home and to a busy shop.
export async function startRecording(opts: RecordOptions): Promise<Recording> {
  const mic = await microphone();
  const type = recorderType();
  const recorder = new MediaRecorder(mic, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(mic).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const started = performance.now();
  let noise = 0.01;
  let heardSpeech = false;
  let lastVoice = started;
  let ended = false;

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    const now = performance.now();
    if (now - started < 300) noise = Math.max(noise, rms); // calibrate on the first 300 ms
    else if (rms < noise) noise = noise * 0.95 + rms * 0.05; // follow the room getting quieter
    if (rms > Math.max(0.02, noise * 2.5)) {
      heardSpeech = true;
      lastVoice = now;
    }
    const done = heardSpeech ? now - lastVoice > opts.pauseMs : now - started > opts.waitMs;
    if (!ended && (done || now - started > opts.maxMs)) {
      ended = true;
      opts.onEnd();
    }
  }, 100);

  const cleanUp = () => {
    window.clearInterval(timer);
    void ctx.close();
  };
  recorder.start();

  return {
    stop: () =>
      new Promise((resolve) => {
        cleanUp();
        if (recorder.state === 'inactive') return resolve({ blob: null, heardSpeech });
        recorder.onstop = () =>
          resolve({ blob: chunks.length ? new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }) : null, heardSpeech });
        recorder.stop();
      }),
    cancel: () => {
      cleanUp();
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}

export async function transcribe(blob: Blob, lang: CloudLang): Promise<string> {
  const res = await apiFetch(`/voice/transcribe?lang=${lang}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });
  return ((await res.json()) as { transcript: string }).transcript;
}

// --- Speaking ---------------------------------------------------------------------------

// Ramu repeats himself a lot ("Aur kuch?"): keep recent audio so those play instantly and
// are not paid for twice.
const cache = new Map<string, string>(); // "hi|text" -> object URL of the MP3
const CACHE_SIZE = 40;
let playing: HTMLAudioElement | null = null;

async function audioUrl(text: string, lang: CloudLang): Promise<string> {
  const key = `${lang}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await apiFetch('/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
  });
  const url = URL.createObjectURL(await res.blob());
  cache.set(key, url);
  if (cache.size > CACHE_SIZE) {
    const [oldKey, oldUrl] = cache.entries().next().value!;
    URL.revokeObjectURL(oldUrl);
    cache.delete(oldKey);
  }
  return url;
}

// Resolves when the sentence has been spoken (or was stopped), so the caller can listen next.
export async function speakNaturally(text: string, lang: CloudLang): Promise<void> {
  const url = await audioUrl(text, lang);
  stopNaturalSpeech();
  const audio = new Audio(url);
  playing = audio;
  await new Promise<void>((resolve, reject) => {
    // In case "ended" never fires (a stalled stream), move on after a generous limit.
    const guard = window.setTimeout(resolve, 3000 + text.length * 150);
    const done = () => {
      window.clearTimeout(guard);
      resolve();
    };
    audio.onended = done;
    audio.onpause = done; // stopNaturalSpeech() pauses it
    audio.onerror = () => {
      window.clearTimeout(guard);
      reject(new Error('Could not play the voice'));
    };
    audio.play().catch((err: unknown) => {
      window.clearTimeout(guard);
      reject(err);
    });
  });
}

export function stopNaturalSpeech(): void {
  playing?.pause();
  playing = null;
}
