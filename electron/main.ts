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
  systemPreferences,
  Display,
  IpcMainEvent,
} from 'electron';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { LOGO_BASE64 } from './oauthLogo';
import { startSoul, stopSoul, restartSoul, shutdownEverything, getSoulSnapshot, getSoulPorts, writeSoulKeysBridge, clearSoulKeysBridge } from './soulSupervisor';
import { getSetupSnapshot, runSetup, downloadAndExtractCharacterPak, characterPaksStageDir, downloadCharacterVoices, characterVoicesPresent, installedPakVersions, quarantineStalePaks } from './setupCoordinator';
import { MANIFEST, characterPakForPlatform } from './setupManifest';
import { runUpdateCheck, getUpdateSnapshot } from './updateCoordinator';
import { runLocalIdentityInference, runLocalPhotoInference, type GroomArgs } from './identityInference';
import { listBasecolors, regenerateBasecolor, runH3DPhotoToCharacter } from './h3dPipeline';
import { getAppShellState, quitAndInstallAppUpdate } from './appShellUpdater';
import * as directSurface from './directSurface';
import * as streamLease from './streamLease';

// Cap Chromium's GPU memory budget. By default Chromium scales its tile /
// cache / staging budget to system RAM (generous on a 64GB machine); measured
// 2026-07-19 the GPU process held a 1.6GB physical footprint (268MB across 561
// IOSurfaces + 617MB IOAccelerator) for one window streaming one video. 512MB
// forces the compositor to evict instead of hoard. Worst case is a rare
// repaint flicker under fast UI motion; the WebRTC video path is unaffected
// (decoded frames live in VideoToolbox surfaces outside this budget).
// Must run before app ready, so module top level.
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '512');

