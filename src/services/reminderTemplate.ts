// The reminder template the Reminders glance drops into the input bar in
// place of a form, one line of boxes:
//
//   Add a reminder for ‹ | › « today » at « 5 PM »
//
// Three boxes, all drawn by the input bar's mirror as soft blocks (and only
// while a template is active, so these characters in any other message stay
// plain text):
//   ‹subject›  starts empty with the caret inside and grows as the user
//              types. No picker: it is just a place to type.
//   «value»    date and time, prefilled with today and the next whole hour.
//              Clicking one opens a picker; typing over it replaces it;
//              left alone it is kept.
// Inside every box a no-break space on each side gives it real breathing
// room that the textarea's caret accounts for too; the mirror paints the
// guillemets clear, so they read as the box's padding.
//
// Tab stops, left to right and never wrapping: subject, date, time, then
// "Details: " for extra context (added by the first Tab past the time). On
// send the boxes unwrap into a plain sentence for the chat ("Add a reminder
// for call mom today at 5 PM"); the reminder tool stores the details as notes.

import { dayKey } from './reminderSchedule';

export const TEMPLATE_LEAD = 'Add a reminder for ';
export const SUBJECT_OPEN = '‹';
export const SUBJECT_CLOSE = '›';
export const FIELD_OPEN = '«';
export const FIELD_CLOSE = '»';
export const DETAILS_LABEL = 'Details:';
export const DETAILS_LINE = `${DETAILS_LABEL} `;
const PAD = ' ';

const SUBJECT_RE = /‹([^‹›\n]*)›/g;
const FIELD_RE = /«([^«»\n]*)»/g;
const BOX_RE = /‹[^‹›\n]*›|«[^«»\n]*»/g;
const TIME_RE = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i;

export const field = (value: string) => `${FIELD_OPEN}${PAD}${value}${PAD}${FIELD_CLOSE}`;
export const subjectBox = (value = '') => `${SUBJECT_OPEN}${PAD}${value}${PAD}${SUBJECT_CLOSE}`;

