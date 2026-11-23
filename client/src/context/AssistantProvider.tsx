import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { askAssistant, getAssistantStatus, type DraftInput } from '../api/assistant';
import { createBill } from '../api/bills';
import { ApiError } from '../api/client';
import { useSession } from '../hooks/useAuth';
import { findWake, isCancel, isConfirm, isPrintDecline, isPrintRequest, wakeVariants } from '../lib/intent';
import { formatPaise } from '../lib/money';
import { printBill } from '../lib/printer';
import { RECOGNITION_ERRORS, recognitionConstructor, type Recognition } from '../lib/recognition';
import { canSpeak, isDevanagari, speak, stopSpeaking } from '../lib/speech';
import type { AssistantDraft, AssistantTurn } from '../types/assistant';
import type { Bill } from '../types/bill';
import {
  AssistantContext,
  type AssistantContextValue,
  type AssistantMessage,
  type AssistantPhase,
  type AssistantSettings,
} from './assistant-context';

// "Hey Ramu": the always-on counter assistant.
//
// The loop:  standby (listen for "Ramu") -> listening (capture the request) -> thinking
// (server agent drafts the bill / answers) -> speaking (reply aloud) -> listening again for
// the shopkeeper's answer -> ... -> back to standby.
//
// The confirmation is deliberately NOT done by the AI: "haan" / "confirm" is recognised here,
// in plain code, and only then does the app call POST /bills, the same endpoint as the
// billing screen (Rule 2: a human confirms before anything touches stock or money).

const SETTINGS_KEY = 'billbol.assistant';
const DEFAULT_SETTINGS: AssistantSettings = { name: 'Ramu', lang: 'hi-IN', voiceReplies: true, voiceName: '', voiceNameMr: '', handsFree: false };

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