// Direct IOSurface display path: ON by default on macOS as of 1.1.8.
//
// Resolved HERE, at module top level, and written back into process.env rather
// than being computed per-reader. Three separate places consume this — this
// process, the preload (which decides whether to install the shared-texture
// receiver), and soulSupervisor (which must set UNCLAW_UE_LAUNCHD so UE is
// spawned by launchd and can own the Mach service) — and if any of them
// disagreed about the default we would get a half-armed pipeline. Renderer
// processes inherit the environment at spawn, which happens well after this
// line, so one assignment covers all three.
//
// `UNCLAW_DIRECT_SURFACE=0` opts out and falls back to WebRTC. The path also
// degrades on its own if the engine has no publisher (older UE bundle) or the
// native addon is missing: directSurface logs "no publisher — WebRTC still in
// use" and the stream continues over WebRTC.
if (process.platform === 'darwin' && !process.env.UNCLAW_DIRECT_SURFACE) {
  process.env.UNCLAW_DIRECT_SURFACE = '2';
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Holds the in-flight capture's source image + display while the
// overlay is open. Cleared on commit or cancel. Single capture at a
// time; the shortcut is debounced via overlayWindow.isVisible().
let pendingCapture: { image: Electron.NativeImage; display: Display } | null = null;

// Slightly larger and noticeably squarer than the original 420x760
// rectangle, gives the wizard's bottom panel + the streamed face
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
// Drag-release auto-commits, there's no confirm/tick step. Esc cancels.
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
    /* Hidden until we have a screenshot to show, avoids the alt-text
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
// causes the visible "shift", Windows DWM has to add a new window to
// the desktop tree, re-stack, recompose. The fix used by every polished
// Electron screenshot tool (e.g. nashaofu/screenshots) is:
//
//   1) Create the overlay BrowserWindow ONCE at app startup, hidden.
//   2) Reuse it across captures: hide on commit/cancel, show on next.
//   3) Use `type: 'toolbar'` on Win32, a Win32 toolbar window has
//      different DWM stack handling than the default WS_OVERLAPPED
//      and doesn't disturb other windows when shown/hidden.
//   4) Use `kiosk: true` AFTER show, bypasses Windows' usual window-
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

  // Wait for the renderer to be ready, only meaningful on the very
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
// icon, the Tray, and macOS dock. Sourced from `resources/icon.png` , 
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
    // in the top-left. They're the actual NSWindow buttons, hover-pulse,
    // dark-mode adapt, accessibility, full-screen-on-option-click, all
    // for free. Windows/Linux ignore titleBarStyle silently and keep the
    // frame:false chromeless treatment, so Titlebar.tsx's custom min/close
    // buttons still render there.
    titleBarStyle: 'hidden',
    // Nudge the lights down + right so they sit comfortably in our chrome
    // rather than hugging the top-left corner.
    trafficLightPosition: { x: 12, y: 12 },
    // Direct-surface mode 1 composites Unreal's CALayer BEHIND the web
    // content, so the window has to be transparent or Chromium's background
    // paints over it. Transparency cannot be toggled after construction, hence
    // the flag is read here as well as in directSurface.ts. Mode 2 draws the
    // frame INSIDE the page (shared texture -> canvas), so the window stays
    // opaque and the window server stops alpha-blending the whole surface.
    transparent: directSurface.isEnabled() && directSurface.mode() === '1',
    backgroundColor:
      directSurface.isEnabled() && directSurface.mode() === '1' ? '#00000000' : '#050506',
    // Opt-in, not default (2026-08-15): the window starts ordinary and the
    // titlebar pin button raises it. Matches `pinned` initial state in
    // src/components/Titlebar.tsx.
    alwaysOnTop: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    minWidth: 320,
    minHeight: 480,
    // Window icon (taskbar / Alt-Tab / titlebar). Without this Electron
    // falls back to its default React-style icon.
    icon: APP_ICON,
    // macOS focus quirk fix. By default, when our floating
    // `alwaysOnTop` window is not the focused app and the user clicks
    // anywhere in its content area, AppKit only raises the window and
    // swallows the click; the streamed character + chrome don't
    // receive the pointerdown, and the input bar / widgets feel
    // dead until a second click. The titlebar drag region is a native
    // NSView so it activates the window correctly on first click,
    // which is why this looked like "only titlebar clicks focus".
    // `acceptFirstMouse: true` makes the first content click both
    // raise the window AND propagate to whatever was clicked. The
    // screenshot overlay window already has this set; missing here
    // was an oversight.
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Shared-texture mode: the PRELOAD needs `electron.sharedTexture` to
      // register the frame receiver, and sandboxed preloads only get the
      // small allowlisted module set (ipcRenderer, contextBridge, ...).
      // Disabling the sandbox for this window is what exposes it. Context
      // isolation stays on and nodeIntegration stays off, so page code still
      // has no Node access; only our own preload gains it.
      sandbox: !(directSurface.isEnabled() && directSurface.mode() === '2'),
    },
  });

  // Always-on-top is user-opt-in via the titlebar pin (window:toggle-pin
  // below); nothing to set here. When pinned, the level used is 'floating'
  // (NSFloatingWindowLevel = 3), NOT 'screen-saver' (level 1000): the
  // screen-saver level promotes the window into macOS's "accessory" panel
  // category, which auto-hides the dock icon for the owning app, and users
  // had no way to see Unclaw was running or quit it from the dock.
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
  // don't surface devtools at all, this shortcut adds the escape hatch.
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

  // Direct-surface path. Attached after the window exists so the native handle
  // is valid; no-op unless UNCLAW_DIRECT_SURFACE=1 and the addon was built.
  // Safe before Unreal is up: `connected` simply stays false and the renderer
  // keeps the WebRTC video until real frames arrive.
  if (directSurface.isEnabled()) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        directSurface.attach(mainWindow);
      }
    });
    // Every load (reloads included): re-announce the current lease so the
    // renderer's DOM mirror can never go stale across a Cmd+R mid-call.
    mainWindow.webContents.on('did-finish-load', () => {
      streamLease.announce();
    });
  }

  // The renderer's console lines are invisible to every log file; mirror the
  // stream-relevant ones ([direct-canvas], [ps]) and all warnings/errors to
  // stdout so a headless check can reconstruct the connection story. Lives
  // OUTSIDE the direct-path gate: WebRTC-only runs need it just as much
  // (learned when a WebRTC-mode probe came back with a blind log).
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (message.includes('[direct-canvas]') || message.includes('[ps]')
        || message.includes('[rtc-gpu]') || level >= 2) {
      console.log(`[renderer${level >= 2 ? ':warn' : ''}] ${message}`);
    }
  });

  // Cmd+H hides all chrome (clean-capture / debug). Scoped to the FOCUSED
  // Unclaw window via before-input-event: the old globalShortcut version
  // hijacked Cmd+H system-wide, so no other app could hide itself while
  // Unclaw ran. preventDefault also beats the app menu's "Hide" role, which
  // is why the shortcut works at all. Lives inside createWindow so a
  // recreated window (Dock-click after close) keeps the shortcut.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.meta
        && !input.alt && !input.control && !input.shift
        && input.key.toLowerCase() === 'h') {
      event.preventDefault();
      mainWindow?.webContents.send('temp:toggle-ui');
    }
  });

  mainWindow.on('closed', () => {
    directSurface.detach();
    mainWindow = null;
    // Closing the main window quits the app, and it has to be said HERE
    // rather than left to window-all-closed, for two reasons that stack:
    //
    //   1. `titleBarStyle: 'hidden'` gives us the real macOS traffic lights,
    //      so the red button closes this NSWindow directly. It never reaches
    //      the renderer's `window:close` IPC, which is the only other place
    //      that calls app.quit().
    //   2. window-all-closed never fires anyway: createOverlayWindow() warms
    //      the screenshot overlay at startup and that hidden BrowserWindow
    //      stays open for the app's whole life, so "all closed" is never true.
    //
    // Net effect before this line existed: red button closed the window and
    // nothing else happened. No before-quit, no teardown, app idle in the
    // Dock with soul, coturn and UE (at ~80% CPU) still running.
    app.quit();
  });
}

function createTray() {
  // Resize down for the system tray, Windows expects 16×16 (or 32×32
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
// Force the stream lease for testing the handoff without a second device.
// Renderer surface: __unclawStream.lease('remote' | 'local' | null)
ipcMain.handle('stream-lease:force', async (_e, holder: 'local' | 'remote' | null) => {
  return streamLease.force(holder);
});
ipcMain.handle('stream-lease:get', () => (
  { holder: streamLease.current(), players: streamLease.players() }
));

// Desktop "Disconnect" button: hang up on every remote viewer. soul closes
// the bridges and tells the Worker, active_players empties, and the lease
// poller reclaims the direct path on its next tick.
ipcMain.handle('stream-lease:disconnect', async () => {
  const port = getSoulPorts()?.http;
  if (!port) return { ok: false, error: 'soul_not_ready' };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pair/disconnect`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json().catch(() => ({}));
    // Clear any dev pin too, or a forced 'remote' would immediately re-take
    // the lease and the button would look broken.
    void streamLease.force(null);
    return { ok: res.ok, ...(body as object) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => app.quit());

// Explicit focus from the renderer. The PixelStreaming library
// captures pointer events on the streamed <video> to forward to UE
// (mouse position, click, scroll) and that capture can keep AppKit
// from running its normal "click in content → focus the window"
// behavior, especially for `alwaysOnTop` floating windows. The
// renderer hooks a capture-phase mousedown listener and fires this
// IPC when the BrowserWindow isn't focused yet; we then call
// `focus()` here so the next interaction (typing, dragging) lands
// on us instead of leaking to whichever app was previously focused.
// Open Terminal.app with a pre-filled command. Used by the SettingsPanel's
// Claude Code subscription card so the user can run `claude setup-token`
// without leaving Unclaw to type the command themselves. Uses osascript
// (AppleScript) rather than `open -a Terminal` so we can inject the
// command into a fresh tab and avoid clobbering any existing session.
// Microphone permission. Continuous voice mode + push-to-talk both need mic
// access. On macOS, getUserMedia hard-fails with NotAllowedError if the OS
// hasn't granted mic access to this app — and that failure is otherwise
// invisible. These let the renderer (a) proactively trigger the macOS prompt
// via the proper Electron API before touching getUserMedia, (b) read the
// current status to message the user, and (c) jump straight to the Privacy
// pane when access was previously denied (macOS won't re-prompt then).
ipcMain.handle('mic:get-status', () => {
  if (process.platform !== 'darwin') return 'granted';
  try {
    return systemPreferences.getMediaAccessStatus('microphone');
  } catch {
    return 'unknown';
  }
});

ipcMain.handle('mic:request', async () => {
  if (process.platform !== 'darwin') return true;
  try {
    // 'not-determined' → shows the system prompt and resolves with the choice.
    // 'granted' → resolves true immediately. 'denied'/'restricted' → resolves
    // false WITHOUT a prompt (macOS only prompts once; after that it's Settings).
    return await systemPreferences.askForMediaAccess('microphone');
  } catch {
    return false;
  }
});

ipcMain.handle('mic:open-settings', async () => {
  try {
    if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('terminal:open-with-command', async (_event, command: string) => {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, error: 'no command provided' };
  }
  const { exec } = await import('node:child_process');
  if (process.platform === 'win32') {
    // Windows: open a fresh cmd window with the command pre-filled (/k keeps
    // it open after the command runs so the user sees the setup-token output).
    const safeWin = command.replace(/"/g, '""');
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      exec(`start "Unclaw" cmd /k "${safeWin}"`, (err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true });
      });
    });
  }
  // macOS: osascript injects the command into a fresh Terminal tab rather
  // than `open -a Terminal` so we don't clobber an existing session.
  const safe = command.replace(/"/g, '\\"');
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    exec(
      `osascript -e 'tell application "Terminal" to do script "${safe}"' ` +
        `-e 'tell application "Terminal" to activate'`,
      (err) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true });
      },
    );
  });
});

ipcMain.on('window:focus', () => {
  if (!mainWindow) return;
  if (mainWindow.isFocused()) return;
  // Three-step macOS focus reclaim. The window is at NSFloatingWindowLevel
  // (per `setAlwaysOnTop(true, 'floating')` in createWindow), which means:
  //   * BrowserWindow.focus() raises THIS window and marks it as key, but
  //   * the owning Electron app isn't necessarily the frontmost app, so
  //     AppKit can hand activation back to whichever app actually was
  //     frontmost the moment the PixelStreaming pointer handlers run.
  // app.focus({steal:true}) makes Electron the frontmost app first; then
  // moveTop ensures floating-level windows of OUR app sit above each
  // other correctly; then BrowserWindow.focus locks in key-window status.
  // The result: clicking the streamed character behaves like clicking
  // any other app's content area.
  try { app.focus({ steal: true }); } catch { /* not critical */ }
  try { mainWindow.moveTop(); } catch { /* not critical */ }
  mainWindow.focus();
});

