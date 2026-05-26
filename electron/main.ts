import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  session,
  shell,
  safeStorage,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  desktopCapturer,
  Display,
  IpcMainEvent,
} from 'electron';
import path from 'path';
import fs from 'fs';
import { LOGO_BASE64 } from './oauthLogo';
import { startSoul, stopSoul, getSoulSnapshot } from './soulSupervisor';
import { getSetupSnapshot, runSetup } from './setupCoordinator';
import { runUpdateCheck, getUpdateSnapshot } from './updateCoordinator';
import { getAppShellState, quitAndInstallAppUpdate } from './appShellUpdater';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Holds the in-flight capture's source image + display while the
// overlay is open. Cleared on commit or cancel. Single capture at a
// time; the shortcut is debounced via overlayWindow.isVisible().
let pendingCapture: { image: Electron.NativeImage; display: Display } | null = null;

// Slightly larger and noticeably squarer than the original 420x760
// rectangle — gives the wizard's bottom panel + the streamed face
// enough room to breathe while still feeling like a sidekick window.
const WINDOW_WIDTH = 600;
const WINDOW_HEIGHT = 780;
const EDGE_MARGIN = 16;

const SCREENSHOT_SHORTCUT = 'Control+Shift+G';

// ---------------------------------------------------------------------
// Screenshot overlay UI (inline, sent to the pre-warmed BrowserWindow)
// ---------------------------------------------------------------------
//
// Loaded ONCE at app start. After that, every shortcut press just sends
// a fresh screenshot via IPC to the already-mounted page. No HTML parse,
// no image decode delay, no second-paint flash.
//
// Drag-release auto-commits — there's no confirm/tick step. Esc cancels.
const OVERLAY_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  html, body {
    margin: 0; padding: 0;
    width: 100vw; height: 100vh;
    overflow: hidden; user-select: none;
    background: #000; cursor: crosshair;
  }
  #screenshot {
    position: fixed; inset: 0;
    width: 100vw; height: 100vh;
    object-fit: cover; pointer-events: none;
    -webkit-user-drag: none;
    /* Hidden until we have a screenshot to show — avoids the alt-text
       artifact that flashed when src was an empty data URL. */
    display: none;
  }
  #dim {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    pointer-events: none;
    opacity: 0;
  }
  #dim.in { animation: dim-in 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  @keyframes dim-in { from { opacity: 0; } to { opacity: 1; } }
  #selection {
    position: fixed; display: none;
    border: 2px solid rgba(255, 255, 255, 0.96);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.45),
      0 0 16px 2px rgba(255, 255, 255, 0.10);
    pointer-events: none;
  }
  #hint {
    position: fixed; top: 28px; left: 50%; transform: translateX(-50%);
    padding: 10px 22px;
    background: rgba(18, 20, 28, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.10);
    border-radius: 999px;
    color: rgba(255, 255, 255, 0.94);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
      'Helvetica Neue', sans-serif;
    font-size: 13px; font-weight: 500; letter-spacing: 0.01em;
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    box-shadow: 0 6px 24px -6px rgba(0, 0, 0, 0.55);
    pointer-events: none;
    opacity: 0;
    z-index: 10;
    transition: opacity 0.18s ease;
  }
  #hint.in {
    animation: hint-in 240ms cubic-bezier(0.16, 1, 0.3, 1) 80ms forwards;
  }
  @keyframes hint-in {
    from { opacity: 0; transform: translate(-50%, -6px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  #size {
    position: fixed; padding: 4px 9px;
    background: rgba(18, 20, 28, 0.92);
    color: rgba(255, 255, 255, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 5px;
    font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace;
    font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    pointer-events: none; display: none; z-index: 11;
    box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.4);
  }
</style></head><body>
<img id="screenshot" alt="" />
<div id="dim"></div>
<div id="selection"></div>
<div id="hint">Drag to select &bull; Esc to cancel</div>
<div id="size"></div>
<script>
  const api = window.electronAPI || {};
  const screenshot = document.getElementById('screenshot');
  const dim = document.getElementById('dim');
  const selection = document.getElementById('selection');
  const hint = document.getElementById('hint');
  const sizeReadout = document.getElementById('size');

  let dragStart = null, dragRect = null, armed = false;

  function reset() {
    dragStart = null; dragRect = null; armed = true;
    selection.style.display = 'none';
    sizeReadout.style.display = 'none';
    dim.style.clipPath = '';
    dim.classList.remove('in');
    hint.classList.remove('in');
    hint.style.opacity = '';
    // Trigger reflow so the animation restarts cleanly on next show.
    void dim.offsetWidth;
    dim.classList.add('in');
    hint.classList.add('in');
  }

  function updateSelection(s, e) {
    const x1 = Math.min(s.x, e.x), y1 = Math.min(s.y, e.y);
    const x2 = Math.max(s.x, e.x), y2 = Math.max(s.y, e.y);
    const w = x2 - x1, h = y2 - y1;
    dragRect = { x: x1, y: y1, w, h };
    selection.style.display = 'block';
    selection.style.left = x1 + 'px';
    selection.style.top = y1 + 'px';
    selection.style.width = w + 'px';
    selection.style.height = h + 'px';
    dim.style.clipPath = 'polygon(0% 0%, 0% 100%, ' + x1 + 'px 100%, '
      + x1 + 'px ' + y1 + 'px, ' + x2 + 'px ' + y1 + 'px, '
      + x2 + 'px ' + y2 + 'px, ' + x1 + 'px ' + y2 + 'px, '
      + x1 + 'px 100%, 100% 100%, 100% 0%)';
    sizeReadout.style.display = 'block';
    sizeReadout.style.left = (x2 + 10) + 'px';
    sizeReadout.style.top = (y2 + 10) + 'px';
    sizeReadout.textContent = Math.round(w) + ' \\u00d7 ' + Math.round(h);
    hint.style.opacity = '0';
  }

  function commit() {
    if (!dragRect || dragRect.w < 4 || dragRect.h < 4) { cancel(); return; }
    armed = false;
    const dpr = window.devicePixelRatio || 1;
    api.completeScreenshot && api.completeScreenshot({
      x: Math.round(dragRect.x * dpr), y: Math.round(dragRect.y * dpr),
      w: Math.round(dragRect.w * dpr), h: Math.round(dragRect.h * dpr),
    });
  }
  function cancel() {
    armed = false;
    api.cancelScreenshot && api.cancelScreenshot();
  }

  // Main process pushes the captured screenshot here on every shortcut.
  api.onOverlayShow && api.onOverlayShow((data) => {
    screenshot.src = data.dataUrl;
    screenshot.style.display = 'block';
    reset();
  });

  document.addEventListener('mousedown', (e) => {
    if (!armed) return;
    dragStart = { x: e.clientX, y: e.clientY };
    dragRect = null;
    selection.style.display = 'none';
    sizeReadout.style.display = 'none';
    dim.style.clipPath = '';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragStart || !armed) return;
    updateSelection(dragStart, { x: e.clientX, y: e.clientY });
  });
  document.addEventListener('mouseup', (e) => {
    if (!dragStart || !armed) return;
    updateSelection(dragStart, { x: e.clientX, y: e.clientY });
    dragStart = null;
    // Auto-commit on release. No tick / confirm step.
    commit();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  // Tell main we're ready. Main holds startCapture() requests until
  // it sees this signal so the first shortcut press is never racing
  // an unfinished page load.
  api.notifyOverlayReady && api.notifyOverlayReady();
</script></body></html>`;

// ---------------------------------------------------------------------
// Pre-warm the overlay window at app start
// ---------------------------------------------------------------------
//
// Constructing a fresh BrowserWindow on every shortcut press is what
// causes the visible "shift" — Windows DWM has to add a new window to
// the desktop tree, re-stack, recompose. The fix used by every polished
// Electron screenshot tool (e.g. nashaofu/screenshots) is:
//
//   1) Create the overlay BrowserWindow ONCE at app startup, hidden.
//   2) Reuse it across captures: hide on commit/cancel, show on next.
//   3) Use `type: 'toolbar'` on Win32 — a Win32 toolbar window has
//      different DWM stack handling than the default WS_OVERLAPPED
//      and doesn't disturb other windows when shown/hidden.
//   4) Use `kiosk: true` AFTER show — bypasses Windows' usual window-
//      manager animations.
//   5) `paintWhenInitiallyHidden: false` so the renderer doesn't burn
//      cycles before first show.
//
// Result: after the first cold open, every subsequent Ctrl+Shift+G is
// essentially instant and visually clean.

let overlayReady: Promise<void> = Promise.resolve();

function createOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) return;

  // Sized later via setBounds() to match whichever display the cursor
  // is on when the shortcut fires. Initial bounds are placeholder.
  overlayWindow = new BrowserWindow({
    x: 0, y: 0, width: 100, height: 100,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: false,
    focusable: true,
    paintWhenInitiallyHidden: false,
    roundedCorners: false,
    enableLargerThanScreen: false,
    acceptFirstMouse: true,
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  overlayReady = new Promise((resolve) => {
    const onReady = (event: IpcMainEvent) => {
      if (overlayWindow && event.sender === overlayWindow.webContents) {
        ipcMain.removeListener('screenshot:overlay-ready', onReady);
        resolve();
      }
    };
    ipcMain.on('screenshot:overlay-ready', onReady);
  });

  overlayWindow.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(OVERLAY_HTML),
  );

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    pendingCapture = null;
  });
}

async function triggerScreenshot(): Promise<void> {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
  if (overlayWindow!.isVisible()) {
    overlayWindow!.focus();
    return;
  }

  // Wait for the renderer to be ready — only meaningful on the very
  // first call after app start; resolves instantly on every subsequent
  // capture.
  await overlayReady;

  // Pick the display the cursor is currently over.
  const cursorPos = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPos);
  const physW = Math.round(display.bounds.width * display.scaleFactor);
  const physH = Math.round(display.bounds.height * display.scaleFactor);

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: physW, height: physH },
      fetchWindowIcons: false,
    });
  } catch (err) {
    console.error('[screenshot] desktopCapturer failed', err);
    return;
  }
  const matchSrc =
    sources.find((s) => String(s.display_id) === String(display.id))
    ?? sources[0];
  if (!matchSrc) {
    console.error('[screenshot] no screen source available');
    return;
  }
  pendingCapture = { image: matchSrc.thumbnail, display };

  // Move + resize the (already-mounted) overlay to cover this display,
  // push the screenshot in, then show + kiosk. Reusing the window
  // avoids DWM's re-stack on construction; kiosk + the reused window
  // bypass the usual window-manager animation.
  overlayWindow!.setBounds(display.bounds);
  overlayWindow!.webContents.send('screenshot:overlay-show', {
    dataUrl: matchSrc.thumbnail.toDataURL(),
  });
  overlayWindow!.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow!.show();
  overlayWindow!.focus();
  overlayWindow!.setKiosk(true);
}

function endOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    pendingCapture = null;
    return;
  }
  overlayWindow.setKiosk(false);
  overlayWindow.hide();
  pendingCapture = null;
}

// IPC: overlay sends the selection rect (in physical pixels). Crop
// the cached full-res image and ship the resulting PNG to the main
// renderer.
ipcMain.on(
  'screenshot:complete',
  (_event, rect: { x: number; y: number; w: number; h: number }) => {
    if (!pendingCapture || !mainWindow) {
      endOverlay();
      return;
    }
    const fullImage = pendingCapture.image;
    const size = fullImage.getSize();
    const x = Math.max(0, Math.min(size.width - 1, rect.x));
    const y = Math.max(0, Math.min(size.height - 1, rect.y));
    const w = Math.max(1, Math.min(size.width - x, rect.w));
    const h = Math.max(1, Math.min(size.height - y, rect.h));
    const cropped = fullImage.crop({ x, y, width: w, height: h });
    const base64 = cropped.toPNG().toString('base64');
    mainWindow.webContents.send('screenshot:captured', {
      base64,
      width: w,
      height: h,
    });
    mainWindow.show();
    mainWindow.focus();
    endOverlay();
  },
);

ipcMain.on('screenshot:cancel', () => {
  endOverlay();
});

// ---------------------------------------------------------------------

// Single shared NativeImage for the brand. Reused for the BrowserWindow
// icon, the Tray, and macOS dock. Sourced from `resources/icon.png` —
// the OAuth success page still uses LOGO_BASE64 separately because it
// renders inside the user's external browser and can't read local
// files. `__dirname` at runtime is `<project>/dist/electron/`, so
// `../../resources/icon.png` resolves to `<project>/resources/icon.png`.
const APP_ICON = nativeImage.createFromPath(
  path.join(__dirname, '../../resources/icon.png'),
);

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: screenW - WINDOW_WIDTH - EDGE_MARGIN,
    y: Math.round((screenH - WINDOW_HEIGHT) / 2),
    frame: false,
    // macOS: surface the real OS traffic lights (close/min/full-screen)
    // in the top-left. They're the actual NSWindow buttons — hover-pulse,
    // dark-mode adapt, accessibility, full-screen-on-option-click — all
    // for free. Windows/Linux ignore titleBarStyle silently and keep the
    // frame:false chromeless treatment, so Titlebar.tsx's custom min/close
    // buttons still render there.
    titleBarStyle: 'hidden',
    // Nudge the lights down + right so they sit comfortably in our chrome
    // rather than hugging the top-left corner.
    trafficLightPosition: { x: 12, y: 12 },
    transparent: false,
    backgroundColor: '#050506',
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    minWidth: 320,
    minHeight: 480,
    // Window icon (taskbar / Alt-Tab / titlebar). Without this Electron
    // falls back to its default React-style icon.
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Always-on-top level: 'floating' (NSFloatingWindowLevel = 3) instead
  // of 'screen-saver' (level 1000). The screen-saver level promotes the
  // window into macOS's "accessory" panel category, which auto-hides the
  // dock icon for the owning app — users had no way to see Unclaw was
  // running or quit it from the dock. 'floating' keeps the window above
  // normal app windows (which is the 99% case) while letting the dock
  // icon stay visible. Trade-off: full-screen video / Screen Sharing can
  // cover Unclaw briefly; acceptable since the dock-icon affordance is
  // more important to the daily UX than the rare full-screen scenario.
  mainWindow.setAlwaysOnTop(true, 'floating');
  // visibleOnAllWorkspaces is mac/linux; harmless on Windows.
  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // Older Electron versions may not accept the second arg on every OS.
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Devtools shortcut for packaged builds. Cmd+Alt+Shift+I on macOS opens
  // detached devtools so we can inspect WebRTC peer state, console errors,
  // and the React tree on user machines without rebuilding the whole DMG
  // each time something goes wrong in the field. Packaged builds normally
  // don't surface devtools at all — this shortcut adds the escape hatch.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const isToggle =
      (input.meta || input.control) &&
      input.alt &&
      input.shift &&
      input.key.toLowerCase() === 'i';
    if (!isToggle) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Resize down for the system tray — Windows expects 16×16 (or 32×32
  // on hi-DPI). The full 256×256 brand image renders too large and
  // sometimes refuses to display at all on Win32. resize() returns a
  // new NativeImage; the source APP_ICON is untouched and stays
  // available at full res for the BrowserWindow.
  const trayIcon = APP_ICON.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('UnClaw');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show',
        click: () => mainWindow?.show(),
      },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ])
  );
  tray.on('click', () => mainWindow?.show());
}

// IPC handlers for window controls from renderer
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => app.quit());

// Renderer can ask for a SNAPSHOT of soul state. Used by SoulBootScreen
// on mount (and on every re-mount after a Cmd-R / hot reload) so it
// hydrates with whatever log lines + ready-status already happened
// before React was alive. Without this, refreshing the renderer mid-
// session left the boot screen stuck on "listening for soul…" forever
// because the IPC events had already fired into the void.
ipcMain.handle('soul:get-status', () => getSoulSnapshot());

// First-run setup pipeline. SetupWizard subscribes to 'setup:log' +
// 'setup:stage' for live progress; getStatus is the snapshot for
// hydration on mount (parallel to soul:get-status). start is what the
// wizard calls when it mounts to kick the pipeline — idempotent on the
// coordinator side, safe to call multiple times.
ipcMain.handle('setup:get-status', () => getSetupSnapshot());

// Runtime auto-updater. Renderer's UpdateOverlay subscribes to
// 'update:snapshot' (full state object replaces stage events here —
// per-category progress fits naturally in one payload). Get-status is
// the hydration call so the overlay can mount mid-update without
// missing earlier events.
ipcMain.handle('update:get-status', () => getUpdateSnapshot());
ipcMain.handle('update:start', async () => {
  if (!mainWindow) return getUpdateSnapshot();
  return runUpdateCheck(mainWindow);
});
ipcMain.handle('update:restart', () => {
  // If Squirrel has a staged app-shell update, go through quitAndInstall
  // so the bundle actually swaps. Otherwise a plain relaunch covers the
  // content-only case (soul / UE re-spawn against new on-disk bits).
  if (getAppShellState().state === 'ready') {
    quitAndInstallAppUpdate();
    return;
  }
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('setup:start', async () => {
  if (!mainWindow) return false;
  return runSetup(mainWindow);
});
ipcMain.on('window:toggle-pin', (_event, pinned: boolean) => {
  // Same level as the createWindow setup — 'screen-saver' is the
  // highest standard level and survives full-screen apps stealing
  // focus. When unpinned we drop back to a normal window.
  mainWindow?.setAlwaysOnTop(pinned, 'screen-saver');
});

// =====================================================================
// Auth: loopback HTTP server OAuth + token storage
// =====================================================================
//
// Sign-in flow for Google / Discord:
//   1) Renderer calls `auth:start-oauth-loopback` which spins up a
//      tiny http server on 127.0.0.1:47821 and returns a promise.
//   2) Renderer calls `auth:open-external` with the provider's auth
//      URL (redirect_uri = http://localhost:47821/oauth/callback).
//   3) User authenticates in browser; provider redirects to that
//      loopback URL with `?code=...&state=...`.
//   4) The local server captures the request, returns a "you can
//      close this tab" page, and resolves the IPC promise with
//      {code, state, error}. Server immediately shuts down.
//   5) Renderer verifies state matches what it generated, then POSTs
//      to the Worker's /auth/google or /auth/discord endpoint to
//      exchange the code for a JWT.
//   6) Renderer saves the JWT via `auth:set-token` -> safeStorage
//      writes an encrypted blob to `<userData>/auth.bin`.
//
// Loopback was picked over the older custom-URI-scheme deep-link
// approach because Google's Desktop OAuth client type rejects
// arbitrary custom schemes (only com.googleusercontent.apps.X:/...
// and http://127.0.0.1 are allowed). Loopback works for both
// providers with no console redirect-URI gymnastics on Google's side.

const AUTH_TOKEN_FILE = 'auth.bin';
const OAUTH_LOOPBACK_PORT = 47821;
const OAUTH_LOOPBACK_PATH = '/oauth/callback';
const OAUTH_TIMEOUT_MS = 3 * 60 * 1000;

interface OAuthCallbackPayload {
  code: string | null;
  state: string | null;
  error: string | null;
}

let oauthServer: import('http').Server | null = null;
let oauthResolver: ((v: OAuthCallbackPayload) => void) | null = null;
let oauthTimer: NodeJS.Timeout | null = null;

function shutdownOAuthServer(): void {
  if (oauthTimer) {
    clearTimeout(oauthTimer);
    oauthTimer = null;
  }
  if (oauthServer) {
    try {
      oauthServer.close();
    } catch {
      // ignore — server may already be closed
    }
    oauthServer = null;
  }
}

// Browser-facing success page. The user's browser shows this for a
// moment after the provider redirect lands; UnClaw's window pulls
// itself to front behind it. Aesthetic mirrors the in-app SignInScreen
// (frosted glass card, breathing logo, warm radial wash) so the
// cross-app handoff feels like one continuous moment. The logo is
// embedded as a base64 PNG in oauthLogo.ts so we never have to resolve
// an asset path from inside the main process.
const OAUTH_SUCCESS_HTML = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Signed in to UnClaw</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0; height: 100%; overflow: hidden;
      color: #fafafa;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont,
        'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    /* Layered ambient background — a deep navy/black base, two warm
       radial blooms (one accent-tinted, one cool slate) and a faint
       grid-noise vignette so the page never looks like a flat black
       sheet even when the card is small. */
    body {
      background:
        radial-gradient(ellipse 70% 50% at 50% 40%, rgba(196, 68, 68, 0.08), transparent 70%),
        radial-gradient(ellipse 80% 60% at 80% 80%, rgba(60, 80, 130, 0.10), transparent 70%),
        radial-gradient(ellipse 60% 60% at 20% 80%, rgba(50, 70, 120, 0.06), transparent 70%),
        radial-gradient(ellipse at 50% 0%, #16161e 0%, #08080b 60%);
      display: flex; align-items: center; justify-content: center;
      padding: 32px;
    }
    /* Soft grain — pure CSS, no asset. Adds organic texture to the
       background washes. */
    body::before {
      content: '';
      position: fixed; inset: 0;
      background-image:
        radial-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px);
      background-size: 3px 3px;
      pointer-events: none;
      mix-blend-mode: screen;
    }
    .halo {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -55%);
      width: 620px; height: 620px; border-radius: 50%;
      background: radial-gradient(circle,
        rgba(196, 68, 68, 0.20) 0%,
        rgba(196, 68, 68, 0.05) 45%,
        transparent 72%);
      filter: blur(28px);
      pointer-events: none;
      animation: halo-pulse 6s ease-in-out infinite;
    }
    @keyframes halo-pulse {
      0%, 100% { opacity: 0.85; transform: translate(-50%, -55%) scale(1); }
      50%      { opacity: 1.0;  transform: translate(-50%, -55%) scale(1.04); }
    }

    .card {
      position: relative;
      width: min(420px, 100%);
      padding: 40px 36px 32px;
      text-align: center;
      /* Glassy — same aesthetic as the in-app SignInScreen. */
      background: rgba(14, 16, 26, 0.42);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 24px;
      backdrop-filter: blur(36px) saturate(1.6);
      -webkit-backdrop-filter: blur(36px) saturate(1.6);
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.14) inset,
        0 -1px 0 rgba(255, 255, 255, 0.04) inset,
        1px 0 0 rgba(255, 255, 255, 0.05) inset,
        -1px 0 0 rgba(255, 255, 255, 0.05) inset,
        0 28px 80px rgba(0, 0, 0, 0.55),
        0 10px 32px rgba(0, 0, 0, 0.35),
        0 0 90px -16px rgba(196, 68, 68, 0.22);
      animation: card-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    @keyframes card-rise {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* Logo — real UnClaw mark, embedded base64. Breathes via a
       drop-shadow keyframe instead of opacity so the alpha edge stays
       crisp. */
    .logo-wrap {
      position: relative;
      width: 132px; height: 132px;
      margin: 4px auto 18px;
      display: flex; align-items: center; justify-content: center;
    }
    .logo-wrap::before {
      content: '';
      position: absolute; inset: -16px;
      border-radius: 50%;
      background: radial-gradient(circle,
        rgba(196, 68, 68, 0.24) 0%,
        rgba(196, 68, 68, 0.06) 50%,
        transparent 75%);
      filter: blur(10px);
      pointer-events: none;
    }
    .logo {
      width: 132px; height: 132px;
      object-fit: contain;
      position: relative; z-index: 1;
      animation: logo-breathe 3.2s ease-in-out infinite;
    }
    @keyframes logo-breathe {
      0%, 100% { filter: drop-shadow(0 0 16px rgba(196, 68, 68, 0.28)); }
      50%      { filter: drop-shadow(0 0 30px rgba(196, 68, 68, 0.46)); }
    }

    /* Inline accent rule above the headline — small, deliberate. */
    .rule {
      display: inline-block;
      width: 22px; height: 2px; border-radius: 2px;
      background: #c44444;
      box-shadow: 0 0 8px rgba(196, 68, 68, 0.6);
      margin-bottom: 14px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px; font-weight: 600;
      letter-spacing: -0.022em;
      color: #fafafa;
    }
    p {
      margin: 0;
      font-size: 14px; line-height: 1.55;
      color: #b8b3ad;
      max-width: 320px;
      margin-left: auto; margin-right: auto;
    }
    .hint {
      margin-top: 22px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 10.5px; letter-spacing: 0.10em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.36);
      display: inline-flex; align-items: center; gap: 7px;
    }
    .pulse-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #c44444;
      box-shadow: 0 0 6px rgba(196, 68, 68, 0.8);
      animation: dot-pulse 2s ease-in-out infinite;
    }
    @keyframes dot-pulse {
      0%, 100% { opacity: 0.6; }
      50%      { opacity: 1.0; }
    }
  </style>
</head><body>
  <span class="halo"></span>
  <div class="card">
    <div class="logo-wrap">
      <img class="logo" src="data:image/png;base64,${LOGO_BASE64}" alt="UnClaw">
    </div>
    <span class="rule"></span>
    <h1>You're signed in</h1>
    <p>You can close this tab and head back to UnClaw.</p>
    <div class="hint">
      <span class="pulse-dot"></span>
      <span>UnClaw is signed in</span>
    </div>
  </div>
</body></html>`;

function tokenFilePath(): string {
  return path.join(app.getPath('userData'), AUTH_TOKEN_FILE);
}

// Lazy-required so we don't pull http into the main bundle until needed.
async function startOAuthLoopback(): Promise<OAuthCallbackPayload> {
  // If a server is already running (user clicked sign-in twice), tear
  // the previous one down and resolve its promise as cancelled.
  if (oauthServer || oauthResolver) {
    const prev = oauthResolver;
    shutdownOAuthServer();
    prev?.({ code: null, state: null, error: 'cancelled-by-newer-attempt' });
  }

  const http = await import('http');

  return new Promise<OAuthCallbackPayload>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(
          req.url || '/',
          `http://localhost:${OAUTH_LOOPBACK_PORT}`,
        );
        if (reqUrl.pathname !== OAUTH_LOOPBACK_PATH) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(OAUTH_SUCCESS_HTML);

        const r = oauthResolver;
        shutdownOAuthServer();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
        r?.({ code, state, error });
      } catch (err) {
        console.warn('[auth] oauth-loopback handler failed', err);
        try {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('OAuth callback failed');
        } catch {
          // already-sent etc.
        }
        const r = oauthResolver;
        shutdownOAuthServer();
        r?.({ code: null, state: null, error: 'callback-handler-error' });
      }
    });

    server.on('error', (err) => {
      const r = oauthResolver;
      shutdownOAuthServer();
      // EADDRINUSE most likely — surface a clear message.
      const msg =
        (err as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
          ? `Port ${OAUTH_LOOPBACK_PORT} is in use. Close any other UnClaw or sign-in tab and try again.`
          : err.message || 'OAuth server failed';
      if (r) {
        r({ code: null, state: null, error: msg });
      } else {
        reject(err);
      }
    });

    oauthServer = server;
    oauthResolver = resolve;
    oauthTimer = setTimeout(() => {
      const r = oauthResolver;
      shutdownOAuthServer();
      r?.({ code: null, state: null, error: 'timeout' });
    }, OAUTH_TIMEOUT_MS);

    server.listen(OAUTH_LOOPBACK_PORT, '127.0.0.1');
  });
}

