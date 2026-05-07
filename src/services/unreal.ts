// Client for soul's /unreal/{status,restart} endpoints.
//
// soul autolaunches the Unreal pixel-streaming game on startup; this
// service is what the renderer uses to recover from a crashed game
// without the user having to bounce all of soul. Status polling drives
// the loading-screen overlay (subtle "restart" link while waiting,
// prominent "Engine stopped — Restart" when state goes red).

const SOUL_URL = 'http://127.0.0.1:8765';

export type UnrealState =
  | 'idle'      // env var unset; game was never launched
  | 'launching' // spawn requested, not yet alive
  | 'running'   // process up
  | 'crashed'   // spawn failed or process exited rc != 0
  | 'exited';   // process exited cleanly

export interface UnrealStatus {
  state: UnrealState;
  error: string | null;
  exe: string | null;
  pid: number | null;
  uptime_s: number | null;
  log_dir: string;
}

export async function fetchUnrealStatus(): Promise<UnrealStatus | null> {
  try {
    const r = await fetch(`${SOUL_URL}/unreal/status`);
    if (!r.ok) return null;
    return (await r.json()) as UnrealStatus;
  } catch {
    return null;
  }
}

/** Stops the running game (if any) and re-launches it. Returns the
 *  post-restart status, or null on network error. */
export async function restartUnreal(): Promise<UnrealStatus | null> {
  try {
    const r = await fetch(`${SOUL_URL}/unreal/restart`, { method: 'POST' });
    if (!r.ok) return null;
    return (await r.json()) as UnrealStatus;
  } catch {
    return null;
  }
}