// Renderer can ask for a SNAPSHOT of soul state. Used by SoulBootScreen
// on mount (and on every re-mount after a Cmd-R / hot reload) so it
// hydrates with whatever log lines + ready-status already happened
// before React was alive. Without this, refreshing the renderer mid-
// session left the boot screen stuck on "listening for soul…" forever
// because the IPC events had already fired into the void.
ipcMain.handle('soul:get-status', () => getSoulSnapshot());
ipcMain.handle('soul:get-ports', () => getSoulPorts());
// User-initiated retry from the boot-failure screen. Tears down any
// half-started soul and runs a fresh boot episode (clears the failure
// latch + respawn budget). Returns once the new startSoul kicks off.
ipcMain.handle('soul:restart', async () => {
  if (!mainWindow) return false;
  await restartSoul(mainWindow);
  return true;
});

// Reveal the logs folder in Finder/Explorer. Surfaced from the boot +
// setup failure screens (and usable for support) so a user hitting a
// stuck launch can grab logs without hand-navigating ~/Library. Opens
// <userData>/logs, which holds the daily soul-*.log tee; the UE
// game.log lives under runtime/data/unreal but the soul log is the
// right first stop and links onward.
ipcMain.handle('system:open-logs', async () => {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    await shell.openPath(logsDir);
    return true;
  } catch (err) {
    console.warn('[unclaw] open-logs failed:', err);
    return false;
  }
});