ipcMain.handle('auth:start-oauth-loopback', async () => startOAuthLoopback());

ipcMain.handle('auth:cancel-oauth-loopback', () => {
  const r = oauthResolver;
  shutdownOAuthServer();
  r?.({ code: null, state: null, error: 'cancelled' });
  return true;
});

// Open a URL in the user's default browser. Used by the renderer to
// kick off the OAuth dance for Google / Discord.
ipcMain.handle('auth:open-external', async (_event, url: string) => {
  if (typeof url !== 'string') return false;
  // Guard: only allow http(s) outbound.
  if (!/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

// Make sure the loopback server is closed if the app quits mid-flow.
app.on('will-quit', () => {
  shutdownOAuthServer();
});

// Persist the JWT in an encrypted file under userData. Returns true
// on success, false if encryption isn't available on this platform
// (Linux without a keyring) — in that case the renderer should fall
// back to keeping the token in memory only.
ipcMain.handle('auth:set-token', (_event, token: string) => {
  if (typeof token !== 'string' || !token) return false;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(token);
      fs.writeFileSync(tokenFilePath(), buf);
    } else {
      // Plaintext fallback. Acceptable on Linux-no-keyring; never
      // hits Windows/macOS production.
      fs.writeFileSync(tokenFilePath(), token, 'utf-8');
    }
    return true;
  } catch (err) {
    console.warn('[auth] set-token failed', err);
    return false;
  }
});

ipcMain.handle('auth:get-token', () => {
  const p = tokenFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(p);
      return safeStorage.decryptString(buf);
    }
    return fs.readFileSync(p, 'utf-8');
  } catch (err) {
    console.warn('[auth] get-token failed', err);
    return null;
  }
});

