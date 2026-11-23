import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { runAssistantAgent, type AssistantTurn, type RunnableTool } from '../ai/assistant';
import { isClaudeConfigured } from '../ai/claude';
import { detectIntent, detectPeriod, isDevanagari, parseOrderLocally, type SalesPeriod } from '../ai/localParser';
import type { VoiceOrder } from '../ai/voiceOrder';
import type { PaymentMode } from '../models/Bill';
import { Customer, type CustomerDoc } from '../models/Customer';
import type { ProductDoc } from '../models/Product';
import { Tenant } from '../models/Tenant';
import { AppError } from '../utils/AppError';
import { formatQty, formatRupees } from '../utils/money';
import { sameName } from '../utils/phonetic';
import type { AssistantInput } from '../validators/assistant.validator';
import { quoteBill, type BillQuote } from './bill.service';
import {
  restockSuggestions,
  salesSummary,
  udhaarSummary,
  type RestockSuggestion,
  type SalesSummary,
  type UdhaarSummary,
} from './insights.service';
import { toPublicProduct, type PublicProduct } from './product.service';
import { loadCatalogue, orderToDraftItems } from './voiceBill.service';

// What the app gets back after each thing the shopkeeper says.
export type AssistantDraft = {
  items: { product: PublicProduct; quantityMilli: number }[];
  unmatched: string[];
  paymentMode: PaymentMode;
  customer: { id: string; name: string; balancePaise: number } | null;
  quote: BillQuote | null;
};

// Optional data the app shows as a card under the spoken reply.
export type AssistantCard =
  | { kind: 'sales'; summary: SalesSummary }
  | { kind: 'restock'; items: RestockSuggestion[] }
  | { kind: 'udhaar'; summary: UdhaarSummary }
  | { kind: 'customer'; customer: { id: string; name: string; phone: string | null; balancePaise: number } };

export type AssistantReply = {
  reply: string; // shown on screen, in the language the shopkeeper used
  speech: string; // read aloud: Devanagari Hindi for a natural Hindi voice
  engine: 'claude' | 'local';
  draft: AssistantDraft | null;
  card: AssistantCard | null;
};

// The bill being built in this conversation. The app sends it with every message and gets
// the new version back, so the server keeps no conversation state between requests.
type DraftState = {
  lines: Map<string, { product: ProductDoc; quantityMilli: number }>;
  unmatched: string[];
  paymentMode: PaymentMode;
  customer: CustomerDoc | null;
};

