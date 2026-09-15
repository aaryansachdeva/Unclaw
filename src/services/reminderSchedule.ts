// Reminder time math shared by the Reminders glance (today, the calendar,
// the day filter) and the alert clock (hooks/useReminderAlerts). Soul
// stores `when_iso` as local wall time: "2026-09-15T15:00:00" for a timed
// reminder, "2026-09-15" for a whole day, "" for someday.

import type { Reminder } from './reminders';

/** Heads-up notification this long before a timed reminder. */
export const LEAD_MINUTES = 10;
/** A timed reminder missed while the app was closed still announces
 *  itself on launch within this window; older ones stay quiet. */
export const MISSED_WINDOW_MINUTES = 120;
/** When a date-only reminder alerts on its day. */
export const DATE_ONLY_ALERT_HOUR = 9;

export type AlertStage = 'lead' | 'due';

export function parseWhen(iso: string | null | undefined): { at: Date; dateOnly: boolean } | null {
  const s = (iso ?? '').trim();
  if (!s) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const at = new Date(dateOnly ? `${s}T00:00:00` : s);
  return Number.isNaN(at.getTime()) ? null : { at, dateOnly };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day, "YYYY-MM-DD" (sorts as a string). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function reminderDay(r: Reminder): string | null {
  const w = parseWhen(r.when_iso);
  return w ? dayKey(w.at) : null;
}

/** When the reminder's "due" alert fires: its time, or 9 AM on its day. */
export function dueAt(r: Reminder): Date | null {
  const w = parseWhen(r.when_iso);
  if (!w) return null;
  if (!w.dateOnly) return w.at;
  const d = new Date(w.at);
  d.setHours(DATE_ONLY_ALERT_HOUR, 0, 0, 0);
  return d;
}

/** Which alert, if any, this reminder is owed right now. Soul has the final
 *  say (an alert is claimed once per time); `alerts` here only saves a
 *  round trip for ones the last fetch already knew had fired. */
export function alertStage(r: Reminder, now: Date): AlertStage | null {
  if (r.completed_at) return null;
  const w = parseWhen(r.when_iso);
  if (!w) return null;
  const fired = r.alerts ?? {};
  const t = now.getTime();
  if (w.dateOnly) {
    const endOfDay = new Date(w.at);
    endOfDay.setHours(23, 59, 59, 999);
    const due = dueAt(r)!.getTime();
    return t >= due && t <= endOfDay.getTime() && fired.due !== r.when_iso ? 'due' : null;
  }
  const due = w.at.getTime();
  if (t >= due) {
    return t - due <= MISSED_WINDOW_MINUTES * 60_000 && fired.due !== r.when_iso ? 'due' : null;
  }
  return due - t <= LEAD_MINUTES * 60_000 && fired.lead !== r.when_iso ? 'lead' : null;
}

/** Whole weeks covering `month` (Sunday first), as local dates. */
export function monthGrid(month: Date): Date[] {
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => new Date(y, m, 1 - first.getDay() + i));
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