// First-run setup pipeline. SetupWizard subscribes to 'setup:log' +
// 'setup:stage' for live progress; getStatus is the snapshot for
// hydration on mount (parallel to soul:get-status). start is what the
// wizard calls when it mounts to kick the pipeline, idempotent on the
// coordinator side, safe to call multiple times.
ipcMain.handle('setup:get-status', () => getSetupSnapshot());

// Runtime auto-updater. Renderer's UpdateOverlay subscribes to
// 'update:snapshot' (full state object replaces stage events here , 
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
  // Same level as the createWindow setup, 'screen-saver' is the
  // highest standard level and survives full-screen apps stealing
  // focus. When unpinned we drop back to a normal window. 'floating', not
  // 'screen-saver': the latter hides the dock icon (see createWindow).
  mainWindow?.setAlwaysOnTop(pinned, 'floating');
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
      // ignore, server may already be closed
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
    /* Layered ambient background, a deep navy/black base, two warm
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
    /* Soft grain, pure CSS, no asset. Adds organic texture to the
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
      /* Glassy, same aesthetic as the in-app SignInScreen. */
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

    /* Logo, real UnClaw mark, embedded base64. Breathes via a
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

    /* Inline accent rule above the headline, small, deliberate. */
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
      // EADDRINUSE most likely, surface a clear message.
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
// (Linux without a keyring), in that case the renderer should fall
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
// API keys (BYOK), local-only persistence via safeStorage.
// =====================================================================
//
// Pure scaffolding for now: the renderer collects provider/model/key
// fields in the onboarding wizard, hands the whole object over here,
// and we encrypt-and-write to <userData>/apiKeys.bin. No cloud sync,
// no soul wiring, soul keeps using its own .env keys until we wire
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
    // Refresh the plaintext bridge so a running soul picks up new keys on its
    // next mtime-check (no Keychain prompt, no soul restart needed).
    writeSoulKeysBridge();
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
    clearSoulKeysBridge();
    return true;
  } catch (err) {
    console.warn('[apiKeys] clear failed', err);
    return false;
  }
});

// Durable "which account owns this machine's local state" marker. This used to
// live only in the renderer's localStorage, but that can be cleared or
// corrupted independently of the API keys it guards , and when the marker
// vanished the reconciler mistook the SAME user for a new owner and WIPED their
// unrecoverable BYOK keys. Persisting it here (a userData file, colocated with
// apiKeys.bin) makes the marker share fate with the keys: if the keys survive,
// the owner id survives, so a lost localStorage entry can never trigger a wipe.
// The owner id is not a secret, so it's stored in plaintext.
const LOCAL_OWNER_FILE = 'localOwner.txt';
function localOwnerFilePath(): string {
  return path.join(app.getPath('userData'), LOCAL_OWNER_FILE);
}

ipcMain.handle('localOwner:get', () => {
  try {
    const p = localOwnerFilePath();
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, 'utf-8').trim();
    return v || null;
  } catch (err) {
    console.warn('[localOwner] get failed', err);
    return null;
  }
});

ipcMain.handle('localOwner:set', (_event, ownerId: string) => {
  if (typeof ownerId !== 'string' || !ownerId) return false;
  try {
    fs.writeFileSync(localOwnerFilePath(), ownerId, 'utf-8');
    return true;
  } catch (err) {
    console.warn('[localOwner] set failed', err);
    return false;
  }
});

