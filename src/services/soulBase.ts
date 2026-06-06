// Single source of truth for the URLs every service module uses to
// talk to soul + the signalling server. Replaces the ~15 copies of
// `const SOUL_URL = 'http://127.0.0.1:8765'` that used to sit at the
// top of each service file, those couldn't follow soul's switch to
// OS-picked dynamic ports (port 0 → soul picks → renderer needs to
// learn the actual port via IPC).
//
// Initialization order:
//   1. App.tsx awaits `initSoulBase()` BEFORE mounting the
//      pixel-streaming hook or any service that builds a soul URL.
//   2. initSoulBase queries the supervisor (which already has the
//      ports from soul's [ports] banner OR ports.json fallback) and
//      caches them at module scope. Returns immediately if the
//      cache is already populated.
//   3. Every getSoulBaseUrl() / getSignallingPlayerUrl() call returns
//      from the cache synchronously, no per-request IPC.
//
// Restart safety: if soul respawns mid-session, supervisor.startSoul
// resets livePorts to null and re-fires 'soul:ports' once the new
// banner arrives. App-level code that subscribes to 'soul:ports' via
// `subscribeSoulPorts` will get the new mapping and can refresh its
// own URL cache.

import type { SoulPorts } from '../env';

const FALLBACK_PORTS: SoulPorts = {
  // Legacy defaults. Only hit when the IPC bridge isn't available
  // (test harness, very early boot before initSoulBase resolved). In
  // a normal run these are immediately overwritten on the first
  // window.electronAPI.soul.getPorts() resolution.
  http: 8765,
  signallingStreamer: 8888,
  signallingPlayer: 8080,
};

let cached: SoulPorts | null = null;
let initPromise: Promise<SoulPorts> | null = null;

function readWindowElectronAPI(): typeof window.electronAPI | null {
  if (typeof window === 'undefined') return null;
  return window.electronAPI ?? null;
}

/** Resolve soul's live ports via IPC and cache for synchronous getters.
 *  Idempotent, calling concurrently returns the same in-flight
 *  promise. Defensive, non-Electron environments (Vite preview, unit
 *  tests) fall back to the legacy defaults so the rest of the app
 *  doesn't deadlock. */
export async function initSoulBase(): Promise<SoulPorts> {
  if (cached) return cached;
  if (initPromise) return initPromise;
  const api = readWindowElectronAPI();
  if (!api?.soul?.getPorts) {
    // No Electron bridge, fall through to legacy. Caller is
    // probably running outside the desktop app (a unit test or a
    // dev preview against a hand-started soul on the legacy ports).
    cached = FALLBACK_PORTS;
    return cached;
  }
  initPromise = (async () => {
    try {
      const ports = await api.soul.getPorts();
      cached = ports ?? FALLBACK_PORTS;
    } catch {
      cached = FALLBACK_PORTS;
    } finally {
      initPromise = null;
    }
    return cached!;
  })();
  return initPromise;
}

/** Subscribe to live port updates. The supervisor re-emits when soul
 *  respawns, so consumers that want to invalidate their own caches on
 *  a soul restart can hook this. Returns unsubscribe. */
export function subscribeSoulPorts(
  cb: (ports: SoulPorts) => void,
): (() => void) {
  const api = readWindowElectronAPI();
  if (!api?.soul?.onPorts) return () => undefined;
  return api.soul.onPorts((p) => {
    cached = p;
    cb(p);
  });
}

/** HTTP base URL for soul (no trailing slash). Safe to call
 *  synchronously AFTER `initSoulBase` has resolved. Before that, it
 *  returns the legacy fallback so calls during the very first render
 *  don't crash, those requests will fail loud against the real soul
 *  if the port differs, which is the correct signal that initSoulBase
 *  needs to run earlier. */
export function getSoulBaseUrl(): string {
  const p = cached ?? FALLBACK_PORTS;
  return `http://127.0.0.1:${p.http}`;
}

/** Player-side signalling WebSocket URL (the renderer connects here
 *  as the WebRTC peer). Same lazy semantics as getSoulBaseUrl. */
export function getSignallingPlayerUrl(): string {
  const p = cached ?? FALLBACK_PORTS;
  return `ws://127.0.0.1:${p.signallingPlayer}`;
}
