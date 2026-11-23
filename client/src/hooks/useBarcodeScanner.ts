import { useEffect, useRef } from 'react';

// Works with any USB or Bluetooth barcode scanner, with no driver and no pairing code.
//
// Almost every scanner sold (TVS, Honeywell, Zebra, the ₹1,500 no-name guns) defaults to
// "keyboard mode" (HID keyboard wedge): to the computer it is a keyboard that types the code
// and presses Enter. So there is nothing to connect to. We listen to the keyboard and tell a
// scanner from a person by speed: a scanner types each character 5-30 ms apart, while even a
// fast typist needs about 100 ms. A burst of 4+ characters, all close together and ending in
// Enter (or Tab, or a pause, depending on how the scanner is configured), is a scan.

const MAX_GAP_MS = 50; // longest pause between two characters of one scan
const MIN_LENGTH = 4; // shortest code we accept (EAN-8 is 8; shop labels can be shorter)
const MIN_LENGTH_NO_SUFFIX = 8; // stricter when there is no Enter to confirm the burst
const IDLE_END_MS = 100; // scanners set to send no Enter: the burst simply stops
const SUFFIX_GRACE_MS = 300; // an Enter that arrives just after an idle-ended scan

type Editable = HTMLInputElement | HTMLTextAreaElement;

const isEditable = (el: EventTarget | null): el is Editable =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type));

// The scanner's characters land in whatever box has focus (the search box, a quantity) before
// we know they are a scan. Put the box back as it was. React tracks input values itself, so
// the value is set through the native setter and an 'input' event tells React about it.
function restore(el: Editable, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  // The latest callback, without re-attaching the keyboard listener on every render.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastAt = 0;
    let target: Editable | null = null;
    let valueBefore = '';
    let idleTimer: number | undefined;
    let scannedAt = 0;

    const reset = () => {
      buffer = '';
      target = null;
      window.clearTimeout(idleTimer);
    };

    const emit = () => {
      const code = buffer;
      if (target) restore(target, valueBefore);
      reset();
      scannedAt = performance.now();
      onScanRef.current(code);
    };

    // Capture phase on window: runs before React's handlers, so the scanner's Enter can be
    // stopped before it "presses" a focused button (e.g. Confirm) or the search box's Enter.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      const now = performance.now();

      if (e.key === 'Enter' || e.key === 'Tab') {
        const fresh = now - lastAt <= MAX_GAP_MS * 2;
        if (buffer.length >= MIN_LENGTH && fresh) {
          e.preventDefault();
          e.stopPropagation();
          emit();
        } else if (now - scannedAt < SUFFIX_GRACE_MS) {
          // The suffix of a scan we already handled on the idle timer.
          e.preventDefault();
          e.stopPropagation();
        } else {
          reset();
        }
        return;
      }

      if (e.key.length !== 1) return; // Shift, arrows, F-keys...
      if (now - lastAt > MAX_GAP_MS) {
        // Too slow to be the same scan: start a new burst here.
        reset();
        target = isEditable(e.target) ? e.target : null;
        valueBefore = target?.value ?? '';
      }
      buffer += e.key;
      lastAt = now;

      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (buffer.length >= MIN_LENGTH_NO_SUFFIX) emit();
        else reset();
      }, IDLE_END_MS);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.clearTimeout(idleTimer);
    };
  }, [enabled]);
}