ipcMain.handle('localOwner:clear', () => {
  try {
    const p = localOwnerFilePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (err) {
    console.warn('[localOwner] clear failed', err);
    return false;
  }
});

// IPC: renderer can also kick off a screenshot manually (e.g. a button).
ipcMain.on('screenshot:trigger', () => {
  void triggerScreenshot();
});

// ----------------------------------------------------------------------
// unclaw:// deep link. Used by the character store: after a Polar checkout
// completes in the system browser, the success page bounces to
// `unclaw://store/purchased` which re-focuses the app and tells the renderer
// to refresh entitlements immediately (polling is the fallback). The link
// carries no secrets — it is purely a "wake up and refresh" signal.
// ----------------------------------------------------------------------
const DEEP_LINK_PROTOCOL = 'unclaw';
let pendingDeepLink: string | null = null;

function handleDeepLink(url: string | undefined | null) {
  if (!url || typeof url !== 'string') return;
  if (!url.startsWith(`${DEEP_LINK_PROTOCOL}://`)) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deep-link', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    // Passthrough links are machine-generated: the agent's `speak` shim
    // opens unclaw://passthrough to make sure a session exists, which can
    // happen at any moment while the user is typing in their terminal.
    // Show the window, but do NOT take key status , see the matching note
    // in App.tsx's deep-link handler. Every other link (checkout return,
    // OAuth, user-initiated) is a deliberate hand-off and does focus.
    if (/^unclaw:\/\/passthrough/.test(url)) {
      mainWindow.showInactive();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  } else {
    // Cold start: the renderer pulls this once it mounts.
    pendingDeepLink = url;
  }
}

// Single-instance: a second launch (e.g. the OS opening an unclaw:// link
// while we're already running) hands its argv to the primary instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_evt, argv) => {
    // Windows/Linux deliver the deep link as an argv entry.
    const link = argv.find((a) => a.startsWith(`${DEEP_LINK_PROTOCOL}://`));
    if (link) handleDeepLink(link);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      // Same rule as handleDeepLink: a passthrough relaunch must not pull
      // the user out of whatever they were typing in.
      if (!link || !/^unclaw:\/\/passthrough/.test(link)) mainWindow.focus();
    }
  });
}

// macOS delivers deep links through this event (must be registered before
// whenReady to catch a cold-start launch).
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Register as the default handler for unclaw:// .
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

// Renderer pulls any link that arrived before it mounted.
ipcMain.handle('deep-link:get-pending', () => {
  const link = pendingDeepLink;
  pendingDeepLink = null;
  return link;
});

// IPC: local photo->identity inference (DEV). The renderer downloads the
// phone's capture.zip (it holds the auth token) and passes the bytes here;
// main runs take-fabrication + the headless UE identity job and stages the
// dna/blob artifacts into the UE container. Progress streams on
// 'identity:progress'.
ipcMain.handle(
  'identity:run-inference',
  async (_event, args: { sessionId: string; zipBytes: Uint8Array; groom?: GroomArgs }) => {
    if (!args?.sessionId || !args?.zipBytes?.length) {
      return { ok: false, error: 'invalid_args' };
    }
    return runLocalIdentityInference(mainWindow, args.sessionId, args.zipBytes, args.groom);
  },
);

// IPC: photo-only tier -- any flat JPEG/PNG, depth synthesized by the ML stack.
ipcMain.handle(
  'identity:run-inference-photo',
  async (_event, args: { localId: string; photoBytes: Uint8Array; ext: 'jpg' | 'png'; groom?: GroomArgs }) => {
    if (!args?.localId || !args?.photoBytes?.length || !['jpg', 'png'].includes(args?.ext)) {
      return { ok: false, error: 'invalid_args' };
    }
    return runLocalPhotoInference(mainWindow, args.localId, args.photoBytes, args.ext, args.groom);
  },
);

// H3D tier: photo -> Gemini hair removal -> Rodin bust -> local UE chain ->
// .dna + .ujnt. Long-running (Rodin plus a headless UE boot), progress arrives
// on the same identity:progress channel.
ipcMain.handle(
  'identity:run-h3d',
  async (_event, args: {
    localId: string; photoBytes: Uint8Array; ext: 'jpg' | 'png';
    catalogs?: { hairs: { index: number; name: string }[]; brows: { index: number; name: string }[]; lashes: { index: number; name: string }[] };
  }) => {
    if (!args?.localId || !args?.photoBytes?.length || !['jpg', 'png'].includes(args?.ext)) {
      return { ok: false, error: 'invalid_args' };
    }
    const workDir = path.join(app.getPath('userData'), 'identities', args.localId);
    return runH3DPhotoToCharacter(mainWindow, {
      localId: args.localId,
      photoBytes: args.photoBytes,
      ext: args.ext,
      workDir,
      catalogs: args.catalogs,
    });
  },
);

// Regenerate ONLY the skin texture for an existing character. Seconds and one
// image call, against a full chain's Rodin credit + headless UE boot.
ipcMain.handle(
  'identity:regen-basecolor',
  async (_event, args: { localId: string }) => {
    if (!args?.localId) return { ok: false, error: 'invalid_args' };
    const workDir = path.join(app.getPath('userData'), 'identities', args.localId);
    return regenerateBasecolor(mainWindow, args.localId, workDir);
  },
);

// Every skin generated for a character, so the UI can offer the earlier ones.
ipcMain.handle(
  'identity:list-basecolors',
  async (_event, args: { localId: string }) => {
    if (!args?.localId) return { ok: false, skins: [] };
    const workDir = path.join(app.getPath('userData'), 'identities', args.localId);
    return { ok: true, skins: listBasecolors(args.localId, workDir) };
  },
);

