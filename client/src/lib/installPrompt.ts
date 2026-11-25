import { useSyncExternalStore } from 'react';

// "Install app" support. Chrome and Edge on Android and desktop fire `beforeinstallprompt` once
// the page qualifies as installable (manifest + service worker + HTTPS). We stop the browser's
// own mini-infobar and keep the event, so our own "Install app" button can show the real install
// dialog when the shopkeeper taps it. Safari (iPhone) has no such event: there it is
// Share -> "Add to Home Screen", which uses the apple-touch-icon in index.html.
//
// The listener is added when this module first loads (main.tsx imports it), not inside a React
// component: the event can fire before any component has mounted, and it is never sent again.

// Not yet in TypeScript's DOM types, because it is not a web standard (only Chromium has it).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  // Installed (from our button or the browser menu): the button has nothing left to do.
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Shows the browser's install dialog. The event can be used only once, whatever the answer.
async function install(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

// canInstall is true only while the browser is offering installation, so the button never shows
// in Safari, inside the already-installed app, or after the user has installed it.
export function useInstallPrompt(): { canInstall: boolean; install: () => Promise<boolean> } {
  const canInstall = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  return { canInstall, install };
}
