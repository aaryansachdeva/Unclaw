// Cloud chat-history sync. Chat is per-instance and lives in localStorage under
// `unclaw.chat.<instanceId>` keys (see hooks/useChatMemory). Unlike the profile,
// it doesn't fit the 32KB UserSettings blob, so it gets its own account-scoped
// store on the store Worker (GET/PUT/DELETE /user_chat). API keys are still
// never synced; this is just conversation history following the account.
//
// Wire format: a single JSON object mapping instanceId -> Turn[]. We gather it
// from localStorage on push and write it back on restore.

const STORE_URL = 'https://store.unclaw.io';
const CHAT_PREFIX = 'unclaw.chat.';
// Set the moment local chat changes, cleared only when the cloud says 200
// (2026-09-15). Before this, a push that failed (or never fired because the
// app quit inside the debounce) was forgotten, and the next sign-in restored
// the cloud copy over the newer local turns. With the flag, reconcile merges
// local over cloud and pushes instead.
const DIRTY_KEY = 'unclaw.chatPending.v1';

export function markChatDirty(): void {
  try { localStorage.setItem(DIRTY_KEY, new Date().toISOString()); } catch { /* ignore */ }
}

export function isChatDirty(): boolean {
  try { return localStorage.getItem(DIRTY_KEY) != null; } catch { return false; }
}

function clearChatDirty(): void {
  try { localStorage.removeItem(DIRTY_KEY); } catch { /* ignore */ }
}

/** Local wins for every instance it holds (those are the turns the cloud
 *  never acknowledged); instances only the cloud knows are kept. */
export function mergeChat(local: CloudChatMap, cloud: CloudChatMap | null): CloudChatMap {
  return { ...(cloud ?? {}), ...local };
}

/** The blob shape persisted to the cloud: instanceId -> serialized turns. The
 *  turns are whatever useChatMemory already wrote to localStorage (images are
 *  stripped there), so we treat them as opaque JSON and don't re-validate. */
export type CloudChatMap = Record<string, unknown[]>;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Collect every `unclaw.chat.<id>` entry from localStorage into one map.
 *  Skips empty/corrupt entries so we never push junk. */
export function gatherLocalChat(): CloudChatMap {
  const out: CloudChatMap = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(CHAT_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          out[key.slice(CHAT_PREFIX.length)] = parsed;
        }
      } catch { /* skip corrupt entry */ }
    }
  } catch { /* localStorage unavailable */ }
  return out;
}

/** Replace the machine's local chat with a cloud map: wipe existing
 *  `unclaw.chat.*` keys, then write each instance's history back. Callers that
 *  have mounted useChatMemory should bump its reload token afterwards so the
 *  visible conversation refreshes. */
export function restoreLocalChat(map: CloudChatMap | null | undefined): void {
  try {
    // Clear current chat keys first so a stale instance's history can't linger.
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CHAT_PREFIX)) stale.push(key);
    }
    stale.forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

    if (!map) return;
    for (const [instanceId, turns] of Object.entries(map)) {
      if (!Array.isArray(turns) || turns.length === 0) continue;
      try { localStorage.setItem(CHAT_PREFIX + instanceId, JSON.stringify(turns)); }
      catch { /* quota -> skip this instance */ }
    }
  } catch { /* localStorage unavailable */ }
}

/** GET /user_chat — the account's cloud chat map, or null when none saved (or
 *  the token expired / the endpoint isn't deployed yet). Never throws; chat
 *  sync is best-effort and must not block sign-in. */
export async function fetchCloudChat(token: string): Promise<CloudChatMap | null> {
  try {
    const res = await fetch(`${STORE_URL}/user_chat`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { chat?: CloudChatMap | null };
    return data.chat ?? null;
  } catch (err) {
    console.warn('[chatSync] cloud fetch failed', err);
    return null;
  }
}

/** PUT /user_chat, push the local chat map. Never throws (a flaky network
 *  must not disrupt the conversation) but reports the outcome and keeps the
 *  dirty flag until the cloud acknowledges. */
export async function pushCloudChat(token: string, map: CloudChatMap): Promise<boolean> {
  try {
    const res = await fetch(`${STORE_URL}/user_chat`, {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: map }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn('[chatSync] cloud push refused', res.status);
      return false;
    }
    clearChatDirty();
    return true;
  } catch (err) {
    console.warn('[chatSync] cloud push failed (kept as pending)', err);
    return false;
  }
}

/** DELETE /user_chat — drop the account's cloud chat. Used by the account-reset
 *  flow. Best-effort. */
export async function deleteCloudChat(token: string): Promise<void> {
  try {
    await fetch(`${STORE_URL}/user_chat`, {
      method: 'DELETE',
      headers: authHeaders(token),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* best-effort */ }
}
