// Always show times in India time, whatever time zone the device is set to.
const TZ = 'Asia/Kolkata';
const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ });
const timeOnly = new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: TZ });
const dayLong = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const weekdayShort = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: TZ });
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });

// "17 Nov 2026, 12:30 pm"
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

// "12:30 pm"
export const formatTime = (iso: string) => timeOnly.format(new Date(iso));

// "Friday, 20 November"
export const formatToday = (d = new Date()) => dayLong.format(d);

// For chart labels from "2026-11-20" (an IST calendar date): "Fri", "20 Nov".
const atNoonIst = (date: string) => new Date(`${date}T12:00:00+05:30`);
export const weekdayOf = (date: string) => weekdayShort.format(atNoonIst(date));
export const dayMonthOf = (date: string) => dayMonth.format(atNoonIst(date));
export const isWeekend = (date: string) => [0, 6].includes(atNoonIst(date).getUTCDay());

// "Good morning" by the hour in India.
export function greeting(d = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(d));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// "just now", "5 min ago", "3 h ago", "2 days ago"
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

// 19 -> "7–8 PM"
export function hourRange(hour: number): string {
  const fmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12}`;
  const suffix = (h: number) => (h % 24 < 12 ? 'AM' : 'PM');
  return `${fmt(hour)}–${fmt(hour + 1)} ${suffix(hour + 1)}`;
}
