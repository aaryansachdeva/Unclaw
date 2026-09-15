// The reminder template the Reminders glance drops into the input bar in
// place of a form: "Add a reminder for ⟨something⟩ at ⟨a time⟩". Each
// ⟨hint⟩ is a blank: the input bar's mirror draws it as a soft block with
// the hint inside (the angle brackets are painted transparent and act as
// the block's padding). Typing replaces the whole blank, Tab selects the
// next one, and once none are left Tab adds "Details: ⟨anything else⟩". The
// message then goes to the chat like any other; the reminder tool stores
// the details as the reminder's notes (soul's create_event_reminder says so).

export const SLOT_OPEN = '⟨';
export const SLOT_CLOSE = '⟩';
export const DETAILS_LABEL = 'Details:';
const SLOT_RE = /⟨[^⟨⟩\n]*⟩/g;

export const slot = (hint: string) => `${SLOT_OPEN}${hint}${SLOT_CLOSE}`;
export const DETAILS_LINE = `${DETAILS_LABEL} ${slot('anything else')}`;

/** `day` is a "YYYY-MM-DD" picked on the calendar; `today` the same for now. */
export function buildReminderTemplate(day?: string, today?: string): string {
  const when = !day
    ? ''
    : day === today
      ? ' today'
      : ` on ${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  return `Add a reminder for ${slot('something')}${when} at ${slot('a time')}`;
}

export function slotRanges(text: string): Array<[number, number]> {
  return [...text.matchAll(SLOT_RE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

/** Plain runs and blanks in order, for the mirror to draw. */
export function templateSegments(text: string): Array<{ text: string; slot: boolean; start: number; end: number }> {
  const out: Array<{ text: string; slot: boolean; start: number; end: number }> = [];
  let last = 0;
  for (const [a, b] of slotRanges(text)) {
    if (a > last) out.push({ text: text.slice(last, a), slot: false, start: last, end: a });
    out.push({ text: text.slice(a, b), slot: true, start: a, end: b });
    last = b;
  }
  if (last < text.length) out.push({ text: text.slice(last), slot: false, start: last, end: text.length });
  return out;
}

/** The blank to select on Tab (after `from`) or Shift+Tab (before `from`),
 *  wrapping around; null when no blanks are left. */
export function nextSlot(text: string, from: number, backwards = false): [number, number] | null {
  const slots = slotRanges(text);
  if (slots.length === 0) return null;
  if (backwards) {
    const prev = [...slots].reverse().find(([, end]) => end <= from);
    return prev ?? slots[slots.length - 1];
  }
  return slots.find(([start]) => start >= from) ?? slots[0];
}

/** True while the "what" blank is still empty: nothing worth sending. */
export function missingSubject(text: string): boolean {
  return /\bfor\s+⟨/i.test(text);
}

/** The message as sent: unfilled blanks and the words leading into them
 *  drop out ("at ⟨a time⟩" with no time), an empty Details line goes. */
export function finalizeReminderTemplate(text: string): string {
  return text
    .replace(/\n?[ \t]*Details:[ \t]*(⟨[^⟨⟩\n]*⟩)?[ \t]*$/i, '')
    .replace(/[ \t]+(at|on|for|by|about)[ \t]+⟨[^⟨⟩\n]*⟩/gi, '')
    .replace(SLOT_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
