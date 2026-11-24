import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { askAssistant, getAssistantStatus, lookupCustomer, type DraftInput } from '../api/assistant';
import { createBill } from '../api/bills';
import { ApiError } from '../api/client';
import { createCustomer } from '../api/customers';
import { useSession } from '../hooks/useAuth';
import {
  canRecord,
  releaseMicrophone,
  speakNaturally,
  startRecording,
  stopNaturalSpeech,
  transcribe,
  type Recording,
} from '../lib/cloudVoice';
import {
  findWake,
  isBillComplete,
  isCancel,
  isConfirm,
  isNothingMore,
  isPrintDecline,
  isPrintRequest,
  isSkip,
  mentionsPrint,
  wakeVariants,
} from '../lib/intent';
import { formatPaise } from '../lib/money';
import { printBill } from '../lib/printer';
import { RECOGNITION_ERRORS, recognitionConstructor, type Recognition } from '../lib/recognition';
import { canSpeak, isDevanagari, speak, speakable, stopSpeaking } from '../lib/speech';
import type { AssistantDraft, AssistantTurn, VoiceEngine } from '../types/assistant';
import type { Bill } from '../types/bill';
import {
  AssistantContext,
  type AssistantContextValue,
  type AssistantMessage,
  type AssistantPhase,
  type AssistantSettings,
  type CheckoutStep,
} from './assistant-context';

// "Hey Ramu": the always-on counter assistant.
//
// The loop:  standby (listen for "Ramu") -> listening (capture the request) -> thinking
// (server agent drafts the bill / answers) -> speaking (reply aloud) -> listening again for
// the shopkeeper's answer -> ... -> back to standby.
//
// A voice bill ends like a real billing assistant:
//   items ("do kilo cheeni...", Ramu reads each item back: "Cheeni 2 kilo ₹92. Aur kuch?")
//   -> "bill complete" -> "Kuch aur?" -> "nahi" -> "Customer ka naam ya number?"
//   -> "Suresh Patil" -> "Suresh Patil, 3 items, kul ₹245. Bill banake print karun?"
//   -> "haan" -> the bill is saved and printed.
//
// That flow and the final "haan" are recognised here, in plain code, never by the AI. Only
// then does the app call POST /bills, the same endpoint as the billing screen (Rule 2: a
// human confirms before anything touches stock or money).

const SETTINGS_KEY = 'billbol.assistant';
const DEFAULT_SETTINGS: AssistantSettings = {
  name: 'Ramu',
  lang: 'hi-IN',
  voiceReplies: true,
  voiceName: '',
  voiceNameMr: '',
  handsFree: false,
  naturalVoice: true,
};

// A per-device convenience; storage may be unavailable (private mode), so failures are ignored.
function loadSettings(): AssistantSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<AssistantSettings>;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// A short rising "ding" when the wake word is heard, so the shopkeeper knows Ramu is listening
// without looking at the screen.
function chime(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    // no audio output: the screen still shows the state
  }
}

const toDraftInput = (d: AssistantDraft | null): DraftInput =>
  d && d.items.length > 0
    ? {
        items: d.items.map((i) => ({ productId: i.product.id, quantityMilli: i.quantityMilli })),
        paymentMode: d.paymentMode,
        customerId: d.customer?.id,
      }
    : null;

// How long a pause ends a request. Short after words were heard (people pause between items
// only briefly), longer while waiting for the first word.
const PAUSE_AFTER_WORDS_MS = 1500;
const WAIT_FOR_WORDS_MS = 7000;
const FOLLOW_UP_MS = 8000;
// Sarvam's quick speech API is meant for clips under 30 seconds.
const MAX_RECORDING_MS = 25_000;

// The customer for the bill being finished: an existing customer (id), or a new one to be
// created only after the shopkeeper's final yes.
type PendingCustomer = { id: string | null; name: string; phone: string | null };