ipcMain.handle('auth:clear-token', () => {
  const p = tokenFilePath();
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (err) {
    console.warn('[auth] clear-token failed', err);
    return false;
  }
});

// =====================================================================
// API keys (BYOK) — local-only persistence via safeStorage.
// =====================================================================
//
// Pure scaffolding for now: the renderer collects provider/model/key
// fields in the onboarding wizard, hands the whole object over here,
// and we encrypt-and-write to <userData>/apiKeys.bin. No cloud sync,
// no soul wiring — soul keeps using its own .env keys until we wire
// these through to the chat path. The "sync across devices" toggle
// is stored alongside the keys but is non-functional UI for now.

const API_KEYS_FILE = 'apiKeys.bin';

function apiKeysFilePath(): string {
  return path.join(app.getPath('userData'), API_KEYS_FILE);
}

ipcMain.handle('apiKeys:get', () => {
  const p = apiKeysFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = fs.readFileSync(p);
      return safeStorage.decryptString(buf);
    }
    return fs.readFileSync(p, 'utf-8');
  } catch (err) {
    console.warn('[apiKeys] get failed', err);
    return null;
  }
});

ipcMain.handle('apiKeys:set', (_event, payload: string) => {
  if (typeof payload !== 'string') return false;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(payload);
      fs.writeFileSync(apiKeysFilePath(), buf);
    } else {
      fs.writeFileSync(apiKeysFilePath(), payload, 'utf-8');
    }
    return true;
  } catch (err) {
    console.warn('[apiKeys] set failed', err);
    return false;
  }
});

