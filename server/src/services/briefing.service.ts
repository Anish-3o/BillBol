import { writeFromFacts, LANGUAGE_RULES, type WriterLanguage } from '../ai/writer';
import { Customer } from '../models/Customer';
import { LedgerEntry } from '../models/LedgerEntry';
import { Tenant } from '../models/Tenant';
import { AppError } from '../utils/AppError';
import { isObjectIdString } from '../utils/objectId';
import { formatQty, formatRupees } from '../utils/money';
import { getDashboard, istDayStart, type Dashboard } from './insights.service';

export type WrittenText = { text: string; source: 'ai' | 'template'; generatedAt: string };

// --- Morning briefing --------------------------------------------------------------------

type BriefingFacts = {
  owner: string;
  yesterdaySales: string;
  yesterdayBills: number;
  changePercent: number | null; // yesterday vs the day before
  todaySales: string;
  todayBills: number;
  topSellers: string[];
  restock: string[];
  udhaarTotal: string;
  udhaarCustomers: number;
  topDebtor: string | null;
  peakHour: string | null;
};

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const next = (hour + 1) % 12 === 0 ? 12 : (hour + 1) % 12;
  return `${h}-${next} ${hour + 1 >= 12 && hour + 1 < 24 ? 'PM' : 'AM'}`;
}

// The numbers the briefing may mention, already formatted. Computed in code (Rule 3).
export function briefingFacts(owner: string, d: Dashboard): BriefingFacts {
  const dayBefore = d.daily.at(-3)?.salesPaise ?? 0;
  const yesterday = d.yesterday.salesPaise;
  return {
    owner,
    yesterdaySales: formatRupees(yesterday),
    yesterdayBills: d.yesterday.bills,
    changePercent: dayBefore > 0 ? Math.round(((yesterday - dayBefore) / dayBefore) * 100) : null,
    todaySales: formatRupees(d.today.salesPaise),
    todayBills: d.today.bills,
    topSellers: d.week.topProducts.slice(0, 3).map((p) => p.name),
    restock: d.restock.slice(0, 3).map((r) => `${r.name} (${formatQty(Math.max(0, r.stockMilli), r.unit)} left)`),
    udhaarTotal: formatRupees(d.udhaar.totalOwedPaise),
    udhaarCustomers: d.udhaar.customersOwing,
    topDebtor: d.udhaar.top[0] ? `${d.udhaar.top[0].name} (${formatRupees(d.udhaar.top[0].balancePaise)})` : null,
    peakHour: d.peakHour === null ? null : hourLabel(d.peakHour),
  };
}

