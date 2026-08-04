// Soul.exe reminders REST client.
//
// Soul.exe (the local Python server on :8765) keeps an authoritative list
// of reminders in reminders.json next to the server. The LLM can mutate
// it via tool calls (create_event_reminder / update_reminder / etc) and
// the UI can mutate it directly via these endpoints. The two paths share
// the same on-disk store so the LLM and the UI stay consistent.
//
// All requests are forwards-compatible: if the running soul build doesn't
// have the /reminders endpoints (older deploys), every helper resolves to
// `null` / empty list / a no-op error string. The Reminders panel uses
// that signal to silently hide itself rather than spamming the console.

import { getSoulBaseUrl } from './soulBase';

export interface Reminder {
  id: string;
  title: string;
  /** ISO 8601 timestamp ("2026-05-04T15:00:00") or date-only
   *  ("2026-05-04") when no time was given, or empty string. */
  when_iso: string;
  /** Optional place the event happens: "Dr. Lim's office", "Zoom",
   *  "123 Main St", "kitchen". Empty string when unspecified.
   *  Soul-side schema gained this field 2026-05-27; older soul
   *  builds return reminders without it, treat missing as "". */
  location?: string;
  notes: string;
  created_at: string;
  /** ISO timestamp once marked complete; null while still active. */
  completed_at: string | null;
}

/** Result wrapper that distinguishes "endpoint missing" from "endpoint errored". */
export interface RemindersListResult {
  /** True only when the /reminders endpoint exists on this soul build. */
  available: boolean;
  reminders: Reminder[];
  /** Human-readable error string when available is true but the call failed. */
  error?: string;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch the current reminders list. Returns `available: false` (without
 * logging) when the server is an older soul without the endpoint, so the
 * UI can hide the panel cleanly.
 */
export async function listReminders(): Promise<RemindersListResult> {
  let res: Response;
  try {
    res = await fetch(`${getSoulBaseUrl()}/reminders`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return {
      available: false,
      reminders: [],
      error: `network: ${(err as Error).message}`,
    };
  }
  if (res.status === 404) {
    // Soul is up but doesn't expose /reminders. Hide the UI.
    return { available: false, reminders: [] };
  }
  if (!res.ok) {
    return {
      available: true,
      reminders: [],
      error: `soul /reminders ${res.status}`,
    };
  }
  const body = await safeJson<{ reminders: Reminder[] }>(res);
  return {
    available: true,
    reminders: Array.isArray(body?.reminders) ? body!.reminders : [],
  };
}

export interface ReminderInput {
  title: string;
  when_iso?: string;
  /** Optional place the event happens. Empty string allowed. */
  location?: string;
  notes?: string;
}

export async function createReminder(input: ReminderInput): Promise<Reminder | null> {
  const res = await fetch(`${getSoulBaseUrl()}/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      when_iso: input.when_iso ?? '',
      location: input.location ?? '',
      notes: input.notes ?? '',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return await safeJson<Reminder>(res);
}

export async function updateReminder(
  id: string,
  patch: Partial<ReminderInput>,
): Promise<Reminder | null> {
  const res = await fetch(`${getSoulBaseUrl()}/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return await safeJson<Reminder>(res);
}

export async function deleteReminder(id: string): Promise<boolean> {
  const res = await fetch(`${getSoulBaseUrl()}/reminders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(15000),
  });
  return res.ok || res.status === 204;
}

export async function completeReminder(id: string): Promise<Reminder | null> {
  const res = await fetch(
    `${getSoulBaseUrl()}/reminders/${encodeURIComponent(id)}/complete`,
    { method: 'POST', signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) return null;
  return await safeJson<Reminder>(res);
}
