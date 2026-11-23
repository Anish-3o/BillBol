// The browser's built-in BarcodeDetector (Chrome and Edge on Android, Safari 17+ on iOS,
// Chrome on Mac). Not in TypeScript's DOM types yet, hence the small local types.

export type DetectedBarcode = { rawValue: string };
export type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export const barcodeDetectorCtor = () =>
  (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

export const cameraScanSupported = () =>
  typeof window !== 'undefined' && barcodeDetectorCtor() !== undefined && !!navigator.mediaDevices?.getUserMedia;
