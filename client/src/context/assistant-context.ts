import { createContext } from 'react';
import type { AssistantCard, AssistantDraft, VoiceEngine } from '../types/assistant';

// off:       not listening at all
// standby:   hands-free mode, listening only for the wake word ("Hey Ramu")
// listening: capturing what the shopkeeper says
// thinking:  waiting for the server's answer
// speaking:  reading the answer aloud (the mic is off so Ramu does not hear himself)
export type AssistantPhase = 'off' | 'standby' | 'listening' | 'thinking' | 'speaking';

export type AssistantMessage = {
  id: number;
  role: 'user' | 'ramu' | 'system';
  text: string;
  card?: AssistantCard | null;
  engine?: 'claude' | 'local';
  billId?: string;
};

export type AssistantSettings = {
  name: string; // the wake word
  lang: string; // speech recognition language: hi-IN, en-IN, mr-IN
  voiceReplies: boolean;
  voiceName: string; // chosen Hindi voice; '' = the most natural one available
  voiceNameMr: string; // chosen Marathi voice, used when lang is mr-IN
  handsFree: boolean; // listen for the wake word all the time
  naturalVoice: boolean; // use Sarvam's voice when the server has it (off = browser speech)
};

// Where a voice bill is, once the shopkeeper says "bill complete":
// items         adding items (the normal state)
// anythingElse  Ramu asked "Kuch aur?"
// customer      Ramu asked for the customer's name or number
// confirm       Ramu read the total and asked "Bill banake print karun?"
export type CheckoutStep = 'items' | 'anythingElse' | 'customer' | 'confirm';

export type AssistantContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  phase: AssistantPhase;
  live: string; // words heard so far, shown while listening
  messages: AssistantMessage[];
  draft: AssistantDraft | null;
  settings: AssistantSettings;
  updateSettings: (patch: Partial<AssistantSettings>) => void;
  supported: boolean; // can listen at all (browser recognition, or recording for Sarvam)
  handsFreeSupported: boolean; // the wake word needs the browser's speech recognition
  voiceEngine: VoiceEngine; // what is actually used for speech right now
  naturalVoiceAvailable: boolean; // the server has Sarvam set up
  step: CheckoutStep;
  aiEnabled: boolean | null;
  error: string | null;
  confirming: boolean;
  sendText: (text: string) => void;
  talk: () => void; // push-to-talk: listen now, no wake word needed
  stopTalking: () => void;
  confirmDraft: () => void;
  discardDraft: () => void;
  editDraftInBilling: () => void;
  printSavedBill: (billId: string) => void; // a bill saved in this conversation
};

export const AssistantContext = createContext<AssistantContextValue | null>(null);

// The status line under Ramu's name.
export function phaseLabel(phase: AssistantPhase, name: string): string {
  switch (phase) {
    case 'standby':
      return `Say "Hey ${name}" anytime`;
    case 'listening':
      return 'Listening…';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking…';
    default:
      return 'Tap the mic or type';
  }
}
