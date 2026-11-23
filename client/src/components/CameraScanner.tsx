import { useEffect, useRef, useState, type ReactNode } from 'react';
import { barcodeDetectorCtor } from '../lib/barcodeDetector';
import { Icon } from './Icon';

// Scanning with the phone's camera, for shops that have no scanner gun. Uses the browser's
// built-in BarcodeDetector (see lib/barcodeDetector.ts), so no scanning library is shipped.
// Where it is missing, the billing screen does not show the camera button.

// The barcode types printed on Indian retail packets, plus Code-128/39 for shop-made labels.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
// The same packet stays in front of the camera for a moment; count it once, not every frame.
const SAME_CODE_PAUSE_MS = 2000;

type Props = { onScan: (code: string) => void; onClose: () => void; status?: ReactNode };

export function CameraScanner({ onScan, onClose, status }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    const Ctor = barcodeDetectorCtor();
    if (!Ctor) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let last = { code: '', at: 0 };
    const detector = new Ctor({ formats: FORMATS });

    // About 5 checks a second: quick enough to feel instant, light on a cheap phone's battery.
    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      try {
        const [found] = await detector.detect(video);
        const now = Date.now();
        if (found && (found.rawValue !== last.code || now - last.at > SAME_CODE_PAUSE_MS)) {
          last = { code: found.rawValue, at: now };
          onScanRef.current(found.rawValue);
        }
      } catch {
        // A frame that could not be read; try the next one.
      }
      timer = window.setTimeout(tick, 200);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current!;
        video.srcObject = s;
        await video.play();
        void tick();
      })
      .catch(() => setError('Camera not available. Allow camera access for BillBol in the browser settings.'));

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="camera-scanner" role="dialog" aria-modal="true" aria-label="Scan barcode with camera">
      <div className="camera-box">
        <div className="camera-head">
          <strong>
            <Icon name="scan" size={18} /> Point the camera at a barcode
          </strong>
          <button type="button" className="icon-btn" aria-label="Close camera" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {error ? (
          <div className="form-alert" role="alert">
            {error}
          </div>
        ) : (
          <div className="camera-view">
            <video ref={videoRef} muted playsInline />
            <span className="camera-aim" aria-hidden="true" />
          </div>
        )}
        <div className="camera-status" aria-live="polite">
          {status ?? 'Keep scanning: every packet is added to the bill.'}
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