// IPC: download + extract a purchased character pak. The renderer fetches the
// short-lived presigned URL from the store Worker (it holds the auth token)
// and passes { characterId, url } here; main reads the pak's sha256 + sizeBytes
// from its own manifest (the single client source of truth, same as the base
// bundles) and runs the heavy download/verify/extract.
ipcMain.handle(
  'character-store:download-pak',
  async (_event, args: { characterId: string; url: string }) => {
    if (!mainWindow || !args?.characterId || !args?.url) {
      return { ok: false, error: 'invalid_args' };
    }
    const meta = MANIFEST.characterPaks?.[args.characterId];
    if (!meta) return { ok: false, error: 'pak_unavailable' };
    // Mac and Windows paks are cooked separately; pick the bytes for THIS
    // platform so the SHA-verify matches what the store Worker presigned.
    const platMeta = characterPakForPlatform(meta);
    try {
      const installed = await downloadAndExtractCharacterPak(
        mainWindow,
        args.characterId,
        { url: args.url, sha256: platMeta.sha256, sizeBytes: platMeta.sizeBytes, version: meta.version },
        (downloaded, total) => {
          mainWindow?.webContents.send('character-store:pak-progress', {
            characterId: args.characterId,
            downloaded,
            total,
          });
        },
      );
      // `mountPath` (the in-container copy) lets the renderer mount the pak
      // mid-session via the `mountCharacterPak` descriptor — no relaunch. null
      // when the UE container wasn't reachable; the pak still boot-mounts next
      // launch from UNCLAW_CHARACTERS_SRC.
      return { ok: true, dir: installed.extractDir, mountPath: installed.containerPak };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
);

// IPC: which of a character's cloned voice files are already on disk. Lets the
// renderer skip a gated /voice fetch when nothing is missing (the common warm
// case for an already-owned character).
ipcMain.handle('character-store:has-voices', async (_event, args: { characterId: string }) => {
  if (!args?.characterId) return { ok: false, error: 'invalid_args' };
  try {
    const present = characterVoicesPresent(args.characterId);
    // `complete` must count EVERY engine we ship, or adding one strands every
    // existing owner: they already have supertonic + kokoro on disk, so the
    // renderer short-circuits before the gated fetch and the new engine's file
    // never arrives. Adding pocket to this AND to characterVoicesPresent is
    // what makes 1.1.8 backfill it for characters bought before 1.1.8.
    const complete = present.supertonic && present.kokoro && present.pocket;
    return { ok: true, present, complete };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

// IPC: download + install a purchased character's cloned voice files. The
// renderer fetches the presigned URLs from the store Worker (entitlement-gated)
// and passes them here; main drops them into the soul voices dirs. Best-effort:
// a failure leaves the avatar on the generic F1 voice until the next attempt,
// it never blocks the pak.
ipcMain.handle(
  'character-store:download-voices',
  async (_event, args: { characterId: string; files: { kind: 'supertonic' | 'kokoro'; filename: string; url: string }[] }) => {
    if (!args?.characterId || !Array.isArray(args?.files)) {
      return { ok: false, error: 'invalid_args' };
    }
    try {
      const written = await downloadCharacterVoices(args.characterId, args.files);
      return { ok: true, written };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },
);

// IPC: which character paks are installed locally (downloaded to the flat
// character-paks staging dir). The renderer uses this as the source of truth
// for paid-character "installed" state, instead of depending solely on UE's
// installedCharacters report (which is null until UE answers, and a packaged
// build that strips paid paks would otherwise look "all installed").
ipcMain.handle('character-store:list-installed', async () => {
  const ids = new Set<string>();
  // Downloaded paks staged on disk (production, or after a real download).
  try {
    const dir = characterPaksStageDir();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.toLowerCase().endsWith('.pak')) ids.add(f.replace(/\.pak$/i, ''));
      }
    }
  } catch { /* ignore */ }
  // NOTE: the dev convenience that reported ava/goblin/chris/joi as installed
  // (because a dev build baked every chunk into Content/Paks) is DISABLED to
  // exercise the real purchase→download→mount pipeline. Installed state now
  // comes solely from the staged-paks dir, same as production. To restore the
  // baked-in dev shortcut, re-add the !app.isPackaged block AND move the
  // pakchunk1-4 paks back from _baked_paid_paks_backup into Content/Paks.
  //
  // Drift detection: a staged pak whose recorded version differs from the
  // manifest's current version is STALE — still usable (the old bytes mount
  // fine) but the provisioning pass re-downloads it so an older install picks
  // up a re-cooked pak on launch. `ids` stays the full installed set so the
  // picker keeps showing the character as ready while the refresh runs.
  const versions = installedPakVersions();
  const stale: string[] = [];
  for (const id of ids) {
    const want = MANIFEST.characterPaks?.[id]?.version;
    if (want && versions[id] !== want) stale.push(id);
  }
  return { ids: Array.from(ids), stale };
});

app.whenReady().then(() => {
  // macOS dock icon, the BrowserWindow `icon` prop only affects the
  // window/taskbar on Win/Linux; the dock is its own surface. No-op
  // on Win/Linux because `app.dock` is undefined there.
  //
  // `app.dock.show()` explicitly forces dock-icon visibility. Needed
  // because `mainWindow.setVisibleOnAllWorkspaces(true, ...)` below
  // promotes the window's collection-behavior with NSWindowCollectionBehaviorTransient,
  // which macOS treats as "accessory" and auto-hides the dock icon.
  // Without the explicit show(), Unclaw is reachable only from the
  // status-bar tray, no way for users to see it's running or quit it
  // via Cmd+Q. show() overrides the transient-window dock-hiding.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON);
    app.dock.show().catch(() => { /* show() can reject on some macOS versions, non-fatal */ });
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
  // Device permissions (WebHID / WebSerial / WebUSB): nothing in the app
  // uses these; deny all. NOTE: audio does NOT flow through this handler —
  // deviceType is only ever 'hid' | 'serial' | 'usb', and microphone access
  // is granted above via setPermissionRequestHandler ('media' /
  // 'audioCapture'). An earlier version checked for 'audioInput' here, a
  // branch the types prove can never fire (caught by the 2026-08-16 tsc
  // pass); behavior is unchanged by removing it.
  session.defaultSession.setDevicePermissionHandler(() => false);

  // Pre-warm the overlay window now so the first Ctrl+Shift+G is fast
  // and visually clean.
  createOverlayWindow();

  const registered = globalShortcut.register(SCREENSHOT_SHORTCUT, () => {
    void triggerScreenshot();
  });
  if (!registered) {
    console.warn(
      `[screenshot] failed to register ${SCREENSHOT_SHORTCUT}, another app likely owns it`,
    );
  }

  createWindow();
  createTray();

  // Launch (or attach to) soul AFTER the main window exists so the
  // renderer can subscribe to 'soul:log' events from the first stdout
  // line. Streaming starts in the background; the React side renders
  // a LoadingScreen until it receives the 'soul:ready' IPC event.
  if (mainWindow) {
    // FIRST-LAUNCH GUARD: park any staged character pak that is not provably
    // current (manifest version + byte hash both verified) BEFORE soul stages
    // paks into UE. Boot-mounting a pak from a different UE build wedged the
    // 1.1.5 first launch ("getting Goblin ready" forever); a briefly-missing
    // paid character that re-downloads is strictly better. Sequential on
    // purpose: soul must not race the quarantine.
    const pakVersions: Record<string, string | undefined> = {};
    for (const [id, entry] of Object.entries(MANIFEST.characterPaks ?? {})) {
      pakVersions[id] = entry.version;
    }
    quarantineStalePaks(pakVersions)
      .then((parked) => {
        if (parked.length) {
          console.warn(`[unclaw] quarantined stale paks before boot: ${parked.join(', ')}`);
        }
      })
      .catch((err) => console.warn('[unclaw] pak quarantine failed:', err))
      .finally(() => {
        startSoul(mainWindow!).catch((err) => {
          console.warn('[unclaw] startSoul failed:', err);
        });
      });
  }
});

// The synchronous last-mile teardown. Extracted from will-quit so the
// hard-exit watchdog below can run it too: app.exit() skips will-quit
// entirely, and skipping this would leak plaintext BYOK keys and orphan UE.
// Idempotent, so running it twice is harmless.
let finalTeardownDone = false;
function finalTeardown() {
  if (finalTeardownDone) return;
  finalTeardownDone = true;
  globalShortcut.unregisterAll();
  // A second instance that lost the single-instance lock is quitting
  // immediately (line ~1156) and never owned the soul/UE stack. It MUST NOT
  // run the teardown below: the system-wide `pkill -f 'Unclaw Character'`
  // would kill the PRIMARY instance's live UE + MCP children out from under
  // a perfectly healthy session. Only the lock owner tears down the stack.
  if (!gotSingleInstanceLock) return;
  // Wipe the decrypted BYOK bridge so plaintext keys never outlive the app.
  clearSoulKeysBridge();
  // SIGTERM the soul subprocess. Soul's shutdown hooks (UE SIGTERM,
  // MCP subprocess teardown) run cleanly. No-op if soul was attached
  // externally (the user owns that process and we don't kill it).
  stopSoul();
  // Safety net: stopSoul SIGTERMs soul's process group, but two
  // categories of children escape that:
  //   (a) UE Character, launched by soul with start_new_session=True
  //       so it's in its OWN process group, not soul's. Soul's
  //       _on_shutdown hook SIGTERMs UE explicitly, but if soul is
  //       killed before that runs, UE survives as an orphan.
  //   (b) In-tree FastMCP servers (code_exec / screen_capture /
  //       computer_control), soul spawns these as stdio children;
  //       they handle parent-death by exiting on stdin close, but
  //       only AFTER soul actually closes the pipe. If soul wedges,
  //       they linger. The npx-based MCPs (playwright/memory/fs/fetch)
  //       exit cleanly via Node's signal handlers and don't need
  //       a sweep.
  // -f matches the full argv so we catch the .app inner binary AND
  // the python -m mcp_servers/* invocations. Synchronous so each
  // sweep lands before app exit; this is a quit-path safety net so
  // the small spawn cost is fine.
  if (process.platform === 'win32') {
    // Windows: stopSoul() already taskkill /T-reaps the powershell → python
    // → UE tree, and unreal_runtime's Job Object (KILL_ON_JOB_CLOSE) takes
    // UE down with soul. Belt-and-suspenders, force-kill any UE exe that
    // outlived its parent (the launcher AND its -Win64-Shipping child).
    for (const image of ['AudioTestProject02.exe',
                         'AudioTestProject02-Win64-Shipping.exe']) {
      try {
        spawnSync('taskkill', ['/IM', image, '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // not running, fine
      }
    }
  } else {
    // -f matches the full argv so we catch the .app inner binary AND the
    // python -m mcp_servers/* invocations.
    for (const pattern of ['Unclaw Character', 'soul/mcp_servers']) {
      try {
        spawnSync('pkill', ['-f', pattern], { stdio: 'ignore' });
      } catch {
        // pkill missing or denied, launchd will reap orphans whose
        // parent (Electron) just exited.
      }
    }
  }
}

app.on('will-quit', finalTeardown);

app.on('window-all-closed', () => {
  // Unclaw is a single-window foreground experience, not a typical
  // Mac menubar/background app. Closing the window means the user is
  // done; quit (the before-quit hook below owns the full teardown).
  //
  // NOTE: this is a backstop, not the live path. The screenshot overlay is
  // warmed at startup and stays open for the app's life, so "all windows
  // closed" is never actually true. mainWindow's own `closed` handler is
  // what quits us. Do not add a third quit trigger that depends on this one.
  app.quit();
});

// Closing the window (or Cmd+Q) means the user is done — with EVERYTHING.
// stopSoul() alone only reaches the soul child we spawned; an externally
// attached soul (dev flow) and the launchd-managed UE job survived it, so
// closing the app left the character engine burning GPU in the background
// (observed repeatedly, fixed 2026-08-15). shutdownEverything() takes the
// whole tree down — soul, launchd UE job, wilbur, coturn — bounded to
// ~1.6s. before-quit rather than will-quit because the sweep is async and
// will-quit cannot wait; the preventDefault/flag dance runs it exactly once
// and then resumes the quit.
//
// Two hard rules on this path, both learned the hard way:
//   1. NOTHING may block it without a bound. shutdownEverything() shells out
//      to ps and to `launchctl bootout`, and bootout does not return until the
//      UE job is really gone. A wedged UE meant that promise never settled, so
//      the .finally() never ran, app.quit() was never re-issued, and the app
//      sat in the Dock with no window until Force Quit. That is the bug this
//      race exists to make impossible.
//   2. The process MUST end. app.quit() is a request, not a guarantee, so a
//      watchdog force-exits after it, running the same teardown first.
const SHUTDOWN_DEADLINE_MS = 6000;
const HARD_EXIT_MS = 1500;
let fullShutdownDone = false;
let quitting = false;
app.on('before-quit', (event) => {
  quitting = true;
  if (fullShutdownDone) return;
  event.preventDefault();
  fullShutdownDone = true;
  // Instant feedback: the teardown takes a beat, and a window that sits there
  // unresponsive after the user pressed X reads as a hang. Hide first, die
  // second. Safe because the watchdog guarantees the process follows.
  try { mainWindow?.hide(); } catch { /* already destroyed */ }
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, SHUTDOWN_DEADLINE_MS).unref?.();
  });
  void Promise.race([shutdownEverything().catch(() => { /* quitting regardless */ }), deadline])
    .finally(() => {
      app.quit();
      setTimeout(() => {
        // Still here: something re-prevented the quit or a stuck handle is
        // holding the process open. will-quit may never have fired, so run
        // its teardown (idempotent) before exiting for real.
        finalTeardown();
        app.exit(0);
      }, HARD_EXIT_MS).unref?.();
    });
});

// Stream lease: exactly one renderer owns Unreal's frames. Started here so it
// outlives any single window; it reads the soul port per tick, so a soul
// restart on a fresh dynamic port needs no re-arming.
if (process.platform === 'darwin') {
  // Dev-only scriptable toggle: `kill -USR2 <electron pid>` flips the lease
  // remote/back so the whole handoff (freeze, overlay, encoder switchover,
  // media guard, reclaim) can be exercised from a shell with no phone and no
  // devtools. Same path as __unclawStream.lease().
  if (!app.isPackaged) {
    process.on('SIGUSR2', () => {
      const next = streamLease.current() === 'remote' ? null : 'remote';
      console.log(`[lease] SIGUSR2 — forcing ${next ?? 'follow-soul (local)'}`);
      void streamLease.force(next);
    });
  }
  streamLease.start(
    () => getSoulPorts()?.http ?? null,
    () => mainWindow,
    (holder, players) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-lease:changed', { holder, players });
      }
    },
  );
}

app.on('activate', () => {
  // Never resurrect the window mid-quit: clicking the Dock icon during the
  // teardown window used to build a fresh window on a stack being torn down.
  if (quitting) return;
  if (mainWindow === null) createWindow();
});