export function AssistantProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpenState] = useState(false);
  const [phase, setPhaseState] = useState<AssistantPhase>('off');
  const [live, setLive] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraftState] = useState<AssistantDraft | null>(null);
  const [settings, setSettings] = useState<AssistantSettings>(loadSettings);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const supported = useMemo(() => recognitionConstructor() !== undefined, []);

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
  };
  const setDraft = (d: AssistantDraft | null) => {
    draftRef.current = d;
    setDraftState(d);
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
      stopSpeaking();
      setPhase('off');
    }
  };

  // --- Microphone ---

  function stopRecognition(): void {
    stoppingRef.current = true;
    window.clearTimeout(silenceRef.current);
    recRef.current?.abort();
    recRef.current = null;
    setLive('');
  }

  // mode 'wake': wait for the wake word, then capture what follows it.
  // mode 'command': capture straight away (push-to-talk, or the reply to a question).
  function startRecognition(mode: 'wake' | 'command', followUp = false): void {
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
        stopSpeaking();
        chime();
        setPhase('listening');
        openRef.current = true;
        setOpenState(true);
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

  // What happens after Ramu finished a turn: keep the conversation going if he asked
  // something (and the shopkeeper is talking, not typing), otherwise go back to standby.
  function afterTurn(expectReply: boolean): void {
    if (expectReply && viaVoiceRef.current && supported) startRecognition('command', true);
    else if (settingsRef.current.handsFree && supported) startRecognition('wake');
    else setPhase('off');
  }

  // `spoken` is Devanagari (see lib/speech.ts): Marathi when the shop's speech language is
  // Marathi, Hindi otherwise. `fallback` is the screen text, spoken only if the browser has no
  // Hindi or Marathi voice at all.
  async function say(spoken: string, fallback?: string): Promise<void> {
    if (!settingsRef.current.voiceReplies || !canSpeak()) return;
    setPhase('speaking');
    const marathi = isMarathi();
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

    // The answer to "Print karoon?". Whatever is said next answers it: a yes prints, a no
    // skips, and anything else (a new order) drops the question and carries on as normal.
    const asked = askedToPrintRef.current;
    askedToPrintRef.current = null;
    if (asked) {
      if (isConfirm(text, ignore) || isPrintRequest(text, ignore)) return printFromVoice(asked);
      if (isCancel(text, ignore) || isPrintDecline(text, ignore)) {
        await reply('Theek hai, print nahi kiya.', 'ठीक है, प्रिंट नहीं किया।', 'ठीक आहे, प्रिंट केलं नाही.');
        return afterTurn(false);
      }
    }
    // "Bill print karo" later on, with no new order in progress: reprint the last bill.
    const noDraft = !draftRef.current || draftRef.current.items.length === 0;
    if (noDraft && lastBillRef.current && isPrintRequest(text, ignore)) return printFromVoice(lastBillRef.current);

    if (draftRef.current && draftRef.current.items.length > 0) {
      if (isConfirm(text, ignore)) return confirmDraft();
      if (isCancel(text, ignore)) {
        setDraft(null);
        await reply('Theek hai, bill cancel kar diya.', 'ठीक है, बिल रद्द कर दिया।', 'ठीक आहे, बिल रद्द केलं.');
        return afterTurn(false);
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
      addMessage({ role: 'ramu', text: res.reply, card: res.card, engine: res.engine });
      await say(res.speech || res.reply, res.reply);
      afterTurn(true);
    } catch (err) {
      await sayError(err instanceof ApiError ? err.message : 'Could not reach BillBol. Check the internet connection.');
      afterTurn(false);
    }
  }

  // The human said yes (by voice or by tapping Confirm): save through the normal bill API.
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
      setDraft(null);
      savedBillsRef.current.set(bill.id, bill);
      lastBillRef.current = bill;
      addMessage({ role: 'system', text: `Bill ${bill.number} saved · ${formatPaise(bill.totalPaise)}`, billId: bill.id });
      // Lets open pages (dashboard, bills list) refresh their numbers.
      window.dispatchEvent(new CustomEvent('billbol:bill-created', { detail: bill }));
      // The last step of a voice bill: offer the printout, and listen for the answer.
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
    if ('handsFree' in patch) {
      if (patch.handsFree && supported) {
        if (phaseRef.current === 'off') startRecognition('wake');
      } else if (!patch.handsFree && phaseRef.current === 'standby') {
        stopRecognition();
        setPhase('off');
      }
    }
    if ('lang' in patch && phaseRef.current === 'standby') startRecognition('wake');
  }

  // On load: is Claude set up? And resume hands-free mode if it was on (the browser allows it
  // without a click once microphone permission has been granted).
  useEffect(() => {
    let cancelled = false;
    getAssistantStatus()
      .then((s) => !cancelled && setAiEnabled(s.aiEnabled))
      .catch(() => !cancelled && setAiEnabled(false));
    if (settingsRef.current.handsFree && recognitionConstructor()) startRecognition('wake');
    return () => {
      cancelled = true;
      stoppingRef.current = true;
      recRef.current?.abort();
      stopSpeaking();
    };
    // Runs once on mount: startRecognition only reads refs, so a stale copy is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    aiEnabled,
    error,
    confirming,
    sendText(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      setOpen(true);
      stopRecognition();
      stopSpeaking();
      void handleUtterance(trimmed, false);
    },
    talk() {
      if (!supported) {
        setError('Voice works in Chrome or Edge. You can type instead.');
        return;
      }
      stopSpeaking();
      viaVoiceRef.current = true;
      openRef.current = true;
      setOpenState(true);
      startRecognition('command');
    },
    stopTalking() {
      // Ending the session makes onend process what was heard so far.
      recRef.current?.stop();
    },
    confirmDraft() {
      viaVoiceRef.current = false;
      void confirmDraft();
    },
    discardDraft() {
      setDraft(null);
      addMessage({ role: 'system', text: 'Draft cleared' });
    },
    editDraftInBilling() {
      const d = draftRef.current;
      setDraft(null);
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