export function AssistantProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpenState] = useState(false);
  const [phase, setPhaseState] = useState<AssistantPhase>('off');
  const [live, setLive] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraftState] = useState<AssistantDraft | null>(null);
  const [settings, setSettings] = useState<AssistantSettings>(loadSettings);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [serverVoice, setServerVoice] = useState<VoiceEngine>('browser');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStepState] = useState<CheckoutStep>('items');
  const recognitionSupported = recognitionConstructor() !== undefined;

  // The speech callbacks fire long after the render that created them, so everything they
  // read lives in refs (always current); state copies exist only to re-render the UI.
  const phaseRef = useRef<AssistantPhase>('off');
  const draftRef = useRef<AssistantDraft | null>(null);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const settingsRef = useRef(settings);
  const openRef = useRef(false);
  const recRef = useRef<Recognition | null>(null);
  const stoppingRef = useRef(false);
  const silenceRef = useRef<number | undefined>(undefined);
  const viaVoiceRef = useRef(false);
  const idRef = useRef(0);
  // Natural voice (Sarvam): what the server offers, the recording in progress, and a switch
  // that falls back to the browser's speech for the rest of the session if Sarvam fails.
  const serverVoiceRef = useRef<VoiceEngine>('browser');
  const recordingRef = useRef<Recording | null>(null);
  const captureIdRef = useRef(0);
  const cloudFailedRef = useRef(false);
  // Finishing a voice bill (see the comment at the top).
  const stepRef = useRef<CheckoutStep>('items');
  const pendingCustomerRef = useRef<PendingCustomer | null>(null);
  const pendingPhoneRef = useRef<string | null>(null); // a new number heard, name still needed
  // Printing: the bill Ramu just asked "Print karoon?" about (answered by the next thing the
  // shopkeeper says), and the bills saved in this conversation, for "Print" taps and
  // "pichhla bill print karo".
  const { tenant } = useSession();
  const tenantRef = useRef(tenant);
  const askedToPrintRef = useRef<Bill | null>(null);
  const savedBillsRef = useRef(new Map<string, Bill>());
  const lastBillRef = useRef<Bill | null>(null);
  useEffect(() => {
    tenantRef.current = tenant;
  }, [tenant]);

  const setPhase = (p: AssistantPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
    if (p === 'off') releaseMicrophone();
  };
  const setDraft = (d: AssistantDraft | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const setStep = (s: CheckoutStep) => {
    stepRef.current = s;
    setStepState(s);
    if (s === 'items') {
      pendingCustomerRef.current = null;
      pendingPhoneRef.current = null;
    }
  };
  const addMessage = (m: Omit<AssistantMessage, 'id'>) => {
    messagesRef.current = [...messagesRef.current, { ...m, id: ++idRef.current }];
    setMessages(messagesRef.current);
  };
  const setOpen = (value: boolean) => {
    openRef.current = value;
    setOpenState(value);
    // Closing the panel ends a conversation, unless hands-free mode keeps Ramu on standby.
    if (!value && !settingsRef.current.handsFree) {
      stopRecognition();
      hush();
      setPhase('off');
    }
  };

  // Natural voice is used when the server has Sarvam, the shopkeeper has not turned it off,
  // this browser can record, and Sarvam has not failed in this session.
  const naturalVoiceOn = () =>
    serverVoiceRef.current === 'sarvam' && settingsRef.current.naturalVoice && !cloudFailedRef.current;
  const recordsItself = () => naturalVoiceOn() && canRecord();

  // --- Microphone ---

  function stopRecognition(): void {
    stoppingRef.current = true;
    window.clearTimeout(silenceRef.current);
    recRef.current?.abort();
    recRef.current = null;
    captureIdRef.current++; // any recording that ends after this is ignored
    if (recordingRef.current) {
      recordingRef.current.cancel();
      recordingRef.current = null;
      // Free the microphone before the browser's wake-word listener may start again: on
      // Android, two users of the microphone at once fail.
      releaseMicrophone();
    }
    setLive('');
  }

  function hush(): void {
    stopSpeaking();
    stopNaturalSpeech();
  }

  // mode 'wake': wait for the wake word, then capture what follows it.
  // mode 'command': capture straight away (push-to-talk, or the reply to a question).
  function startRecognition(mode: 'wake' | 'command', followUp = false): void {
    if (mode === 'command' && recordsItself()) return listenWithRecorder(followUp);
    const Ctor = recognitionConstructor();
    if (!Ctor) return;
    stopRecognition();
    stoppingRef.current = false;

    const rec = new Ctor();
    rec.lang = settingsRef.current.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const variants = wakeVariants(settingsRef.current.name);
    let awake = mode === 'command';
    let offset = 0; // where the request starts in the heard text (just after the wake word)
    let heard = '';
    const request = () => heard.slice(offset).trim();

    const finish = () => {
      if (recRef.current !== rec) return;
      const text = request();
      stopRecognition();
      if (text) void handleUtterance(text, true);
      else afterTurn(false);
    };
    const armSilence = (ms: number) => {
      window.clearTimeout(silenceRef.current);
      silenceRef.current = window.setTimeout(finish, ms);
    };

    rec.onresult = (event) => {
      heard = Array.from(event.results, (r) => r[0].transcript).join(' ').replace(/\s+/g, ' ');
      if (!awake) {
        const end = findWake(heard, variants);
        if (end < 0) return;
        awake = true;
        offset = end;
        viaVoiceRef.current = true;
        hush();
        chime();
        openRef.current = true;
        setOpenState(true);
        // With natural voice, our own recorder takes over from here: the browser's
        // recognition stops first, so the two never hold the microphone at the same time.
        if (recordsItself()) return listenWithRecorder(false);
        setPhase('listening');
      }
      setLive(request());
      armSilence(request() ? PAUSE_AFTER_WORDS_MS : WAIT_FOR_WORDS_MS);
    };
    rec.onerror = (event) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        setError(RECOGNITION_ERRORS[event.error]);
        updateSettings({ handsFree: false });
        stopRecognition();
        setPhase('off');
      } else if (event.error === 'network') {
        setError(RECOGNITION_ERRORS.network);
      }
    };
    rec.onend = () => {
      if (recRef.current !== rec || stoppingRef.current) return;
      recRef.current = null;
      // The browser ended the session itself (it does after silence or about a minute).
      if (awake && request()) return finish();
      if (settingsRef.current.handsFree) window.setTimeout(() => startRecognition('wake'), 300);
      else setPhase('off');
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      return; // already running
    }
    setPhase(awake ? 'listening' : 'standby');
    if (awake) armSilence(followUp ? FOLLOW_UP_MS : WAIT_FOR_WORDS_MS);
  }

  // Natural voice: record until the shopkeeper pauses, then send the clip to Sarvam.
  function listenWithRecorder(followUp: boolean): void {
    stopRecognition();
    stoppingRef.current = false;
    const id = captureIdRef.current;
    setPhase('listening');
    startRecording({
      waitMs: followUp ? FOLLOW_UP_MS : WAIT_FOR_WORDS_MS,
      pauseMs: PAUSE_AFTER_WORDS_MS,
      maxMs: MAX_RECORDING_MS,
      onEnd: () => void finishRecording(id),
    }).then(
      (recording) => {
        if (captureIdRef.current === id) recordingRef.current = recording;
        else recording.cancel(); // stopped while the microphone was opening
      },
      () => {
        // Microphone blocked or recording unsupported: use the browser's recognition.
        if (captureIdRef.current !== id) return;
        cloudFailedRef.current = true;
        startRecognition('command', followUp);
      },
    );
  }

  async function finishRecording(id: number): Promise<void> {
    const recording = recordingRef.current;
    if (captureIdRef.current !== id || !recording) return;
    recordingRef.current = null;
    captureIdRef.current++;
    const { blob, heardSpeech } = await recording.stop();
    releaseMicrophone(); // same reason as in stopRecognition; reopening it takes a moment only
    // Nobody spoke: nothing is sent (and nothing is paid for).
    if (!blob || !heardSpeech) return afterTurn(false);
    setPhase('thinking');
    try {
      const text = await transcribe(blob, serverLanguage());
      if (text) return void handleUtterance(text, true);
      afterTurn(false);
    } catch (err) {
      // Sarvam is down or not set up correctly: carry on with the browser's speech.
      cloudFailedRef.current = true;
      await sayError(err instanceof ApiError ? err.message : 'Could not hear that. Please say it again.');
      afterTurn(true);
    }
  }

  // What happens after Ramu finished a turn: keep the conversation going if he asked
  // something (and the shopkeeper is talking, not typing), otherwise go back to standby.
  function afterTurn(expectReply: boolean): void {
    if (expectReply && viaVoiceRef.current && (recognitionSupported || recordsItself())) startRecognition('command', true);
    else if (settingsRef.current.handsFree && recognitionSupported) startRecognition('wake');
    else setPhase('off');
  }

  // `spoken` is Devanagari (see lib/speech.ts): Marathi when the shop's speech language is
  // Marathi, Hindi otherwise. `fallback` is the screen text, spoken only if the browser has no
  // Hindi or Marathi voice at all.
  async function say(spoken: string, fallback?: string): Promise<void> {
    if (!settingsRef.current.voiceReplies) return;
    const marathi = isMarathi();
    if (naturalVoiceOn()) {
      setPhase('speaking');
      try {
        return await speakNaturally(speakable(spoken, marathi ? 'mr' : 'hi'), marathi ? 'mr' : 'hi');
      } catch {
        // Autoplay blocked, offline, or Sarvam failed: the browser's voice says it instead.
      }
    }
    if (!canSpeak()) return;
    setPhase('speaking');
    const voiceName = (marathi ? settingsRef.current.voiceNameMr : settingsRef.current.voiceName) || undefined;
    await speak(spoken, { lang: marathi ? 'mr' : 'hi', voiceName, fallback });
  }

  // Ramu's own lines: shown in the shopkeeper's language, spoken in Hindi (or Marathi).
  async function reply(hinglish: string, hindi: string, marathi: string): Promise<void> {
    if (isMarathi()) {
      addMessage({ role: 'ramu', text: marathi });
      return say(marathi, hinglish);
    }
    addMessage({ role: 'ramu', text: isDevanagari(lastUserText()) ? hindi : hinglish });
    await say(hindi, hinglish);
  }

  // Server errors are in English for the screen; Ramu apologises in the shop's language.
  async function sayError(message: string): Promise<void> {
    addMessage({ role: 'ramu', text: message });
    await say(
      isMarathi() ? 'माफ करा, काहीतरी गडबड झाली. पुन्हा एकदा सांगा.' : 'माफ़ कीजिए, कुछ गड़बड़ हो गई। एक बार फिर बोलिए।',
      'Maaf kijiye, kuch gadbad ho gayi. Ek baar phir boliye.',
    );
  }

  const isMarathi = () => settingsRef.current.lang === 'mr-IN';
  // What the server should answer in: Marathi and Hindi share a script, so it is told.
  const serverLanguage = () => (isMarathi() ? 'mr' : settingsRef.current.lang === 'en-IN' ? 'en' : 'hi');

  const lastUserText = () => [...messagesRef.current].reverse().find((m) => m.role === 'user')?.text ?? '';
  const hasItems = () => Boolean(draftRef.current && draftRef.current.items.length > 0);

  // --- One turn of the conversation ---

  async function handleUtterance(text: string, viaVoice: boolean): Promise<void> {
    viaVoiceRef.current = viaVoice;
    setError(null);
    // The last few turns give the agent context for "aur do maggi"; older ones only cost tokens.
    const history: AssistantTurn[] = messagesRef.current
      .filter((m) => m.role !== 'system')
      .slice(-10)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, 1000) }));
    addMessage({ role: 'user', text });

    const ignore = wakeVariants(settingsRef.current.name);

    // The answer to "Print karoon?" (asked after a bill confirmed by tapping). Whatever is said
    // next answers it: a yes prints, a no skips, and anything else carries on as normal.
    const asked = askedToPrintRef.current;
    askedToPrintRef.current = null;
    if (asked) {
      if (isConfirm(text, ignore) || isPrintRequest(text, ignore)) return printFromVoice(asked);
      if (isCancel(text, ignore) || isPrintDecline(text, ignore)) {
        await reply('Theek hai, print nahi kiya.', 'ठीक है, प्रिंट नहीं किया।', 'ठीक आहे, प्रिंट केलं नाही.');
        return afterTurn(false);
      }
    }

    // Finishing a bill: each step answers the question Ramu just asked.
    if (hasItems()) {
      const s = stepRef.current;
      if (s === 'anythingElse') {
        if (isNothingMore(text, ignore)) return askForCustomer();
        setStep('items');
        if (isConfirm(text, ignore)) {
          await reply('Boliye, aur kya chahiye?', 'बोलिए, और क्या चाहिए?', 'सांगा, आणखी काय हवं?');
          return afterTurn(true);
        }
        // Anything else is more items: fall through to the agent.
      } else if (s === 'customer') {
        return handleCustomerAnswer(text, ignore);
      } else if (s === 'confirm') {
        if (isConfirm(text, ignore) || isPrintRequest(text, ignore)) return saveBill(true);
        if (isPrintDecline(text, ignore) && mentionsPrint(text, ignore)) return saveBill(false); // "print mat karo"
        setStep('items');
        if (isCancel(text, ignore)) {
          await reply(
            'Theek hai, abhi save nahi kiya. Kya badalna hai?',
            'ठीक है, अभी सेव नहीं किया। क्या बदलना है?',
            'ठीक आहे, अजून सेव्ह केलं नाही. काय बदलायचं?',
          );
          return afterTurn(true);
        }
        // Anything else is a change to the items: fall through to the agent.
      } else {
        if (isBillComplete(text, ignore)) {
          setStep('anythingElse');
          await reply('Kuch aur chahiye?', 'कुछ और चाहिए?', 'आणखी काही हवं का?');
          return afterTurn(true);
        }
        if (isCancel(text, ignore)) {
          setDraft(null);
          await reply('Theek hai, bill cancel kar diya.', 'ठीक है, बिल रद्द कर दिया।', 'ठीक आहे, बिल रद्द केलं.');
          return afterTurn(false);
        }
        // "Haan" here answers "Aur kuch?" (yes, more): invite the next item.
        if (isConfirm(text, ignore)) {
          await reply('Boliye, aur kya chahiye?', 'बोलिए, और क्या चाहिए?', 'सांगा, आणखी काय हवं?');
          return afterTurn(true);
        }
      }
    } else {
      setStep('items');
      // "Bill print karo" later on, with no new order in progress: reprint the last bill.
      if (lastBillRef.current && isPrintRequest(text, ignore)) return printFromVoice(lastBillRef.current);
      if (isBillComplete(text, ignore)) {
        await reply('Bill abhi khali hai. Items boliye.', 'बिल अभी खाली है। आइटम बोलिए।', 'बिल अजून रिकामं आहे. वस्तू सांगा.');
        return afterTurn(true);
      }
    }

    setPhase('thinking');
    try {
      const res = await askAssistant({
        message: text,
        history,
        draft: toDraftInput(draftRef.current),
        assistantName: settingsRef.current.name,
        language: serverLanguage(),
      });
      setDraft(res.draft && (res.draft.items.length > 0 || res.draft.unmatched.length > 0) ? res.draft : null);
      if (!hasItems()) setStep('items');
      addMessage({ role: 'ramu', text: res.reply, card: res.card, engine: res.engine });
      await say(res.speech || res.reply, res.reply);
      afterTurn(true);
    } catch (err) {
      await sayError(err instanceof ApiError ? err.message : 'Could not reach BillBol. Check the internet connection.');
      afterTurn(false);
    }
  }

  // "Customer ka naam ya number?" A customer already chosen for udhaar skips the question.
  async function askForCustomer(): Promise<void> {
    const d = draftRef.current!;
    if (d.customer) {
      pendingCustomerRef.current = { id: d.customer.id, name: d.customer.name, phone: null };
      return askToConfirm();
    }
    setStep('customer');
    await reply(
      "Customer ka naam ya mobile number boliye. Nahi chahiye to 'skip' boliye.",
      'ग्राहक का नाम या मोबाइल नंबर बताइए। ज़रूरत नहीं तो "छोड़ो" बोलिए।',
      'ग्राहकाचं नाव किंवा मोबाईल नंबर सांगा. नको असेल तर "नको" म्हणा.',
    );
    afterTurn(true);
  }

  async function handleCustomerAnswer(text: string, ignore: string[]): Promise<void> {
    const udhaar = draftRef.current?.paymentMode === 'udhaar';
    if (isSkip(text, ignore)) {
      if (udhaar) {
        await reply('Udhaar ke liye naam zaroori hai. Naam boliye.', 'उधार के लिए नाम ज़रूरी है। नाम बताइए।', 'उधारीसाठी नाव लागतं. नाव सांगा.');
        return afterTurn(true);
      }
      pendingCustomerRef.current = null;
      return askToConfirm();
    }
    setPhase('thinking');
    try {
      const found = await lookupCustomer(text);
      const phone = found.phone ?? pendingPhoneRef.current;
      if (found.customer) {
        pendingCustomerRef.current = { id: found.customer.id, name: found.customer.name, phone: found.customer.phone };
        return askToConfirm();
      }
      if (found.candidates.length > 1) {
        const names = found.candidates.slice(0, 3).map((c) => c.name).join(', ');
        await reply(`Kaun se? ${names}?`, `कौन से? ${names}?`, `कोणते? ${names}?`);
        return afterTurn(true);
      }
      if (found.name) {
        // Someone new: they are added as a customer only after the final yes.
        pendingCustomerRef.current = { id: null, name: found.name, phone };
        return askToConfirm();
      }
      if (phone) {
        pendingPhoneRef.current = phone;
        await reply('Naya number hai. Customer ka naam boliye.', 'नया नंबर है। ग्राहक का नाम बताइए।', 'नवीन नंबर आहे. ग्राहकाचं नाव सांगा.');
        return afterTurn(true);
      }
      await reply("Samjha nahi. Naam ya number boliye, ya 'skip'.", 'समझ नहीं आया। नाम या नंबर बताइए, या "छोड़ो"।', 'समजलं नाही. नाव किंवा नंबर सांगा, किंवा "नको".');
      afterTurn(true);
    } catch (err) {
      await sayError(err instanceof ApiError ? err.message : 'Could not look up the customer.');
      afterTurn(true);
    }
  }

  // Reads the whole bill back (total from the server's quote, never computed here) and asks
  // the one question that saves and prints it.
  async function askToConfirm(): Promise<void> {
    const d = draftRef.current!;
    setStep('confirm');
    const total = d.quote ? formatPaise(d.quote.totalPaise) : '';
    const n = d.items.length;
    const who = pendingCustomerRef.current?.name;
    await reply(
      `${who ? `${who}, ` : ''}${n} ${n === 1 ? 'item' : 'items'}, kul ${total}. Bill banake print karun?`,
      `${who ? `${who}, ` : ''}${n} आइटम, कुल ${total}। बिल बनाकर प्रिंट करूँ?`,
      `${who ? `${who}, ` : ''}${n} वस्तू, एकूण ${total}. बिल करून प्रिंट करू?`,
    );
    afterTurn(true);
  }

  // The final yes of a voice bill: add the customer if new, save, print.
  async function saveBill(print: boolean): Promise<void> {
    const d = draftRef.current;
    if (!d || d.items.length === 0 || confirming) return;
    stopRecognition();
    setConfirming(true);
    setPhase('thinking');
    try {
      let customerId = pendingCustomerRef.current?.id ?? d.customer?.id;
      const pending = pendingCustomerRef.current;
      if (!customerId && pending) {
        try {
          customerId = (await createCustomer({ name: pending.name, phone: pending.phone })).id;
        } catch {
          // e.g. the number belongs to someone else: save the bill without a customer rather
          // than lose the sale. Udhaar cannot do that, so it stops and says why.
          if (d.paymentMode === 'udhaar') throw new ApiError(400, `Could not add ${pending.name} as a customer.`);
        }
      }
      const { bill } = await createBill(
        d.items.map((i) => ({ productId: i.product.id, quantityMilli: i.quantityMilli })),
        d.paymentMode,
        customerId ?? undefined,
      );
      billSaved(bill);
      if (print) {
        printBill(bill, tenantRef.current);
        addMessage({ role: 'system', text: `Bill ${bill.number} sent to the printer`, billId: bill.id });
        await reply('Bill ban gaya, print ho raha hai. Dhanyavaad!', 'बिल बन गया, प्रिंट हो रहा है। धन्यवाद!', 'बिल झालं, प्रिंट होत आहे. धन्यवाद!');
      } else {
        await reply('Bill save ho gaya. Dhanyavaad!', 'बिल सेव हो गया। धन्यवाद!', 'बिल सेव्ह झालं. धन्यवाद!');
      }
      afterTurn(false);
    } catch (err) {
      setStep('items');
      await sayError(err instanceof ApiError ? err.message : 'Could not save the bill. Please try again.');
      afterTurn(true);
    } finally {
      setConfirming(false);
    }
  }

  function billSaved(bill: Bill): void {
    setDraft(null);
    setStep('items');
    savedBillsRef.current.set(bill.id, bill);
    lastBillRef.current = bill;
    addMessage({ role: 'system', text: `Bill ${bill.number} saved · ${formatPaise(bill.totalPaise)}`, billId: bill.id });
    // Lets open pages (dashboard, bills list) refresh their numbers.
    window.dispatchEvent(new CustomEvent('billbol:bill-created', { detail: bill }));
  }

  // The human tapped "Confirm bill": save through the normal bill API, then offer to print.
  async function confirmDraft(): Promise<void> {
    const d = draftRef.current;
    if (!d || d.items.length === 0 || confirming) return;
    if (d.paymentMode === 'udhaar' && !d.customer) {
      await reply('Udhaar ke liye customer ka naam boliye.', 'उधार के लिए ग्राहक का नाम बताइए।', 'उधारीसाठी ग्राहकाचं नाव सांगा.');
      return afterTurn(true);
    }
    stopRecognition();
    setConfirming(true);
    setPhase('thinking');
    try {
      const { bill } = await createBill(
        d.items.map((i) => ({ productId: i.product.id, quantityMilli: i.quantityMilli })),
        d.paymentMode,
        d.customer?.id,
      );
      billSaved(bill);
      const total = formatPaise(bill.totalPaise);
      askedToPrintRef.current = bill;
      await reply(`Bill ban gaya. Kul ${total}. Print karoon?`, `बिल बन गया। कुल ${total}। प्रिंट करूँ?`, `बिल झालं. एकूण ${total}. प्रिंट करू?`);
      afterTurn(true);
    } catch (err) {
      await sayError(err instanceof ApiError ? err.message : 'Could not save the bill. Please try again.');
      afterTurn(true);
    } finally {
      setConfirming(false);
    }
  }

  // Printing touches no stock or money, so a spoken "haan" is enough. The print starts first
  // (the frame loads in the background) and Ramu speaks while the printer works.
  async function printFromVoice(bill: Bill): Promise<void> {
    askedToPrintRef.current = null;
    printBill(bill, tenantRef.current);
    addMessage({ role: 'system', text: `Bill ${bill.number} sent to the printer`, billId: bill.id });
    await reply('Print ho raha hai. Dhanyavaad!', 'प्रिंट हो रहा है। धन्यवाद!', 'प्रिंट होत आहे. धन्यवाद!');
    afterTurn(false);
  }

  function updateSettings(patch: Partial<AssistantSettings>): void {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    if ('naturalVoice' in patch) cloudFailedRef.current = false; // let the shopkeeper retry
    if ('handsFree' in patch) {
      if (patch.handsFree && recognitionSupported) {
        if (phaseRef.current === 'off') startRecognition('wake');
      } else if (!patch.handsFree && phaseRef.current === 'standby') {
        stopRecognition();
        setPhase('off');
      }
    }
    if ('lang' in patch && phaseRef.current === 'standby') startRecognition('wake');
  }

  // On load: is Claude set up, and is natural voice? And resume hands-free mode if it was on
  // (the browser allows it without a click once microphone permission has been granted).
  useEffect(() => {
    let cancelled = false;
    getAssistantStatus()
      .then((s) => {
        if (cancelled) return;
        setAiEnabled(s.aiEnabled);
        serverVoiceRef.current = s.voice;
        setServerVoice(s.voice);
      })
      .catch(() => !cancelled && setAiEnabled(false));
    if (settingsRef.current.handsFree && recognitionConstructor()) startRecognition('wake');
    return () => {
      cancelled = true;
      stoppingRef.current = true;
      recRef.current?.abort();
      recordingRef.current?.cancel();
      hush();
      releaseMicrophone();
    };
    // Runs once on mount: startRecognition only reads refs, so a stale copy is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const naturalActive = serverVoice === 'sarvam' && settings.naturalVoice;
  const supported = recognitionSupported || (naturalActive && canRecord());

  const value: AssistantContextValue = {
    open,
    setOpen,
    phase,
    live,
    messages,
    draft,
    settings,
    updateSettings,
    supported,
    handsFreeSupported: recognitionSupported,
    voiceEngine: naturalActive ? 'sarvam' : 'browser',
    naturalVoiceAvailable: serverVoice === 'sarvam',
    step,
    aiEnabled,
    error,
    confirming,
    sendText(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      setOpen(true);
      stopRecognition();
      hush();
      void handleUtterance(trimmed, false);
    },
    talk() {
      if (!supported) {
        setError('Voice works in Chrome or Edge. You can type instead.');
        return;
      }
      hush();
      viaVoiceRef.current = true;
      openRef.current = true;
      setOpenState(true);
      startRecognition('command');
    },
    stopTalking() {
      // Ending now processes what was heard so far.
      if (recordingRef.current) void finishRecording(captureIdRef.current);
      else recRef.current?.stop();
    },
    confirmDraft() {
      viaVoiceRef.current = false;
      void confirmDraft();
    },
    discardDraft() {
      setDraft(null);
      setStep('items');
      addMessage({ role: 'system', text: 'Draft cleared' });
    },
    editDraftInBilling() {
      const d = draftRef.current;
      setDraft(null);
      setStep('items');
      setOpen(false);
      navigate('/bills/new', { state: { assistantDraft: d } });
    },
    printSavedBill(billId) {
      const bill = savedBillsRef.current.get(billId);
      if (!bill) return;
      // A tap answers "Print karoon?" too; the next thing said must not be read as the answer.
      askedToPrintRef.current = null;
      printBill(bill, tenantRef.current);
    },
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
