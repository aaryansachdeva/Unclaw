// One pipeline for pushing the user's settings blob (profile + roster +
// environment) to soul and to the cloud (2026-09-15).
//
// What it replaces: two independent React effects that each sent
// `{ stale profile snapshot, one fresh field }` as a blind full replace,
// with no queue, no version, no retry and no memory of failure. A
// wardrobe save fired both in the same tick, the loser landed last, and
// the customization "did not save". This module owns the whole write
// path instead:
//
//   * ONE serialized queue. A push requested while one is in flight just
//     marks the next one; the freshest document always goes out last.
//   * The document is built by the caller from LIVE state every time, never
//     from a snapshot captured at sign-in.
//   * soul and cloud are written independently (allSettled): a dead or
//     restarting soul no longer blocks the cloud write.
//   * Versioned cloud writes. The last cloud version we saw rides along as
//     expected_version; a 409 merges the server's roster with ours (local
//     wins per instance id, environment and profile local) and retries once.
//   * A dirty flag persists in localStorage (PENDING_KEY) until the cloud
//     acknowledges, so an offline edit, a quit mid-push or an expired
//     session survives: the next boot's reconcile pushes local instead of
//     hydrating cloud over it.
//   * 401 is reported as "auth lost" rather than swallowed, so the app can
//     ask for a sign-in and keep the pending document.

import {
  ConflictError,
  pushCloudSettings,
  saveSettings,
  type CloudSettingsRecord,
  type UserSettings,
} from './userSettings';

const PENDING_KEY = 'unclaw.settingsPending.v1';
const VERSION_KEY = 'unclaw.settingsCloudVersion.v1';

export interface PendingPush {
  settings: UserSettings;
  at: string;
  /** Cloud version the document was based on (for the 409 merge). */
  baseVersion: number | null;
  /** Whose document this is; a different account signing in must not push it. */
  accountId: string | null;
}

export type SyncStatus = 'idle' | 'pushing' | 'pending' | 'auth-lost' | 'error';

type Listener = (status: SyncStatus, detail?: string) => void;

let status: SyncStatus = 'idle';
let detail: string | undefined;
const listeners = new Set<Listener>();
let inflight: Promise<void> | null = null;
let queued: { settings: UserSettings; token: string | null; accountId: string | null } | null = null;
let cloudVersion: number | null = readVersion();

function setStatus(next: SyncStatus, d?: string) {
  status = next; detail = d;
  for (const l of listeners) l(next, d);
}

export function getSyncStatus(): { status: SyncStatus; detail?: string } {
  return { status, detail };
}

export function onSyncStatus(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function readVersion(): number | null {
  try {
    const raw = localStorage.getItem(VERSION_KEY);
    return raw ? Number(raw) : null;
  } catch { return null; }
}

/** Remember the cloud version we last saw (reconcile or push result). */
export function noteCloudVersion(record: CloudSettingsRecord | null): void {
  cloudVersion = record ? record.version : null;
  try {
    if (cloudVersion == null) localStorage.removeItem(VERSION_KEY);
    else localStorage.setItem(VERSION_KEY, String(cloudVersion));
  } catch { /* storage unavailable */ }
}

export function noteCloudVersionNumber(v: number | null): void {
  cloudVersion = v;
  try {
    if (v == null) localStorage.removeItem(VERSION_KEY);
    else localStorage.setItem(VERSION_KEY, String(v));
  } catch { /* storage unavailable */ }
}

export function readPending(): PendingPush | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingPush) : null;
  } catch { return null; }
}

function writePending(p: PendingPush | null): void {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage unavailable */ }
}

export function clearPending(): void {
  writePending(null);
  if (status === 'pending') setStatus('idle');
}

/** Merge the server's record with ours after a 409: our profile and
 *  environment win outright (they are single-writer here); the roster is
 *  merged by instance id so an instance added on another device is kept,
 *  while every instance we hold keeps OUR wardrobe. Order follows ours. */
export function mergeOnConflict(mine: UserSettings, theirs: UserSettings): UserSettings {
  const mineRoster = Array.isArray(mine.roster) ? mine.roster : [];
  const theirRoster = Array.isArray(theirs.roster) ? theirs.roster : [];
  const ids = new Set(mineRoster.map((i) => i.id));
  const extra = theirRoster.filter((i) => !ids.has(i.id));
  return { ...theirs, ...mine, roster: [...mineRoster, ...extra] };
}

async function pushOnce(settings: UserSettings, token: string | null, accountId: string | null): Promise<void> {
  setStatus('pushing');
  writePending({ settings, at: new Date().toISOString(), baseVersion: cloudVersion, accountId });

  // soul mirror (local read path for the LLM) and cloud write in parallel;
  // neither blocks the other.
  const soulP = saveSettings(settings);
  const cloudP: Promise<CloudSettingsRecord | null> = token
    ? (async () => {
        try {
          const r = await pushCloudSettings(token, settings, cloudVersion ?? undefined);
          return r.record;
        } catch (err) {
          if (err instanceof ConflictError && err.current) {
            const merged = mergeOnConflict(settings, err.current.settings);
            const r = await pushCloudSettings(token, merged, err.current.version);
            // The merged document is the truth now; mirror it locally too.
            void saveSettings(merged).catch(() => {});
            return r.record;
          }
          throw err;
        }
      })()
    : Promise.resolve(null);

  const [soulRes, cloudRes] = await Promise.allSettled([soulP, cloudP]);
  if (soulRes.status === 'rejected') {
    console.warn('[settings] soul mirror failed', soulRes.reason);
  }
  if (!token) {
    // Signed out: nothing to acknowledge in the cloud; keep the flag so a
    // later sign-in pushes this document up instead of pulling cloud down.
    setStatus('pending', 'signed out');
    return;
  }
  if (cloudRes.status === 'fulfilled') {
    noteCloudVersion(cloudRes.value);
    writePending(null);
    setStatus('idle');
    return;
  }
  const msg = String((cloudRes.reason as Error)?.message ?? cloudRes.reason);
  if (/\b401\b/.test(msg)) {
    setStatus('auth-lost', msg);
  } else {
    setStatus('error', msg);
  }
  console.warn('[settings] cloud push failed; kept as pending', msg);
}

/** Queue a push of the given document. Coalesces: the freshest document
 *  requested while a push is in flight is the one that goes next. */
export function requestPush(settings: UserSettings, token: string | null, accountId: string | null = null): Promise<void> {
  queued = { settings, token, accountId };
  if (inflight) return inflight;
  inflight = (async () => {
    while (queued) {
      const job = queued; queued = null;
      try { await pushOnce(job.settings, job.token, job.accountId); }
      catch (err) { console.warn('[settings] push failed', err); setStatus('error', String(err)); }
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Wait for the queue to drain, bounded. Used before sign-out and reset so
 *  a just-made edit is not wiped with its only copy unsent. */
export async function flush(timeoutMs = 4000): Promise<boolean> {
  if (!inflight) return status !== 'pending';
  const done = inflight.then(() => true);
  const timer = new Promise<boolean>((r) => window.setTimeout(() => r(false), timeoutMs));
  return Promise.race([done, timer]);
}

/** Small retry on a schedule: called by App when the network or auth
 *  state changes, and on a slow interval. Only re-sends if something is
 *  pending and we are not already pushing. */
export function retryPending(token: string | null, accountId: string | null): void {
  const p = readPending();
  if (!p || inflight || !token) return;
  if (p.accountId && accountId && p.accountId !== accountId) { writePending(null); return; }
  void requestPush(p.settings, token, accountId ?? p.accountId);
}
