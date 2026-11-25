import type { CSSProperties } from 'react';
import { dayMonthOf, isWeekend, weekdayOf } from '../lib/datetime';
import { formatPaise } from '../lib/money';
import type { DayPoint } from '../types/insights';
import { PAYMENT_LABELS, type PaymentMode } from '../types/bill';

// Hand-built charts (CSS bars and one SVG donut): two small charts did not justify a
// charting library's size. Each one also renders its numbers as text for screen readers.

export function SalesBars({ days }: { days: DayPoint[] }) {
  const max = Math.max(1, ...days.map((d) => d.salesPaise));
  const today = days.at(-1)?.date;
  return (
    <div className="bar-chart" role="img" aria-label={`Daily sales for the last ${days.length} days`}>
      {days.map((d, i) => {
        const isToday = d.date === today;
        const height = `${Math.max(1.5, (d.salesPaise / max) * 100)}%`;
        // 0 for the first bar, 1 for the last: the tooltip slides by this fraction so it stays
        // inside the chart (see .bar-tip), instead of hanging off the screen on phones.
        const tipPos = { '--f': days.length > 1 ? i / (days.length - 1) : 0.5 } as CSSProperties;
        return (
          <div key={d.date} className={`bar-col${isToday ? ' is-today' : ''}`} tabIndex={0}>
            <span className="bar-tip" style={tipPos}>
              {dayMonthOf(d.date)} · {formatPaise(d.salesPaise)} · {d.bills} bills
            </span>
            <div className={`bar${isToday ? ' today' : isWeekend(d.date) ? ' weekend' : ''}`} style={{ height }} />
            <span className="bar-label">
              {isToday ? (
                // "Today" is wider than a bar on a narrow phone and ran into the label next to it,
                // so phones show the short weekday (still highlighted) instead.
                <>
                  <span className="today-long">Today</span>
                  <span className="today-short">{weekdayOf(d.date).slice(0, 2)}</span>
                </>
              ) : (
                weekdayOf(d.date).slice(0, 2)
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const PAY_COLORS: Record<PaymentMode, string> = {
  cash: 'var(--pay-cash)',
  upi: 'var(--pay-upi)',
  card: 'var(--pay-card)',
  udhaar: 'var(--pay-udhaar)',
};

export function PaymentDonut({ split }: { split: { mode: PaymentMode; paise: number; bills: number }[] }) {
  const total = split.reduce((s, p) => s + p.paise, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg width="132" height="132" viewBox="0 0 120 120" role="img" aria-label="Sales by payment mode">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#edf2f0" strokeWidth="16" />
        {total > 0 &&
          split.map((p) => {
            const length = (p.paise / total) * circumference;
            const segment = (
              <circle
                key={p.mode}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={PAY_COLORS[p.mode]}
                strokeWidth="16"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            );
            offset += length;
            return segment;
          })}
        <text x="60" y="56" textAnchor="middle" className="donut-center">
          7 days
        </text>
        <text x="60" y="74" textAnchor="middle" className="donut-total">
          {total >= 10_000_000 ? `₹${(total / 10_000_000).toFixed(1)}L` : `₹${Math.round(total / 100_000)}k`}
        </text>
      </svg>
      <ul className="legend">
        {split.map((p) => (
          <li key={p.mode}>
            <span className={`pay-dot pay-${p.mode}`} />
            <span>{PAYMENT_LABELS[p.mode]}</span>
            <strong>{total ? Math.round((p.paise / total) * 100) : 0}%</strong>
          </li>
        ))}
        {split.length === 0 && <li className="muted">No sales yet</li>}
      </ul>
    </div>
  );
}

export function Delta({ now, before, suffix = 'vs yesterday' }: { now: number; before: number; suffix?: string }) {
  if (before === 0) return <span className="kpi-delta delta-flat">{now > 0 ? 'First sales' : 'No sales yet'}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const cls = pct > 0 ? 'delta-up' : pct < 0 ? 'delta-down' : 'delta-flat';
  return (
    <span className={`kpi-delta ${cls}`}>
      {pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} {Math.abs(pct)}% <span className="muted">{suffix}</span>
    </span>
  );
}
