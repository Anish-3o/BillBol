import { understandOrder, type OrderEngine } from '../ai/orderUnderstanding';
import type { CatalogueEntry, VoiceOrder } from '../ai/voiceOrder';
import { CASE_INSENSITIVE, COUNT_UNITS, Product, type ProductDoc } from '../models/Product';
import { AppError } from '../utils/AppError';
import { toPublicProduct, type PublicProduct } from './product.service';

// Sent to the model in one request. A typical kirana stocks a few hundred items; a shop far
// beyond this would need a pre-filtering step (search the catalogue first, send matches only).
const MAX_CATALOGUE = 2000;
const MAX_QUANTITY_MILLI = 10_000_000; // same cap as a bill line

export type VoiceDraftItem = { product: PublicProduct; quantityMilli: number; heard: string };
// engine says who read the order (Claude, or the offline parser), so the screen can say so.
export type VoiceDraft = {
  transcript: string;
  items: VoiceDraftItem[];
  unmatched: string[];
  engine: OrderEngine;
};

// The shop's catalogue with short refs (P1, P2...) for the model, plus the way back from a
// ref to the product. Shared by voice billing and the assistant.
export type ShopCatalogue = { entries: CatalogueEntry[]; byRef: Map<string, ProductDoc> };

export async function loadCatalogue(tenantId: string): Promise<ShopCatalogue> {
  const products = await Product.find({ tenantId, isActive: true })
    .collation(CASE_INSENSITIVE)
    .sort({ name: 1 }) // stable order -> identical catalogue text -> prompt cache hits
    .limit(MAX_CATALOGUE);

  // Only this shop's active products are ever sent, so the model cannot pick another shop's.
  const byRef = new Map<string, ProductDoc>();
  const entries: CatalogueEntry[] = products.map((p, i) => {
    const ref = `P${i + 1}`;
    byRef.set(ref, p);
    return { ref, name: p.name, localName: p.localName ?? null, unit: p.unit };
  });
  return { entries, byRef };
}

// Never trust model output blindly: every line is checked before it reaches the cart.
// Unknown refs and nonsense quantities become "unmatched" instead of draft lines.
export function orderToDraftItems(
  order: VoiceOrder,
  byRef: Map<string, ProductDoc>,
): { items: VoiceDraftItem[]; unmatched: string[] } {
  const unmatched = [...order.unmatched];
  const lines = new Map<string, VoiceDraftItem>();

  for (const item of order.items) {
    const product = byRef.get(item.ref.trim().toUpperCase());
    if (!product) {
      unmatched.push(item.heard); // a ref we never sent
      continue;
    }
    let quantityMilli = Math.round(item.quantity * 1000);
    if (!Number.isFinite(quantityMilli) || quantityMilli <= 0) {
      unmatched.push(item.heard);
      continue;
    }
    // Soap is sold whole: round "1.5 soaps" to 2, and never below 1.
    if ((COUNT_UNITS as readonly string[]).includes(product.unit)) {
      quantityMilli = Math.max(1000, Math.round(quantityMilli / 1000) * 1000);
    }
    quantityMilli = Math.min(quantityMilli, MAX_QUANTITY_MILLI);

    // "Do sabun ... aur ek sabun" -> one line of 3.
    const existing = lines.get(product.id);
    if (existing) {
      existing.quantityMilli = Math.min(existing.quantityMilli + quantityMilli, MAX_QUANTITY_MILLI);
      existing.heard = `${existing.heard}, ${item.heard}`;
    } else {
      lines.set(product.id, { product: toPublicProduct(product), quantityMilli, heard: item.heard });
    }
  }
  return { items: [...lines.values()], unmatched };
}

// Rule 2 (AI only drafts): this returns a suggestion and saves nothing. The billing screen
// puts it in the cart, the shopkeeper checks it, and only "Confirm bill" saves the bill and
// changes stock, through the same code path as a hand-made bill.
export async function draftBillFromVoice(tenantId: string, transcript: string): Promise<VoiceDraft> {
  const { entries, byRef } = await loadCatalogue(tenantId);
  if (entries.length === 0) {
    throw new AppError(400, 'Add products first: voice billing matches what the customer says to your products.');
  }
  const { order, engine } = await understandOrder(transcript, entries);
  return { transcript, ...orderToDraftItems(order, byRef), engine };
}
