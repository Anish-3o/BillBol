import QRCode from 'qrcode';

// "Scan to pay" for UPI. A UPI QR code is just a upi://pay link drawn as a QR. Any UPI app
// (PhonePe, Google Pay, Paytm, BHIM) opens it with the shop's UPI ID and the exact amount
// already filled in, so the customer cannot pay ₹130 for a ₹131 bill by mistyping.
//
// The amount always comes from a number the server calculated (a quote, a saved bill, a khata
// balance). This file only formats it.

// 13150 paise -> "131.50". Integer arithmetic, no floating point (Rule 4).
function paiseToAmount(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

export function upiLink(args: { upiId: string; payeeName: string; amountPaise: number; note: string }): string {
  const params = new URLSearchParams({
    pa: args.upiId, // payee address (the shop's UPI ID)
    pn: args.payeeName, // payee name shown in the customer's app
    am: paiseToAmount(args.amountPaise),
    cu: 'INR',
    tn: args.note.slice(0, 50), // the note the shop sees in its bank statement ("Bill 2026-27/0042")
  });
  // URLSearchParams writes spaces as "+", which some UPI apps show literally; use %20.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

// The QR as an SVG string. QRCode.create is synchronous, so a receipt can be built and printed
// in one go, and React can render it without waiting. One <path> of black squares keeps the
// SVG small and prints crisply on a thermal printer.
export function qrSvg(text: string, sizePx = 160): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const quiet = 2; // scanners need a white border around the code
  let d = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (modules.get(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const box = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