function factsText(f: BriefingFacts): string {
  return [
    `Owner name: ${f.owner}`,
    `Yesterday's sales: ${f.yesterdaySales} from ${billWord(f.yesterdayBills)}`,
    f.changePercent === null ? null : `Change vs the day before: ${f.changePercent}%`,
    `Today so far: ${f.todaySales} from ${billWord(f.todayBills)}`,
    f.topSellers.length ? `Best sellers this week: ${f.topSellers.join(', ')}` : null,
    f.restock.length ? `Running out soon: ${f.restock.join('; ')}` : 'Stock: nothing running low',
    `Udhaar outstanding: ${f.udhaarTotal} from ${f.udhaarCustomers} customers`,
    f.topDebtor ? `Largest udhaar: ${f.topDebtor}` : null,
    f.peakHour ? `Busiest hour this week: ${f.peakHour}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const billWord = (n: number) => `${n} ${n === 1 ? 'bill' : 'bills'}`;

// Used when Claude is not set up or its text fails the grounding check.
export function templateBriefing(f: BriefingFacts, lang: WriterLanguage): string {
  const change =
    f.changePercent === null ? '' : f.changePercent >= 0 ? ` (+${f.changePercent}%)` : ` (${f.changePercent}%)`;
  if (lang === 'mr') {
    return [
      `सुप्रभात ${f.owner}! काल ${f.yesterdaySales} ची विक्री झाली, ${f.yesterdayBills} बिलं${change}.`,
      `आज आत्तापर्यंत ${f.todaySales} (${f.todayBills} बिलं).`,
      f.topSellers.length ? `या आठवड्यात सगळ्यात जास्त विकलं: ${f.topSellers.join(', ')}.` : '',
      f.restock.length ? `लवकर मागवा: ${f.restock.join(', ')}.` : 'स्टॉक ठीक आहे.',
      f.udhaarCustomers ? `एकूण ${f.udhaarTotal} उधारी बाकी आहे${f.topDebtor ? `, सगळ्यात जास्त ${f.topDebtor}` : ''}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (lang === 'hi') {
    return [
      `सुप्रभात ${f.owner} जी! कल की बिक्री ${f.yesterdaySales} रही, ${f.yesterdayBills} बिल${change}।`,
      `आज अभी तक ${f.todaySales} (${f.todayBills} बिल)।`,
      f.topSellers.length ? `इस हफ़्ते सबसे ज़्यादा बिके: ${f.topSellers.join(', ')}।` : '',
      f.restock.length ? `जल्दी मँगवाइए: ${f.restock.join(', ')}।` : 'स्टॉक ठीक है।',
      f.udhaarCustomers ? `कुल उधार ${f.udhaarTotal} बाकी है${f.topDebtor ? `, सबसे ज़्यादा ${f.topDebtor}` : ''}।` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (lang === 'en') {
    return [
      `Good morning, ${f.owner}! Yesterday you sold ${f.yesterdaySales} across ${billWord(f.yesterdayBills)}${change}.`,
      `Today so far: ${f.todaySales} (${billWord(f.todayBills)}).`,
      f.topSellers.length ? `Best sellers this week: ${f.topSellers.join(', ')}.` : '',
      f.restock.length ? `Reorder soon: ${f.restock.join(', ')}.` : 'Stock looks healthy.',
      f.udhaarCustomers ? `${f.udhaarTotal} of udhaar is pending${f.topDebtor ? `; the largest is ${f.topDebtor}` : ''}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    `Good morning ${f.owner} ji! Kal ki bikri ${f.yesterdaySales} rahi, ${billWord(f.yesterdayBills)}${change}.`,
    `Aaj ab tak ${f.todaySales} (${billWord(f.todayBills)}).`,
    f.topSellers.length ? `Is hafte sabse zyada bika: ${f.topSellers.join(', ')}.` : '',
    f.restock.length ? `Jaldi mangwa lijiye: ${f.restock.join(', ')}.` : 'Stock theek hai.',
    f.udhaarCustomers ? `Kul ${f.udhaarTotal} udhaar baaki hai${f.topDebtor ? `, sabse zyada ${f.topDebtor}` : ''}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const BRIEFING_INSTRUCTIONS = `You write a short morning briefing for the owner of an Indian kirana (grocery) shop, shown at the top of their dashboard.

Rules:
- Use only the facts given. Never add, change, round or calculate any number. Copy amounts exactly as written (for example ₹12,340).
- 3 to 4 short sentences, under 70 words. Warm and practical, like a trusted munim (shop accountant). Greet the owner by name.
- Lead with how yesterday went, then one useful action for today (what to reorder, or whose udhaar to follow up).
- Plain text only: no markdown, no bullet points, no emoji.`;

// A few dashboard loads a minute would otherwise each pay for an AI call. The briefing is a
// morning summary, so a 20-minute-old one is fine. In memory, per server process: if the API
// runs on several machines later, this moves to a shared store (e.g. MongoDB or Redis).
const CACHE_MS = 20 * 60 * 1000;
const briefingCache = new Map<string, { at: number; value: WrittenText }>();

export async function getBriefing(tenantId: string, lang: WriterLanguage, now = new Date()): Promise<WrittenText> {
  const key = `${tenantId}:${lang}`;
  const cached = briefingCache.get(key);
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.value;

  const [tenant, dashboard] = await Promise.all([Tenant.findById(tenantId), getDashboard(tenantId, now)]);
  if (!tenant) throw new AppError(401, 'Session expired, please log in again');

  const facts = briefingFacts(tenant.ownerName.split(' ')[0], dashboard);
  const text = await writeFromFacts(`${BRIEFING_INSTRUCTIONS}\n- ${LANGUAGE_RULES[lang]}`, factsText(facts));
  const value: WrittenText = {
    text: text ?? templateBriefing(facts, lang),
    source: text ? 'ai' : 'template',
    generatedAt: now.toISOString(),
  };
  briefingCache.set(key, { at: now.getTime(), value });
  return value;
}

// For tests: start every test with an empty cache.
export const clearBriefingCache = () => briefingCache.clear();

// --- WhatsApp udhaar reminder ------------------------------------------------------------

const REMINDER_INSTRUCTIONS = `You write a WhatsApp message from a kirana shop owner to a regular customer, reminding them about money they owe (udhaar).

Rules:
- Use only the facts given. Copy the amount exactly as written. Never add or change numbers or dates.
- Polite and warm: this is a neighbour, not a debt collector. Never threaten or shame.
- Under 50 words. Mention the shop name, the amount, and that they can pay by UPI or cash when convenient. End with thanks.
- Plain text, at most one emoji.`;

export type ReminderDraft = WrittenText & { whatsappUrl: string | null; balancePaise: number };

// Rule 2: this only drafts the message. The shopkeeper reads it and presses Send in WhatsApp;
// nothing is sent automatically.
export async function draftReminder(
  tenantId: string,
  customerId: string,
  lang: WriterLanguage,
  now = new Date(),
): Promise<ReminderDraft> {
  if (!isObjectIdString(customerId)) throw new AppError(404, 'Customer not found');
  const [tenant, customer] = await Promise.all([
    Tenant.findById(tenantId),
    Customer.findOne({ _id: customerId, tenantId }),
  ]);
  if (!tenant) throw new AppError(401, 'Session expired, please log in again');
  if (!customer) throw new AppError(404, 'Customer not found');
  if (customer.balancePaise <= 0) throw new AppError(400, `${customer.name} has nothing to pay`);

  const lastSale = await LedgerEntry.findOne({ tenantId, customerId: customer._id, type: 'credit_sale' }).sort({ createdAt: -1 });
  const days = lastSale ? Math.floor((istDayStart(now).getTime() - istDayStart(lastSale.createdAt).getTime()) / 86_400_000) : null;
  const amount = formatRupees(customer.balancePaise);

  const facts = [
    `Shop name: ${tenant.name}`,
    `Owner name: ${tenant.ownerName}`,
    `Customer name: ${customer.name}`,
    `Amount owed: ${amount}`,
    days !== null ? `Last udhaar purchase: ${days} days ago` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const ai = await writeFromFacts(`${REMINDER_INSTRUCTIONS}\n- ${LANGUAGE_RULES[lang]}`, facts);
  const text =
    ai ??
    (lang === 'hi'
      ? `नमस्ते ${customer.name} जी, ${tenant.name} से ${tenant.ownerName}। आपका ${amount} का हिसाब बाकी है। जब सुविधा हो, UPI या कैश से दे दीजिए। धन्यवाद! 🙏`
      : lang === 'mr'
        ? `नमस्कार ${customer.name}, ${tenant.name} मधून ${tenant.ownerName} बोलतोय. तुमचे ${amount} बाकी आहेत. सोयीनुसार UPI किंवा रोख द्या. धन्यवाद! 🙏`
        : lang === 'en'
        ? `Hello ${customer.name}, this is ${tenant.ownerName} from ${tenant.name}. A gentle reminder that ${amount} is pending on your account. Please pay by UPI or cash whenever convenient. Thank you! 🙏`
        : `Namaste ${customer.name} ji, ${tenant.name} se ${tenant.ownerName} bol raha hoon. Aapka ${amount} ka hisaab baaki hai. Jab suvidha ho, UPI ya cash se de dijiye. Dhanyavaad! 🙏`);

  // wa.me opens WhatsApp with the message typed in, ready for the shopkeeper to send.
  const whatsappUrl = customer.phone ? `https://wa.me/91${customer.phone}?text=${encodeURIComponent(text)}` : null;
  return {
    text,
    source: ai ? 'ai' : 'template',
    generatedAt: now.toISOString(),
    whatsappUrl,
    balancePaise: customer.balancePaise,
  };
}
