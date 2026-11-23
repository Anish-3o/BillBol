import type { PaymentMode } from '../types/bill';
import type { Customer } from '../types/customer';
import type { Product } from '../types/product';

// "Hold bill": a customer remembers one more thing and walks back into the aisle, and the
// next person in the queue is waiting. The cashier parks the first cart and serves the second.
//
// Held carts are kept on this device only (they belong to this counter) and survive a page
// refresh. Nothing is saved to the server, stock is not touched and no bill number is used:
// a held cart is still just a cart. Prices are re-quoted by the server when it is resumed.

export type HeldBill = {
  id: string;
  heldAt: string;
  lines: { product: Product; qty: string }[];
  paymentMode: PaymentMode;
  customer: Customer | null;
  totalPaise: number | null; // the last quote, only to recognise the cart in the list
};

const KEY = 'billbol.heldBills';
export const MAX_HELD = 5;

export function loadHeld(): HeldBill[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? (saved as HeldBill[]).slice(0, MAX_HELD) : [];
  } catch {
    return [];
  }
}

export function saveHeld(held: HeldBill[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(held));
  } catch {
    // Storage unavailable: held carts still work until the page is closed.
  }
}

export const newHeldId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
