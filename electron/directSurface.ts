// Direct IOSurface display: Unreal's frame straight onto a CALayer behind the
// web content, with no encode, no transport and no decode.
//
// Opt-in via UNCLAW_DIRECT_SURFACE=1. Off, nothing here runs and the app is
// byte-for-byte the WebRTC build it is today. That matters more than the
// feature does: this path depends on Unreal being started as a launchd job
// (see soul/mac_launchd.py), and on a native addon that has to be compiled for
// the exact Electron ABI. Any of that missing must cost the acceleration and
// nothing else.
//
// The window has to be created transparent for the layer to be visible, and
// transparency is not something Electron can toggle later, so `isEnabled()` is
// read at window-construction time as well as here.

import type { BrowserWindow } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface DirectSurfaceStats {
  connected: boolean;
  frames: number;
  gaps: number;
  fps: number;
  surfaces: number;
}

interface FrameInfo {
  /** Raw IOSurfaceRef pointer bytes; exactly what Electron's
   *  sharedTexture.importSharedTexture expects for handle.ioSurface. */
  ioSurface: Buffer;
  surfaceId: number;
  serial: number;
  width: number;
  height: number;
}

interface Addon {
  start(handle: Buffer, service: string): boolean;
  startFrames(service: string, onFrame: (f: FrameInfo) => void): boolean;
  stop(): boolean;
  stats(): DirectSurfaceStats;
}

let addon: Addon | null = null;
let attached = false;
let poll: NodeJS.Timeout | null = null;
let reloadHandler: (() => void) | null = null;
let reloadTarget: Electron.WebContents | null = null;

export function isEnabled(): boolean {
  return (process.env.UNCLAW_DIRECT_SURFACE === '1'
    || process.env.UNCLAW_DIRECT_SURFACE === '2') && process.platform === 'darwin';
}

/**
 * '1' — legacy: the addon composites frames itself on a CAMetalLayer beneath a
 *       transparent window. Chromium never sees the pixels, so CSS
 *       backdrop-filter cannot blur the character.
 * '2' — shared texture: each frame's IOSurface is imported into Chromium via
 *       Electron's sharedTexture API and shown as in-page content (a <video>
 *       fed by a MediaStreamTrackGenerator by default; WebGPU/canvas
 *       fallbacks live in the preload). One compositor, opaque window, every
 *       CSS effect works, still zero-copy.
 */
export function mode(): '1' | '2' {
  return process.env.UNCLAW_DIRECT_SURFACE === '2' ? '2' : '1';
}

/** Resolve the built addon. Absent in a normal checkout until someone runs the
 *  node-gyp build, which is exactly why this returns null instead of throwing. */
function load(): Addon | null {
  if (addon) return addon;
  const candidates = [
    path.join(__dirname, '../../electron/native/surface_layer/build/Release/surface_layer.node'),
    path.join(__dirname, '../native/surface_layer/build/Release/surface_layer.node'),
    path.join(process.resourcesPath ?? '', 'surface_layer.node'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        addon = require(p) as Addon;
        console.log('[direct] addon loaded from', p);
        return addon;
      }
    } catch (e) {
      console.error('[direct] addon at', p, 'failed to load:', e);
    }
  }
  console.log('[direct] no addon built — staying on the WebRTC path');
  return null;
}

/**
 * Attach the layer to this window and start consuming frames.
 *
 * Safe to call when Unreal is not up yet: the XPC connection simply reports no
 * peer and `connected` stays false, so the renderer keeps showing the WebRTC
 * video until real frames arrive.
 */
/**
 * Mode 2 frame pump. For every frame the addon delivers, import the IOSurface
 * into Chromium (a GPU-process mailbox registration, no pixel copy) and
 * transfer it to the renderer, which draws it onto the stream canvas.
 *
 * Backpressure: sendSharedTexture is async; while one transfer is in flight,
 * newer frames are dropped rather than queued. At 24-27fps a queue could only
 * ever hold stale frames, and the addon already drops at its own end too.
 */
