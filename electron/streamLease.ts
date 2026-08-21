// Stream lease: who owns Unreal's frames right now.
//
// Unclaw renders to exactly ONE place at a time. On this Mac that is normally
// the direct IOSurface path (zero-copy, no encoder). When a remote viewer
// attaches — Unclaw Mobile today, a VS Code panel later — it takes the lease,
// the desktop releases the surface, and Unreal's frames flow to the H.264
// encoder instead. When the remote leaves, the desktop takes the lease back.
//
// The engine side of this already exists and needs no change. From
// MacBackBufferProducer.cpp:
//
//     // A local viewer wins outright: hand it the surface and never
//     // touch the encoder.
//     if (Direct->HasClient()) { Direct->Publish(...); return; }
//
// So a direct client attached STARVES the encoder — which is exactly the
// exclusivity we want, just expressed as "whoever holds the surface wins".
// Releasing the direct client is therefore the whole handoff: frames fall
// through to the encoder on the very next presented frame.
//
// WHY POLLING, NOT AN EVENT. soul already knows when a remote player joins
// (cloud_signalling tracks them) and publishes the list on GET /pair/status.
// We poll it rather than adding a push event, for the reason 1.1.9 taught the
// hard way: a missed event leaves the system wrong forever, while a poll
// converges on the next tick. The handoff also overlaps the phone's WebRTC
// handshake (~1s), so a 1s poll costs nothing observable.
import type { BrowserWindow } from 'electron';
import * as directSurface from './directSurface';

export type LeaseHolder = 'local' | 'remote';

const POLL_MS = 1000;

let timer: NodeJS.Timeout | null = null;
let holder: LeaseHolder = 'local';
// Dev override. Lets the whole handoff be exercised on this machine with no
// phone: forcing 'remote' releases the surface exactly as a real viewer would,
// so you can watch the desktop freeze, the overlay appear, and Unreal's frames
// start reaching the H.264 encoder. null = follow soul.
let forced: LeaseHolder | null = null;
let onChange: ((h: LeaseHolder, players: string[]) => void) | null = null;
let soulPort: (() => number | null) | null = null;
let getWindow: (() => BrowserWindow | null) | null = null;

async function pollOnce(): Promise<void> {
  const port = soulPort?.();
  if (!port) return;
  let players: string[] = [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pair/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return; // soul restarting; keep the current lease
    const body = (await res.json()) as { active_players?: string[] };
    players = Array.isArray(body.active_players) ? body.active_players : [];
  } catch {
    return; // transient; a dropped poll must never flip the lease
  }

  const want: LeaseHolder = forced ?? (players.length > 0 ? 'remote' : 'local');
  if (want === holder) return;

  holder = want;
  if (want === 'remote') {
    // ORDER MATTERS. Tell the renderer FIRST so it can snapshot the picture
    // while frames are still live, and only then release the surface.
    //
    // detach() sends `direct-surface:reset`, whose handler does
    // videoEl.remove() — it deletes the element the snapshot is taken FROM.
    // Detaching first meant freezeForLease() found no video, returned early,
    // and the desktop showed live motion under the overlay instead of a
    // frozen frame. Cost three failed attempts to find.
    console.log(`[lease] remote viewer (${players.join(', ')}) — freezing, then releasing`);
    onChange?.(holder, players);
    // Give the freeze a beat to land before the element is torn down. The
    // snapshot itself is one drawImage; this is IPC latency, not work.
    await new Promise((r) => setTimeout(r, 150));
    directSurface.detach();
    return;
  }
  if (want === 'local') {
    console.log('[lease] remote viewer gone — reclaiming the direct path');
    const win = getWindow?.();
    // No window means the app is shutting down or mid-recreate; the next tick
    // reclaims once one exists, so leaving the lease on 'local' is correct.
    if (win) directSurface.attach(win);
  }
  onChange?.(holder, players);
}

/** Begin arbitrating. `getSoulPort` is read per tick so a soul restart on a
 *  new dynamic port is picked up without restarting the lease. */
export function start(
  getSoulPort: () => number | null,
  win: () => BrowserWindow | null,
  changed: (h: LeaseHolder, players: string[]) => void,
): void {
  if (timer) return;
  soulPort = getSoulPort;
  getWindow = win;
  onChange = changed;
  timer = setInterval(() => { void pollOnce(); }, POLL_MS);
}

export function stop(): void {
  if (timer) { clearInterval(timer); timer = null; }
  soulPort = null;
  getWindow = null;
  onChange = null;
}

export function current(): LeaseHolder {
  return holder;
}

/** Pin the lease for testing, or pass null to follow soul again. Applied on
 *  the next poll tick so it goes through exactly the same transition path a
 *  real viewer would. */
export async function force(next: LeaseHolder | null): Promise<LeaseHolder> {
  forced = next;
  // Awaited: force() used to return the PREVIOUS holder because pollOnce is
  // async, so asking for 'remote' printed "stream lease: local" and looked
  // like the call had failed.
  await pollOnce();
  return holder;
}