const HONORIFICS = /\b(ji|bhai|bhaiya|sahab|saheb|seth|aunty|uncle|didi|tai|kaka|mausi|madam|sir)\b|जी|भाई|भैया|साहब/gi;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Sharma ji" -> the shop's customer named "Suresh Sharma". Exact name wins; otherwise one
// partial match. Several partial matches are reported back so the shopkeeper can say which.
async function findCustomerByName(
  tenantId: string,
  spoken: string,
): Promise<{ match: CustomerDoc | null; candidates: CustomerDoc[] }> {
  const name = spoken.replace(HONORIFICS, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return { match: null, candidates: [] };
  let candidates = await Customer.find({ tenantId, name: new RegExp(escapeRegex(name), 'i') }).limit(5);
  const exact = candidates.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (exact) return { match: exact, candidates };
  if (candidates.length === 0) {
    // Not found as written: try by sound, so "सुरेश पाटील" finds "Suresh Patil".
    const spoken = name.split(/\s+/);
    const all = await Customer.find({ tenantId }).limit(500);
    candidates = all.filter((c) => spoken.every((s) => c.name.split(/\s+/).some((w) => sameName(w, s)))).slice(0, 5);
  }
  return { match: candidates.length === 1 ? candidates[0] : null, candidates };
}

// What the model sees as <current_draft>: refs it can use to change the bill.
function draftText(state: DraftState, refOf: Map<string, string>): string {
  if (state.lines.size === 0) return 'empty';
  const lines = [...state.lines.values()].map(
    (l) => `${refOf.get(l.product.id)} | ${l.product.name} | ${l.quantityMilli / 1000} ${l.product.unit}`,
  );
  const who = state.customer ? `, customer: ${state.customer.name}` : '';
  return `${lines.join('\n')}\npayment: ${state.paymentMode}${who}`;
}

async function draftQuote(tenantId: string, state: DraftState): Promise<BillQuote | null> {
  if (state.lines.size === 0) return null;
  const items = [...state.lines.values()].map((l) => ({ productId: l.product.id, quantityMilli: l.quantityMilli }));
  return quoteBill(tenantId, { items });
}

// Tool results are JSON with amounts already formatted, so the model copies them and never
// needs to do arithmetic.
function quoteForModel(quote: BillQuote | null) {
  if (!quote) return { lines: [], total: formatRupees(0) };
  return {
    lines: quote.lines.map((l) => ({
      name: l.name,
      quantity: formatQty(l.quantityMilli, l.unit),
      amount: formatRupees(l.totalPaise),
    })),
    item_count: quote.lines.length,
    total: formatRupees(quote.totalPaise),
    stock_warnings: quote.stockWarnings.map((w) => `${w.name}: only ${formatQty(Math.max(0, w.stockMilli), w.unit)} in stock`),
  };
}

const salesForModel = (s: SalesSummary) => ({
  period: s.period,
  sales: formatRupees(s.salesPaise),
  bills: s.bills,
  average_bill: formatRupees(s.avgBillPaise),
  top_products: s.topProducts.map((p) => `${p.name} (${formatRupees(p.salesPaise)})`),
  payment_split: s.paymentSplit.map((p) => `${p.mode}: ${formatRupees(p.paise)}`),
});

const restockForModel = (items: RestockSuggestion[]) =>
  items.map((r) => ({
    name: r.name,
    in_stock: formatQty(Math.max(0, r.stockMilli), r.unit),
    days_left: r.daysLeft,
    suggested_order: formatQty(r.suggestedMilli, r.unit),
  }));

export async function handleAssistantMessage(
  auth: { tenantId: string; userId: string },
  input: AssistantInput,
): Promise<AssistantReply> {
  const { tenantId } = auth;
  const [tenant, catalogue] = await Promise.all([Tenant.findById(tenantId), loadCatalogue(tenantId)]);
  if (!tenant) throw new AppError(401, 'Session expired, please log in again');
  const assistantName = input.assistantName ?? 'Ramu';

  // Rebuild the draft from what the app sent, keeping only this shop's active products and
  // customers. The client is never trusted for prices: those come from quoteBill.
  const byId = new Map([...catalogue.byRef.values()].map((p) => [p.id as string, p]));
  const refOf = new Map([...catalogue.byRef.entries()].map(([ref, p]) => [p.id as string, ref]));
  const state: DraftState = { lines: new Map(), unmatched: [], paymentMode: input.draft?.paymentMode ?? 'cash', customer: null };
  for (const item of input.draft?.items ?? []) {
    const product = byId.get(item.productId.toLowerCase());
    if (product) state.lines.set(product.id, { product, quantityMilli: item.quantityMilli });
  }
  if (input.draft?.customerId) {
    state.customer = await Customer.findOne({ _id: input.draft.customerId, tenantId });
  }

  let card: AssistantCard | null = null;

  // --- The agent's tools: closures over this request's tenant and draft ---
  const setDraft = async (order: VoiceOrder, paymentMode?: PaymentMode, customerName?: string) => {
    const { items, unmatched } = orderToDraftItems(order, catalogue.byRef);
    state.lines = new Map(items.map((i) => [i.product.id, { product: byId.get(i.product.id)!, quantityMilli: i.quantityMilli }]));
    state.unmatched = unmatched;
    if (paymentMode) state.paymentMode = paymentMode;
    let customerNote: string | undefined;
    if (customerName) {
      const { match, candidates } = await findCustomerByName(tenantId, customerName);
      if (match) state.customer = match;
      else customerNote = candidates.length > 1
        ? `Several customers match "${customerName}": ${candidates.map((c) => c.name).join(', ')}. Ask which one.`
        : `No customer named "${customerName}". Ask the shopkeeper to add them in the app first.`;
    }
    if (state.paymentMode === 'udhaar' && !state.customer) {
      customerNote ??= 'Udhaar needs a customer. Ask whose khata to write it in.';
    }
    return { quote: await draftQuote(tenantId, state), customerNote };
  };

  const tools: RunnableTool[] = [
    betaZodTool({
      name: 'update_bill_draft',
      description:
        'Replace the draft bill with this complete list of items (include existing items you want to keep). Optionally set the payment mode and the customer. Returns the priced draft. Never saves the bill.',
      inputSchema: z.object({
        items: z.array(
          z.object({
            ref: z.string().describe('Catalogue ref, e.g. "P3"'),
            quantity: z.number().describe("Quantity in the product's own unit"),
            heard: z.string().describe('The words used for this item'),
          }),
        ),
        unmatched: z.array(z.string()).optional().describe('Items asked for that are not in the catalogue'),
        payment_mode: z.enum(['cash', 'upi', 'card', 'udhaar']).optional(),
        customer_name: z.string().optional().describe('For udhaar: the customer name as said'),
      }),
      run: async (args) => {
        const { quote, customerNote } = await setDraft(
          { items: args.items, unmatched: args.unmatched ?? [] },
          args.payment_mode,
          args.customer_name,
        );
        return JSON.stringify({
          ...quoteForModel(quote),
          not_in_catalogue: state.unmatched,
          payment_mode: state.paymentMode,
          customer: state.customer?.name ?? null,
          ...(customerNote ? { note: customerNote } : {}),
        });
      },
    }),
    betaZodTool({
      name: 'clear_bill_draft',
      description: 'Empty the draft bill when the shopkeeper cancels or wants to start again.',
      inputSchema: z.object({}),
      run: async () => {
        state.lines.clear();
        state.unmatched = [];
        state.customer = null;
        state.paymentMode = 'cash';
        return 'Draft cleared.';
      },
    }),
    betaZodTool({
      name: 'get_sales_summary',
      description: 'Sales total, number of bills, average bill, best sellers and payment split for a period.',
      inputSchema: z.object({ period: z.enum(['today', 'yesterday', 'last_7_days', 'this_month']) }),
      run: async ({ period }) => {
        const summary = await salesSummary(tenantId, period);
        card = { kind: 'sales', summary };
        return JSON.stringify(salesForModel(summary));
      },
    }),
    betaZodTool({
      name: 'get_restock_suggestions',
      description: 'Products that are running out, based on how fast they sell, with how much to order.',
      inputSchema: z.object({}),
      run: async () => {
        const items = await restockSuggestions(tenantId);
        card = { kind: 'restock', items };
        return JSON.stringify(items.length ? restockForModel(items) : 'Nothing is running low.');
      },
    }),
    betaZodTool({
      name: 'get_udhaar',
      description: 'Udhaar (customer credit). With customer_name: what that customer owes. Without: the total owed and who owes the most.',
      inputSchema: z.object({ customer_name: z.string().optional() }),
      run: async ({ customer_name }) => {
        if (customer_name) {
          const { match, candidates } = await findCustomerByName(tenantId, customer_name);
          if (!match) {
            return candidates.length > 1
              ? `Several customers match: ${candidates.map((c) => c.name).join(', ')}.`
              : `No customer named "${customer_name}".`;
          }
          card = { kind: 'customer', customer: { id: match.id, name: match.name, phone: match.phone ?? null, balancePaise: match.balancePaise } };
          return JSON.stringify({ customer: match.name, owes: formatRupees(Math.max(0, match.balancePaise)), advance: match.balancePaise < 0 ? formatRupees(-match.balancePaise) : null });
        }
        const summary = await udhaarSummary(tenantId);
        card = { kind: 'udhaar', summary };
        return JSON.stringify({
          total_owed: formatRupees(summary.totalOwedPaise),
          customers_owing: summary.customersOwing,
          top: summary.top.map((c) => `${c.name}: ${formatRupees(c.balancePaise)}`),
        });
      },
    }),
  ];

  let reply: string;
  let speech: string;
  let engine: AssistantReply['engine'] = 'claude';
  if (isClaudeConfigured()) {
    try {
      ({ reply, speech } = await runAssistantAgent({
        name: assistantName,
        language: input.language,
        shopName: tenant.name,
        catalogue: catalogue.entries,
        history: input.history as AssistantTurn[],
        message: input.message,
        draftText: draftText(state, refOf),
        tools,
      }));
    } catch (err) {
      // Same policy as voice billing: only "unavailable" falls back to the offline brain.
      if (!(err instanceof AppError && err.statusCode === 503)) throw err;
      console.warn(`Assistant: Claude unavailable (${err.message}); answering offline.`);
      engine = 'local';
      ({ reply, speech, card } = await answerLocally(tenantId, input.message, input.language, assistantName, catalogue, state, setDraft));
    }
  } else {
    engine = 'local';
    ({ reply, speech, card } = await answerLocally(tenantId, input.message, input.language, assistantName, catalogue, state, setDraft));
  }

  const quote = await draftQuote(tenantId, state);
  const draft: AssistantDraft | null =
    state.lines.size === 0 && state.unmatched.length === 0
      ? null
      : {
          items: [...state.lines.values()].map((l) => ({ product: toPublicProduct(l.product), quantityMilli: l.quantityMilli })),
          unmatched: state.unmatched,
          paymentMode: state.paymentMode,
          customer: state.customer ? { id: state.customer.id, name: state.customer.name, balancePaise: state.customer.balancePaise } : null,
          quote,
        };
  return { reply, speech, engine, draft, card };
}

// --- Offline answers (no API key, or no internet) ---------------------------------------
// Plain rules: understand the intent, run the same code the tools use, fill in a template.

type Lang = 'hi' | 'hinglish' | 'mr';
type Phrase = [hinglish: string, hindi: string, marathi: string];

// Every reply comes in two forms: what the screen shows (in the language the shopkeeper used)
// and what is spoken, always in Devanagari (Hindi, or Marathi for a Marathi shop), so a Hindi
// or Marathi voice reads it naturally instead of an English voice mispronouncing Hinglish.
const say = (lang: Lang, [hinglish, hindi, marathi]: Phrase) => ({
  reply: lang === 'mr' ? marathi : lang === 'hi' ? hindi : hinglish,
  speech: lang === 'mr' ? marathi : hindi,
});
type Spoken = { reply: string; speech: string; card: AssistantCard | null };

async function answerLocally(
  tenantId: string,
  message: string,
  language: 'hi' | 'mr' | 'en',
  assistantName: string,
  catalogue: Awaited<ReturnType<typeof loadCatalogue>>,
  state: DraftState,
  setDraft: (order: VoiceOrder, paymentMode?: PaymentMode, customerName?: string) => Promise<{ quote: BillQuote | null; customerNote?: string }>,
): Promise<Spoken> {
  // Marathi is chosen in the app (both languages are written in Devanagari, so the script alone
  // cannot tell them apart); otherwise Devanagari means Hindi and Latin means Hinglish.
  const lang: Lang = language === 'mr' ? 'mr' : isDevanagari(message) ? 'hi' : 'hinglish';
  const intent = detectIntent(message);
  // For udhaar, find the customer first, so their name is not mistaken for an item.
  let named: CustomerDoc | undefined;
  const spokenWords = message.toLowerCase().split(/[\s,.!?।]+/).filter(Boolean);
  // A customer word matches if it is in the text as typed ("patil") or sounds the same in
  // Devanagari ("पाटील", from Hindi/Marathi speech recognition).
  const nameWordsIn = (c: CustomerDoc) =>
    spokenWords.filter((s) => c.name.toLowerCase().split(/\s+/).some((w) => w.length >= 3 && (s === w || sameName(w, s))));
  if (intent === 'udhaar') {
    const customers = await Customer.find({ tenantId }).limit(500);
    named = customers.find((c) => nameWordsIn(c).length > 0);
  }
  const ignore = [assistantName, ...(named ? [...named.name.split(/\s+/), ...nameWordsIn(named)] : [])];
  const parsed = parseOrderLocally(message, catalogue.entries, ignore);
  const periodWords: Record<SalesPeriod, Phrase> = {
    today: ['Aaj ab tak', 'आज अभी तक', 'आज आत्तापर्यंत'],
    yesterday: ['Kal', 'कल', 'काल'],
    last_7_days: ['Pichhle 7 din mein', 'पिछले 7 दिन में', 'मागच्या 7 दिवसांत'],
    this_month: ['Is mahine', 'इस महीने', 'या महिन्यात'],
  };

  if (intent === 'sales') {
    const period = detectPeriod(message);
    const s = await salesSummary(tenantId, period);
    const top = s.topProducts[0]?.name;
    const [hinglish, hindi, marathi] = periodWords[period];
    const amount = formatRupees(s.salesPaise);
    return {
      card: { kind: 'sales', summary: s },
      ...say(lang, [
        `${hinglish} ${amount} ki bikri, ${s.bills} bills.${top ? ` Sabse zyada ${top} bika.` : ''}`,
        `${hindi} ${amount} की बिक्री, ${s.bills} बिल।${top ? ` सबसे ज़्यादा ${top} बिका।` : ''}`,
        `${marathi} ${amount} ची विक्री, ${s.bills} बिलं.${top ? ` सगळ्यात जास्त ${top} विकलं.` : ''}`,
      ]),
    };
  }

  if (intent === 'restock') {
    const items = await restockSuggestions(tenantId);
    if (items.length === 0) {
      return { card: null, ...say(lang, ['Sab stock theek hai.', 'सारा स्टॉक ठीक है।', 'सगळा स्टॉक ठीक आहे.']) };
    }
    const names = items.slice(0, 3).map((r) => r.name).join(', ');
    return {
      card: { kind: 'restock', items },
      ...say(lang, [
        `${items.length} cheezein mangwani hain. Sabse pehle: ${names}.`,
        `${items.length} चीज़ें मँगवानी हैं। सबसे पहले: ${names}।`,
        `${items.length} वस्तू मागवायच्या आहेत. आधी: ${names}.`,
      ]),
    };
  }

  if (intent === 'clear') {
    // "maggi hatao" removes Maggi; plain "cancel" empties the whole draft.
    if (parsed.items.length > 0 && state.lines.size > 0) {
      for (const item of parsed.items) state.lines.delete(catalogue.byRef.get(item.ref)!.id);
      const total = formatRupees((await draftQuote(tenantId, state))?.totalPaise ?? 0);
      return {
        card: null,
        ...say(lang, [`Hata diya. Ab total ${total}.`, `हटा दिया। अब कुल ${total}।`, `काढलं. आता एकूण ${total}.`]),
      };
    }
    state.lines.clear();
    state.unmatched = [];
    state.customer = null;
    state.paymentMode = 'cash';
    return { card: null, ...say(lang, ['Theek hai, bill hata diya.', 'ठीक है, बिल हटा दिया।', 'ठीक आहे, बिल रद्द केलं.']) };
  }

  if (parsed.items.length > 0) {
    // Offline, new items are ADDED to the draft ("aur do maggi"): rules cannot reliably tell
    // "replace" from "add", and adding is what people mean most of the time.
    const merged = [...state.lines.values()].map((l) => ({
      ref: catalogue.entries.find((e) => catalogue.byRef.get(e.ref)!.id === l.product.id)!.ref,
      quantity: l.quantityMilli / 1000,
      heard: l.product.name,
    }));
    const { quote, customerNote } = await setDraft(
      { items: [...merged, ...parsed.items], unmatched: parsed.unmatched },
      intent === 'udhaar' ? 'udhaar' : undefined,
      named?.name,
    );
    const count = quote?.lines.length ?? 0;
    // Optional sentence parts, each in all three languages.
    const none: Phrase = ['', '', ''];
    const lost = state.unmatched.join(', ');
    const missing: Phrase = state.unmatched.length ? [` ${lost} nahi mila.`, ` ${lost} नहीं मिला।`, ` ${lost} मिळालं नाही.`] : none;
    const name = state.customer?.name;
    const who: Phrase =
      name && state.paymentMode === 'udhaar' ? [` ${name} ke khate mein.`, ` ${name} के खाते में।`, ` ${name} च्या खात्यात.`] : none;
    const note: Phrase =
      customerNote && state.paymentMode === 'udhaar' && !state.customer
        ? [' Kiske khate mein likhun?', ' किसके खाते में लिखूँ?', ' कोणाच्या खात्यात लिहू?']
        : none;
    const total = formatRupees(quote?.totalPaise ?? 0);
    return {
      card: null,
      ...say(lang, [
        `${count} ${count === 1 ? 'item' : 'items'}, kul ${total}.${who[0]}${missing[0]}${note[0]} Confirm karun?`,
        `${count} आइटम, कुल ${total}।${who[1]}${missing[1]}${note[1]} कन्फ़र्म करूँ?`,
        `${count} वस्तू, एकूण ${total}.${who[2]}${missing[2]}${note[2]} कन्फर्म करू?`,
      ]),
    };
  }

  if (intent === 'udhaar') {
    if (named) {
      const owes = formatRupees(Math.max(0, named.balancePaise));
      return {
        card: { kind: 'customer', customer: { id: named.id, name: named.name, phone: named.phone ?? null, balancePaise: named.balancePaise } },
        ...say(lang, [
          `${named.name} ka ${owes} udhaar baaki hai.`,
          `${named.name} का ${owes} उधार बाकी है।`,
          `${named.name} ची ${owes} उधारी बाकी आहे.`,
        ]),
      };
    }
    const summary = await udhaarSummary(tenantId);
    const top = summary.top[0];
    const total = formatRupees(summary.totalOwedPaise);
    const most = top ? formatRupees(top.balancePaise) : '';
    return {
      card: { kind: 'udhaar', summary },
      ...say(lang, [
        `Kul ${total} udhaar baaki hai, ${summary.customersOwing} logon par.${top ? ` Sabse zyada ${top.name}: ${most}.` : ''}`,
        `कुल ${total} उधार बाकी है, ${summary.customersOwing} लोगों पर।${top ? ` सबसे ज़्यादा ${top.name}: ${most}।` : ''}`,
        `एकूण ${total} उधारी बाकी आहे, ${summary.customersOwing} लोकांकडे.${top ? ` सगळ्यात जास्त ${top.name}: ${most}.` : ''}`,
      ]),
    };
  }

  if (intent === 'greeting') {
    return {
      card: null,
      ...say(lang, ['Namaste! Boliye, kya bill banana hai?', 'नमस्ते! बोलिए, क्या बिल बनाना है?', 'नमस्कार! बोला, काय बिल करायचं?']),
    };
  }
  const lost = parsed.unmatched.join(', ');
  return {
    card: null,
    ...say(
      lang,
      parsed.unmatched.length
        ? [`${lost} dukaan mein nahi mila. Doosra item boliye.`, `${lost} दुकान में नहीं मिला। दूसरा आइटम बोलिए।`, `${lost} दुकानात मिळालं नाही. दुसरी वस्तू सांगा.`]
        : [
            'Samjha nahi. Items boliye, jaise "do kilo cheeni aur ek sabun".',
            'समझ नहीं आया। आइटम बोलिए, जैसे "दो किलो चीनी और एक साबुन"।',
            'समजलं नाही. वस्तू सांगा, जसं "दोन किलो साखर आणि एक साबण".',
          ],
    ),
  };
}