function startFramePump(a: Addon, win: BrowserWindow, service: string): boolean {
  // Lazy require: `sharedTexture` only exists on Electron 37+, and pulling it
  // unconditionally would crash older runtimes at import time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sharedTexture } = require('electron');
  if (!sharedTexture?.importSharedTexture) {
    console.error('[direct] mode 2 requested but electron.sharedTexture is unavailable');
    return false;
  }

  // One import per ring surface for the life of the connection, exactly like
  // mode 1 wraps each surface as a Metal texture once. The first cut imported
  // and transferred EVERY frame (~1600 cycles/min against the same four
  // IOSurfaces) and Chromium's view of them degraded to solid white after
  // about a minute while the source surfaces stayed perfect (mode 1 sampler
  // proved that). Steady state here is: zero imports, zero transfers, one
  // tiny IPC ping per frame telling the renderer which surface just updated.
  const importedIds = new Set<number>();
  const held: { release: () => void }[] = [];

  const ok = a.startFrames(service, (f) => {
    if (win.isDestroyed()) return;
    try {
      if (!importedIds.has(f.surfaceId)) {
        importedIds.add(f.surfaceId);
        const imported = sharedTexture.importSharedTexture({
          textureInfo: {
            codedSize: { width: f.width, height: f.height },
            visibleRect: { x: 0, y: 0, width: f.width, height: f.height },
            pixelFormat: 'bgra',
            // NOTE (2026-08-18): declaring a Display-P3 colorSpace here to
            // reproduce the unmanaged-window vibrancy renders BLACK through
            // the MediaStreamTrackGenerator video path (accepted silently,
            // no errors, pixels gone). The vibrancy match is done in the
            // preload instead: the injected video element gets the same
            // ue-gamut-match feColorMatrix the WebRTC path uses.
            handle: { ioSurface: f.ioSurface },
          },
        });
        // Held for the connection's lifetime: the renderer keeps its
        // reference too, and release happens for both on stop().
        held.push(imported);
        sharedTexture
          .sendSharedTexture({
            frame: win.webContents.mainFrame,
            importedSharedTexture: imported,
          }, { surfaceId: f.surfaceId, width: f.width, height: f.height })
          .then(() => {
            // Only tick AFTER the transfer landed, or the renderer would get
            // pings for a surface it has not received yet. Destruction check
            // repeated here: the promise can resolve mid-window-teardown.
            if (!win.isDestroyed()) {
              win.webContents.send('direct-surface:frame', { surfaceId: f.surfaceId, serial: f.serial });
            }
          })
          .catch((err: unknown) => {
            console.error('[direct] sendSharedTexture failed:', err);
            importedIds.delete(f.surfaceId);
            // The failed import never reached the renderer; drop our
            // reference too, or repeated failures for one surface grow
            // `held` unboundedly, each entry pinning a GPU-process mailbox.
            const i = held.indexOf(imported);
            if (i >= 0) held.splice(i, 1);
            try { imported.release(); } catch { /* already gone */ }
          });
        return;
      }
      win.webContents.send('direct-surface:frame', { surfaceId: f.surfaceId, serial: f.serial });
    } catch (err) {
      console.error('[direct] frame pump error:', err);
    }
  });

  if (ok) {
    framePumpCleanup = () => {
      // Runs from the window's own 'closed' handler during quit, at which
      // point the BrowserWindow is already destroyed and webContents.send
      // THROWS ("Object has been destroyed") — uncaught in main, that put
      // an error dialog over the quit and blocked shutdown (2026-08-17).
      // The renderer is gone anyway; only the GPU-side releases matter.
      try {
        if (!win.isDestroyed()) win.webContents.send('direct-surface:reset');
      } catch { /* window mid-teardown */ }
      for (const h of held) { try { h.release(); } catch { /* gone */ } }
      held.length = 0;
      importedIds.clear();
    };
  }
  return ok;
}

let framePumpCleanup: (() => void) | null = null;

