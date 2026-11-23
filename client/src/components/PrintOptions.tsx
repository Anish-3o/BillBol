import { PAPER_LABELS, type PaperSize, type PrinterSettings } from '../lib/printer';

type Props = {
  settings: PrinterSettings;
  onChange: (patch: Partial<PrinterSettings>) => void;
  // The billing screen shows "print after saving"; the bill page only needs the paper size.
  showAutoPrint?: boolean;
};

export function PrintOptions({ settings, onChange, showAutoPrint = false }: Props) {
  return (
    <div className="print-options no-print">
      {showAutoPrint && (
        <label className="check">
          <input type="checkbox" checked={settings.autoPrint} onChange={(e) => onChange({ autoPrint: e.target.checked })} />
          Print after saving
        </label>
      )}
      <select
        aria-label="Paper size"
        className="paper-select"
        value={settings.paper}
        onChange={(e) => onChange({ paper: e.target.value as PaperSize })}
      >
        {(Object.keys(PAPER_LABELS) as PaperSize[]).map((p) => (
          <option key={p} value={p}>
            {PAPER_LABELS[p]}
          </option>
        ))}
      </select>
    </div>
  );
}
