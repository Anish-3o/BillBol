import type { Tenant } from '../types/auth';
import { PAYMENT_LABELS, type Bill } from '../types/bill';
import { formatDateTime } from './datetime';
import { formatPaise } from './money';
import { formatQuantity } from './quantity';
import { qrSvg, upiLink } from './upi';

// Printing a bill on whatever printer the counter has.
//
// Kirana counters use 58 mm or 80 mm thermal receipt printers (TVS, Epson, Retsol...) or an
// ordinary A4 printer. All of them install as normal printers in Windows/Android, so the
// browser's own print is the one path that works with every brand; no vendor SDK, no driver
// of ours. We build a receipt sized for the paper and print it from a hidden iframe, so the app
// screen is never what gets printed and printing works from any page (billing, bill detail,
// or the voice assistant).
//
// For one-tap printing with no dialog, start Chrome/Edge with --kiosk-printing: it then prints
// straight to the default printer.

export type PaperSize = '58mm' | '80mm' | 'a4';

export const PAPER_LABELS: Record<PaperSize, string> = {
  '58mm': '58 mm receipt',
  '80mm': '80 mm receipt',
  a4: 'A4 sheet',
};

export type PrinterSettings = { paper: PaperSize; autoPrint: boolean };

// The printer belongs to this counter, not to the shop (the owner's phone has no printer), so
// the settings are kept per device. Storage can be unavailable (private mode): use defaults.
const KEY = 'billbol.printer';
const DEFAULTS: PrinterSettings = { paper: '80mm', autoPrint: true };

export function loadPrinterSettings(): PrinterSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PrinterSettings>;
    const paper = saved.paper && saved.paper in PAPER_LABELS ? saved.paper : DEFAULTS.paper;
    return { paper, autoPrint: saved.autoPrint ?? DEFAULTS.autoPrint };
  } catch {
    return DEFAULTS;
  }
}

export function savePrinterSettings(settings: PrinterSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // ignore: the setting just will not be remembered
  }
}

