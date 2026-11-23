import { useState } from 'react';
import { loadPrinterSettings, savePrinterSettings, type PrinterSettings } from '../lib/printer';

// This counter's printer settings, remembered on this device (see lib/printer.ts).
export function usePrinterSettings(): [PrinterSettings, (patch: Partial<PrinterSettings>) => void] {
  const [settings, setSettings] = useState(loadPrinterSettings);
  const update = (patch: Partial<PrinterSettings>) => {
    const next = { ...settings, ...patch };
    savePrinterSettings(next);
    setSettings(next);
  };
  return [settings, update];
}