/** "4 PM", "6:30 PM" for minutes after midnight. */
export function timeLabel(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  return `${h24 % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** Minutes after midnight for "4 PM" / "6:30pm"; null when it is not one. */
export function parseTimeLabel(label: string): number | null {
  const m = TIME_RE.exec(label.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  if (h < 1 || h > 12 || mm > 59) return null;
  return ((h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + mm;
}

/** "today", "tomorrow", or "Wed, Sep 16". */
export function dateLabel(d: Date, now: Date = new Date()): string {
  const key = dayKey(d);
  if (key === dayKey(now)) return 'today';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (key === dayKey(tomorrow)) return 'tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The date a label names (today, tomorrow, "Wed, Sep 16", with or
 *  without a leading "on"); null for free text the picker cannot place. */
export function parseDateLabel(label: string, now: Date = new Date()): Date | null {
  const s = label.trim().toLowerCase();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (s === 'today') return base;
  if (s === 'tomorrow') return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1);
  const rest = label.trim().replace(/^on\s+/i, '');
  // Only the shape dateLabel writes ("Wed, Sep 16", "Sep 16"): the engine's
  // lenient Date parsing would otherwise place any word on some day.
  if (!/^(?:[a-z]{3,9},?\s+)?[a-z]{3,9}\.?\s+\d{1,2}$/i.test(rest)) return null;
  const parsed = new Date(`${rest} ${now.getFullYear()} 12:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const d = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  // "Jan 3" written in December means next January.
  if (d.getTime() < base.getTime() - 180 * 86_400_000) d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** A box's text without its guillemets and padding. */
export function fieldValue(token: string): string {
  return token.slice(1, -1).replace(/ /g, ' ').trim();
}

/** Which picker a value box gets. */
export function fieldKind(value: string): 'date' | 'time' {
  return TIME_RE.test(value.trim()) ? 'time' : 'date';
}

/** Defaults: today at the next whole hour (tomorrow when that hour is past
 *  midnight). A day picked on the calendar other than today: that day at
 *  9 AM. `day` is "YYYY-MM-DD". The subject box starts empty. */
export function buildReminderTemplate(opts: { day?: string; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  let date: string;
  let time: string;
  if (!opts.day || opts.day === dayKey(now)) {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    date = dateLabel(next, now);
    time = timeLabel(next.getHours() * 60);
  } else {
    date = dateLabel(new Date(`${opts.day}T12:00:00`), now);
    time = '9 AM';
  }
  return `${TEMPLATE_LEAD}${subjectBox()} ${field(date)} at ${field(time)}`;
}

export function hasBlanks(text: string): boolean {
  return text.includes(FIELD_OPEN) || text.includes(SUBJECT_OPEN);
}

const ranges = (text: string, re: RegExp): Array<[number, number]> =>
  [...text.matchAll(re)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);

/** Every box, subject and values, in order (what the mirror draws). */
export function slotRanges(text: string): Array<[number, number]> {
  return ranges(text, BOX_RE);
}

/** Only the value boxes: the ones a click opens a picker for. */
export function fieldRanges(text: string): Array<[number, number]> {
  return ranges(text, FIELD_RE);
}

/** The text inside a box: past its marker and padding on each side. Tab
 *  and clicks select this, never the box itself, so typing replaces the
 *  value and the box stays. */
export function boxContent(range: [number, number]): [number, number] {
  return [range[0] + 2, range[1] - 2];
}

/** The value boxes' inner text, in order. */
export function fieldContentRanges(text: string): Array<[number, number]> {
  return fieldRanges(text).map(boxContent);
}

/** The subject box, or null. */
export function subjectRange(text: string): [number, number] | null {
  return ranges(text, SUBJECT_RE)[0] ?? null;
}

/** Where typed text lives inside the subject box (between its padding). */
export function subjectContentRange(text: string): [number, number] | null {
  const box = subjectRange(text);
  return box ? boxContent(box) : null;
}

/** Plain runs and boxes in order, for the mirror to draw. */
export function templateSegments(text: string): Array<{ text: string; slot: boolean; field: boolean; start: number; end: number }> {
  const out: Array<{ text: string; slot: boolean; field: boolean; start: number; end: number }> = [];
  let last = 0;
  for (const [a, b] of slotRanges(text)) {
    if (a > last) out.push({ text: text.slice(last, a), slot: false, field: false, start: last, end: a });
    out.push({ text: text.slice(a, b), slot: true, field: text[a] === FIELD_OPEN, start: a, end: b });
    last = b;
  }
  if (last < text.length) out.push({ text: text.slice(last), slot: false, field: false, start: last, end: text.length });
  return out;
}

type Stop = { at: [number, number]; region: [number, number] };

/** Tab stops: the subject box (caret after its text), each value box
 *  (selected), and the Details line (caret at its end) once it exists. */
export function templateStops(text: string): Stop[] {
  const stops: Stop[] = [];
  const content = subjectContentRange(text);
  const box = subjectRange(text);
  if (content && box) stops.push({ at: [content[1], content[1]], region: box });
  const details = text.lastIndexOf(`\n${DETAILS_LABEL}`);
  const limit = details >= 0 ? details : text.length;
  for (const r of fieldRanges(text)) {
    // Stop on the text inside the box, so typing swaps the value and
    // leaves the box, the way the subject box behaves.
    if (r[1] <= limit) stops.push({ at: boxContent(r), region: r });
  }
  if (details >= 0) {
    const start = details + 1 + DETAILS_LABEL.length;
    const next = text.indexOf('\n', start);
    const end = next < 0 ? text.length : next;
    stops.push({ at: [end, end], region: [start, end] });
  }
  return stops;
}

/** Where Tab (or Shift+Tab) goes from the current selection; null past the
 *  last stop (Tab then adds the Details line) or before the first. */
export function nextSlot(text: string, selStart: number, selEnd: number, backwards = false): [number, number] | null {
  const stops = templateStops(text);
  const current = stops.findIndex(({ region: [a, b] }) => selStart >= a && selEnd <= b);
  if (current >= 0) return (backwards ? stops[current - 1] : stops[current + 1])?.at ?? null;
  if (backwards) return [...stops].reverse().find(({ region: [, b] }) => b <= selStart)?.at ?? null;
  return stops.find(({ region: [a] }) => a >= selEnd)?.at ?? null;
}

/** Where the caret goes to type the subject: after whatever is in the box. */
export function subjectCaret(text: string): number | null {
  const content = subjectContentRange(text);
  return content ? content[1] : null;
}

/** A caret dropped on the subject box's padding belongs in its text. */
export function clampIntoSubject(text: string, pos: number): number | null {
  const box = subjectRange(text);
  const content = subjectContentRange(text);
  if (!box || !content) return null;
  if (pos <= box[0] || pos >= box[1]) return null;
  if (pos < content[0]) return content[0];
  if (pos > content[1]) return content[1];
  return null;
}

/** True while the subject box is still empty. */
export function missingSubject(text: string): boolean {
  const content = subjectContentRange(text);
  return !!content && !text.slice(content[0], content[1]).trim();
}

/** The message as sent: every box becomes its text ("on" put back before a
 *  written-out date), an empty Details line goes, doubled spaces collapse. */
export function finalizeReminderTemplate(text: string): string {
  return text
    .replace(/\n?[ \t]*Details:[ \t ]*$/i, '')
    .replace(SUBJECT_RE, (_m: string, inner: string) => inner.replace(/ /g, ' ').trim())
    .replace(FIELD_RE, (_m: string, inner: string) => {
      const value = inner.replace(/ /g, ' ').trim();
      if (parseTimeLabel(value) != null) return value;
      return /^(today|tomorrow|tonight)$/i.test(value) || /^on\s/i.test(value) ? value : `on ${value}`;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