// Shop names, product names and customer names are typed by users, and the receipt is HTML
// rendered in a same-origin iframe, so every one of them is escaped (no script injection).
const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Columns on a narrow roll have no room for "₹"; totals keep it.
const amount = (paise: number) =>
  (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Printable width of each paper (thermal heads cannot print to the very edge).
const WIDTH_MM: Record<Exclude<PaperSize, 'a4'>, { paper: number; print: number; font: number }> = {
  '58mm': { paper: 58, print: 48, font: 11 },
  '80mm': { paper: 80, print: 72, font: 12 },
};

// Every number here is the saved bill's number (Rule 3): nothing is recalculated for printing.
export function receiptHtml(bill: Bill, shop: Tenant, paper: PaperSize): string {
  const gst = bill.taxMode === 'gst';
  const roll = paper === 'a4' ? null : WIDTH_MM[paper];

  const rows = bill.items
    .map((item) => {
      const name = `${esc(item.name)}${gst ? ` <small>(GST ${item.gstRate}%)</small>` : ''}`;
      const qty = esc(formatQuantity(item.quantityMilli, item.unit));
      // A narrow roll puts the name on its own line, numbers below; A4 has room for one row.
      return roll
        ? `<tr class="name"><td colspan="4">${name}</td></tr>
           <tr class="nums"><td></td><td>${qty}</td><td>${amount(item.unitPricePaise)}</td><td>${amount(item.totalPaise)}</td></tr>`
        : `<tr><td>${name}</td><td>${qty}</td><td>${amount(item.unitPricePaise)}</td><td>${amount(item.totalPaise)}</td></tr>`;
    })
    .join('');

  const taxRows = gst
    ? `<tr><td>Taxable value</td><td>${formatPaise(bill.taxablePaise)}</td></tr>
       <tr><td>CGST</td><td>${formatPaise(bill.cgstPaise)}</td></tr>
       <tr><td>SGST</td><td>${formatPaise(bill.sgstPaise)}</td></tr>`
    : '';

  // Udhaar means "pay later": print a QR for the exact amount so the customer can pay from
  // home. Cash/card/UPI bills are already paid, so they get none.
  const qr =
    bill.paymentMode === 'udhaar' && shop.upiId && bill.status !== 'cancelled'
      ? `<div class="c qr">${qrSvg(upiLink({ upiId: shop.upiId, payeeName: shop.name, amountPaise: bill.totalPaise, note: `Bill ${bill.number}` }), roll ? 130 : 150)}
           <div>Scan to pay ${formatPaise(bill.totalPaise)} by UPI</div></div>`
      : '';
  // A reprint of a cancelled bill must never pass for a valid one.
  const cancelled = bill.cancelled
    ? `<div class="void">CANCELLED</div><div class="c">${esc(formatDateTime(bill.cancelled.at))} by ${esc(bill.cancelled.byName)}<br>${esc(bill.cancelled.reason)}</div><hr>`
    : '';

  const page = roll
    ? `body { width: ${roll.paper}mm; padding: 3mm ${(roll.paper - roll.print) / 2}mm 6mm; font-size: ${roll.font}px; }`
    : `@page { size: A4; margin: 14mm; } body { max-width: 182mm; margin: 0 auto; font-size: 13px; }
       h1 { font-size: 22px; } .items td, .items th { padding: 4px 2px; }`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Bill ${esc(bill.number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Noto Sans Devanagari', sans-serif; line-height: 1.35; color: #000; background: #fff;
         font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; }
  ${page}
  .c { text-align: center; }
  h1 { font-size: 1.45em; line-height: 1.15; }
  .doc { font-weight: 700; letter-spacing: 0.08em; margin-top: 4px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  hr.solid { border-top: 2px solid #000; }
  table { width: 100%; border-collapse: collapse; }
  td, th { vertical-align: top; }
  .meta td:last-child { text-align: right; }
  .meta b { white-space: nowrap; }
  .items th { font-weight: 700; text-align: right; border-bottom: 1px solid #000; padding-bottom: 2px; }
  .items th:first-child, .items td:first-child { text-align: left; }
  .items td { text-align: right; }
  .items .name td { padding-top: 4px; font-weight: 600; text-align: left; }
  .items small { font-weight: 400; }
  .sums td:last-child { text-align: right; }
  .total td { font-size: 1.5em; font-weight: 800; padding: 2px 0; }
  .foot { margin-top: 8px; font-size: 0.92em; }
  .qr { margin-top: 8px; font-weight: 600; }
  .qr svg { display: block; margin: 0 auto 2px; }
  .void { margin: 6px 0 2px; padding: 4px 0; border: 3px solid #000; text-align: center; font-size: 1.6em;
          font-weight: 800; letter-spacing: 0.15em; }
</style></head>
<body>
  <div class="c">
    <h1>${esc(shop.name)}</h1>
    ${shop.address ? `<div>${esc(shop.address)}</div>` : ''}
    <div>${esc(shop.state)} · Ph ${esc(shop.phone)}</div>
    ${shop.gstin ? `<div>GSTIN ${esc(shop.gstin)}</div>` : ''}
    <div class="doc">${gst ? 'TAX INVOICE' : 'BILL OF SUPPLY'}</div>
  </div>
  <hr>
  ${cancelled}
  <table class="meta">
    <tr><td>Bill <b>${esc(bill.number)}</b></td><td>${esc(formatDateTime(bill.createdAt))}</td></tr>
    <tr><td>Billed by ${esc(bill.createdByName)}</td><td>${bill.customer ? `Customer: ${esc(bill.customer.name)}` : ''}</td></tr>
  </table>
  <hr>
  <table class="items">
    <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr>
  <table class="sums">
    <tr><td>Items</td><td>${bill.items.length}</td></tr>
    ${taxRows}
  </table>
  <hr class="solid">
  <table class="sums total"><tr><td>TOTAL</td><td>${formatPaise(bill.totalPaise)}</td></tr></table>
  <hr class="solid">
  <table class="sums"><tr><td>Paid by</td><td><b>${PAYMENT_LABELS[bill.paymentMode]}</b></td></tr></table>
  ${qr}
  <div class="c foot">
    ${gst ? 'Prices include GST.' : 'Not GST-registered: no GST charged.'}<br>
    Dhanyavaad, phir padhariye!
  </div>
</body></html>`;
}

const PX_PER_MM = 96 / 25.4;
let activeFrame: HTMLIFrameElement | null = null;

export function printBill(bill: Bill, shop: Tenant, paper: PaperSize = loadPrinterSettings().paper): void {
  activeFrame?.remove();

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Off-screen but laid out at the paper's width, so the receipt's height can be measured.
  // (display:none or a 0-width frame prints blank in some browsers.)
  const width = paper === 'a4' ? '210mm' : `${WIDTH_MM[paper].paper}mm`;
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width, height: '10px', border: '0' });
  activeFrame = frame;

  frame.onload = () => {
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) return;
    if (paper !== 'a4') {
      // A receipt roll has no fixed page length: make the "page" exactly as long as the bill,
      // so the printer feeds no blank paper and does not split the bill across two "pages".
      const heightMm = Math.ceil(doc.documentElement.scrollHeight / PX_PER_MM) + 2;
      const style = doc.createElement('style');
      style.textContent = `@page { size: ${WIDTH_MM[paper].paper}mm ${heightMm}mm; margin: 0; }`;
      doc.head.appendChild(style);
    }
    win.addEventListener('afterprint', () => {
      // Removing the frame while the dialog is open cancels the print in some browsers.
      window.setTimeout(() => {
        frame.remove();
        if (activeFrame === frame) activeFrame = null;
      }, 500);
    });
    win.focus();
    win.print();
  };
  frame.srcdoc = receiptHtml(bill, shop, paper);
  document.body.appendChild(frame);
}
