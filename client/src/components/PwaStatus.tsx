import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Icon } from './Icon';

const HOUR = 60 * 60 * 1000;

// App-wide notices for the installable app (PWA): "new version ready" and "you are offline".
// Mounted once in App.tsx, so they show on every page.
export function PwaStatus() {
  return (
    <>
      <OfflineBanner />
      <UpdateToast />
    </>
  );
}

// The service worker (made by vite-plugin-pwa, see vite.config.ts) downloads a new version in the
// background after each deploy, then waits. We ask before switching, because switching reloads
// the page, and a reload in the middle of a bill would lose the cart.
function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // A shop keeps the app open all day, so it would never "visit again" to notice an update.
    // Check once an hour instead.
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), HOUR);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="toast pwa-toast" role="status">
      <Icon name="refresh" size={18} />
      <span>A new version of BillBol is ready.</span>
      <button type="button" className="btn btn-accent btn-sm" onClick={() => void updateServiceWorker(true)}>
        Update
      </button>
      <button type="button" className="icon-btn pwa-toast-close" onClick={() => setNeedRefresh(false)} aria-label="Later">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

// The app itself opens without internet (its files are cached), but bills, stock and udhaar live
// on the server. Saying so plainly is better than buttons that fail with a vague error.
function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="alert">
      <Icon name="wifiOff" size={16} />
      <span>
        <strong>No internet.</strong> Bills cannot be saved until you are back online. BillBol carries on by itself.
      </span>
    </div>
  );
}

// navigator.onLine is "false" only when the device has no network at all; a connected phone with
// a dead connection still says true. Good enough for a hint; the API errors cover the rest.
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