ipcMain.handle('apiKeys:clear', () => {
  const p = apiKeysFilePath();
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (err) {
    console.warn('[apiKeys] clear failed', err);
    return false;
  }
});

// IPC: renderer can also kick off a screenshot manually (e.g. a button).
ipcMain.on('screenshot:trigger', () => {
  void triggerScreenshot();
});

app.whenReady().then(() => {
  // macOS dock icon — the BrowserWindow `icon` prop only affects the
  // window/taskbar on Win/Linux; the dock is its own surface. No-op
  // on Win/Linux because `app.dock` is undefined there.
  //
  // `app.dock.show()` explicitly forces dock-icon visibility. Needed
  // because `mainWindow.setVisibleOnAllWorkspaces(true, ...)` below
  // promotes the window's collection-behavior with NSWindowCollectionBehaviorTransient,
  // which macOS treats as "accessory" and auto-hides the dock icon.
  // Without the explicit show(), Unclaw is reachable only from the
  // status-bar tray — no way for users to see it's running or quit it
  // via Cmd+Q. show() overrides the transient-window dock-hiding.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON);
    app.dock.show().catch(() => { /* show() can reject on some macOS versions — non-fatal */ });
  }

  // `geolocation` lets the Weather widget call navigator.geolocation
  // to pass real coords to soul instead of letting Gemini guess (which
  // defaulted to New York for every user). Chromium's geolocation
  // backend resolves via Wi-Fi networks → Google location service; no
  // user-facing API key needed in Electron.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ['media', 'audioCapture', 'mediaKeySystem', 'geolocation'];
    cb(allowed.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'audioCapture', 'mediaKeySystem', 'geolocation']
      .includes(permission);
  });
  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'audioInput' || details.deviceType === 'audioOutput') {
      return true;
    }
    return false;
  });

  // Pre-warm the overlay window now so the first Ctrl+Shift+G is fast
  // and visually clean.
  createOverlayWindow();

  const registered = globalShortcut.register(SCREENSHOT_SHORTCUT, () => {
    void triggerScreenshot();
  });
  if (!registered) {
    console.warn(
      `[screenshot] failed to register ${SCREENSHOT_SHORTCUT} — another app likely owns it`,
    );
  }

  createWindow();
  createTray();

  // Launch (or attach to) soul AFTER the main window exists so the
  // renderer can subscribe to 'soul:log' events from the first stdout
  // line. Streaming starts in the background; the React side renders
  // a LoadingScreen until it receives the 'soul:ready' IPC event.
  if (mainWindow) {
    startSoul(mainWindow).catch((err) => {
      console.warn('[unclaw] startSoul failed:', err);
    });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // SIGTERM the soul subprocess. Soul's shutdown hooks (UE SIGTERM,
  // MCP subprocess teardown) run cleanly. No-op if soul was attached
  // externally (the user owns that process and we don't kill it).
  stopSoul();
});

app.on('window-all-closed', () => {
  // Unclaw is a single-window foreground experience, not a typical
  // Mac menubar/background app. Closing the window means the user is
  // done — quit the whole app so `will-quit` fires and `stopSoul()`
  // can SIGTERM the soul subprocess. Without this, on macOS the app
  // stayed alive with no window and soul + UE leaked across sessions.
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
