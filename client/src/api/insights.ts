import type { Dashboard, ReminderDraft, WriterLanguage, WrittenText } from '../types/insights';
import { api } from './client';

export const getDashboard = () => api<Dashboard>('/insights/dashboard');

// The morning briefing: real numbers from the server, phrased by AI (or a template).
export const getBriefing = (lang: WriterLanguage) => api<WrittenText>(`/insights/briefing?lang=${lang}`);

// A WhatsApp reminder for a customer's udhaar. Only drafted: the shopkeeper sends it.
export const draftReminder = (customerId: string, lang: WriterLanguage) =>
  api<ReminderDraft>(`/customers/${customerId}/reminder-draft`, 'POST', { lang });