export function attach(win: BrowserWindow): boolean {
  if (!isEnabled() || attached) return false;
  const a = load();
  if (!a) return false;

  const service = process.env.UNCLAW_SURFACE_SERVICE || 'com.fotonlabs.unclaw.surface';

  let ok: boolean;
  if (mode() === '2') {
    ok = startFramePump(a, win, service);
  } else {
    let handle: Buffer;
    try {
      handle = win.getNativeWindowHandle();
    } catch (e) {
      console.error('[direct] no native window handle:', e);
      return false;
    }
    ok = a.start(handle, service);
  }
  console.log('[direct] attach', ok ? 'ok' : 'FAILED', 'mode:', mode(), 'service:', service);
  if (!ok) return false;
  attached = true;

  // Renderer refresh (Cmd+R) destroys the page's imported textures while
  // the pump still believes them delivered (importedIds), so a reloaded
  // page received only pings for surfaces it never got: dark stream until
  // the next UE restart (2026-08-18). Re-arm on every subsequent page
  // load: dropping the held imports makes the pump re-import and
  // re-transfer the ring to the fresh page on its next frames.
  // Registered once per attach and removed in detach(): every lease reclaim
  // calls attach() again, and the old always-add version accumulated one
  // listener per phone/Chrome connect cycle on the same webContents.
  if (reloadHandler && reloadTarget && !reloadTarget.isDestroyed()) {
    reloadTarget.removeListener('did-finish-load', reloadHandler);
  }
  reloadHandler = () => {
    if (attached && framePumpCleanup) {
      console.log('[direct] renderer reloaded — re-transferring surfaces');
      framePumpCleanup();
    }
  };
  reloadTarget = win.webContents;
  win.webContents.on('did-finish-load', reloadHandler);

  // The renderer needs to know when to get out of the way: it hides the video
  // element and drops its background so the layer underneath shows through.
  // Polled rather than pushed from native, because a callback into JS from the
  // XPC queue would need a threadsafe function for no real benefit at 0.5Hz.
  let lastConnected: boolean | null = null;
  let missed = 0;
  let ticks = 0;
  poll = setInterval(() => {
    if (win.isDestroyed()) { detach(); return; }
    const s = a.stats();

    // Once-a-minute heartbeat: fps is the addon's own delivery-rate estimate,
    // the ground truth for "is UE actually pacing at its cap". Transitions
    // alone can't show a drift like the 24-cap/30-fixed-step mismatch did.
    if (s.connected && ++ticks % 30 === 0) {
      console.log(`[direct] heartbeat: ${s.fps.toFixed(1)}fps frames=${s.frames} gaps=${s.gaps}`);
    }

    // Re-attach when the publisher goes away. Unreal restarting invalidates the
    // XPC connection permanently: the listener it was bound to no longer
    // exists, so nothing will arrive on it again however long we wait. Without
    // this the app silently keeps showing the WebRTC video for the rest of the
    // session after any Unreal restart, which is exactly what a crash-recovery
    // or a character swap does.
    if (!s.connected) {
      missed += 1;
      if (missed >= 2) {
        missed = 0;
        try {
          a.stop();
          if (mode() === '2') {
            if (framePumpCleanup) { framePumpCleanup(); framePumpCleanup = null; }
            startFramePump(a, win, service);
          } else {
            a.start(win.getNativeWindowHandle(), service);
          }
        } catch (e) {
          console.error('[direct] re-attach failed:', e);
        }
      }
    } else {
      missed = 0;
    }

    if (s.connected !== lastConnected) {
      lastConnected = s.connected;
      console.log('[direct]', s.connected
        ? `live: ${s.fps.toFixed(1)}fps, ${s.surfaces} surfaces`
        : 'no publisher — WebRTC still in use');
    }
    try {
      win.webContents.send('direct-surface:status', s);
    } catch { /* window going away */ }
  }, 2000);

  return true;
}

export function stats(): DirectSurfaceStats | null {
  return addon ? addon.stats() : null;
}

export function detach(): void {
  if (poll) { clearInterval(poll); poll = null; }
  if (reloadHandler && reloadTarget && !reloadTarget.isDestroyed()) {
    reloadTarget.removeListener('did-finish-load', reloadHandler);
  }
  reloadHandler = null;
  reloadTarget = null;
  if (framePumpCleanup) { framePumpCleanup(); framePumpCleanup = null; }
  if (addon && attached) {
    try { addon.stop(); } catch { /* shutting down */ }
  }
  attached = false;
}
