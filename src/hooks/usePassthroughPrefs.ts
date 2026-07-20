import { useCallback, useSyncExternalStore } from 'react';
import { getSoulBaseUrl } from '../services/soulBase';

// Passthrough speech preferences , talkativeness + mute , set from the
// UnClaw UI while in passthrough mode. Device-local (localStorage) so it
// survives reloads, and mirrored to soul on every change so the external
// coding agent can read the live value (soul echoes it on each speak
// response + serves it from GET /passthrough/prefs).
//
// Backed by a MODULE-LEVEL store (not per-hook useState) so every consumer
// , the passthrough bar's inline control, the Settings panel, and App's
// bridge ref , share one source of truth and re-render together. Without
// this, changing talkativeness in Settings wouldn't reach the bar or the
// bridge until reload.
//
// Two-sided enforcement:
//   * soul short-circuits speak when muted (agent learns it, no broadcast).
//   * the renderer's passthrough bridge caps its play-queue by verbosity
//     and drops incoming speaks when muted , the hard guarantee even if a
//     chatty agent ignores the hint.

const KEY = 'unclaw.passthrough.v1';

export type Verbosity = 'quiet' | 'balanced' | 'chatty';

export interface PassthroughPrefs {
  verbosity: Verbosity;
  muted: boolean;
}

const DEFAULTS: PassthroughPrefs = { verbosity: 'balanced', muted: false };

/** Max queued-but-unplayed speaks the bridge keeps per verbosity. Older
 *  lines beyond the cap are dropped (drop-oldest) so the avatar stays
 *  current with the agent instead of lagging. quiet also throttles volume. */
export const VERBOSITY_QUEUE_CAP: Record<Verbosity, number> = {
  quiet: 1,
  balanced: 3,
  chatty: 10,
};

function loadInitial(): PassthroughPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PassthroughPrefs>;
      if (v && typeof v === 'object') {
        return {
          verbosity: (['quiet', 'balanced', 'chatty'] as const).includes(v.verbosity as Verbosity)
            ? (v.verbosity as Verbosity)
            : DEFAULTS.verbosity,
          muted: typeof v.muted === 'boolean' ? v.muted : DEFAULTS.muted,
        };
      }
    }
  } catch { /* corrupt / unavailable -> defaults */ }
  return { ...DEFAULTS };
}

// --- module-level store ---------------------------------------------------

let state: PassthroughPrefs = loadInitial();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist(next: PassthroughPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch { /* private mode / quota -> just won't persist */ }
  // Mirror to soul so the external agent sees the live prefs. Best-effort:
  // if soul is down the local value still governs the bridge.
  void fetch(`${getSoulBaseUrl()}/passthrough/prefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  }).catch(() => { /* soul offline , local value still applies */ });
}

/** Merge a partial update, persist + mirror to soul, notify subscribers. */
export function updatePassthroughPrefs(patch: Partial<PassthroughPrefs>) {
  const next = { ...state, ...patch };
  if (next.verbosity === state.verbosity && next.muted === state.muted) return;
  state = next;
  persist(state);
  emit();
}

/** Non-reactive read (for imperative callers). */
export function getPassthroughPrefs(): PassthroughPrefs {
  return state;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function usePassthroughPrefs() {
  const prefs = useSyncExternalStore(subscribe, getPassthroughPrefs, getPassthroughPrefs);
  const setPrefs = useCallback((patch: Partial<PassthroughPrefs>) => updatePassthroughPrefs(patch), []);
  const setVerbosity = useCallback((verbosity: Verbosity) => updatePassthroughPrefs({ verbosity }), []);
  const toggleMuted = useCallback(() => updatePassthroughPrefs({ muted: !state.muted }), []);
  return { prefs, setPrefs, setVerbosity, toggleMuted };
}
