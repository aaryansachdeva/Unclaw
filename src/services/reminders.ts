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

const SOUL_URL = 'http://127.0.0.1:8765';

export interface Reminder {
  id: string;
  title: string;
  /** ISO 8601 timestamp ("2026-05-04T15:00:00") or empty string. */
  when_iso: string;
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
    res = await fetch(`${SOUL_URL}/reminders`, { method: 'GET' });
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
  notes?: string;
}

export async function createReminder(input: ReminderInput): Promise<Reminder | null> {
  const res = await fetch(`${SOUL_URL}/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      when_iso: input.when_iso ?? '',
      notes: input.notes ?? '',
    }),
  });
  if (!res.ok) return null;
  return await safeJson<Reminder>(res);
}

export async function updateReminder(
  id: string,
  patch: Partial<ReminderInput>,
): Promise<Reminder | null> {
  const res = await fetch(`${SOUL_URL}/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  return await safeJson<Reminder>(res);
}

export async function deleteReminder(id: string): Promise<boolean> {
  const res = await fetch(`${SOUL_URL}/reminders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return res.ok || res.status === 204;
}

export async function completeReminder(id: string): Promise<Reminder | null> {
  const res = await fetch(
    `${SOUL_URL}/reminders/${encodeURIComponent(id)}/complete`,
    { method: 'POST' },
  );
  if (!res.ok) return null;
  return await safeJson<Reminder>(res);
}
