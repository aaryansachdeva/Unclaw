import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  session,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  desktopCapturer,
  Display,
  IpcMainEvent,
} from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Holds the in-flight capture's source image + display while the
// overlay is open. Cleared on commit or cancel. Single capture at a
// time; the shortcut is debounced via overlayWindow.isVisible().
let pendingCapture: { image: Electron.NativeImage; display: Display } | null = null;

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 760;
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

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: screenW - WINDOW_WIDTH - EDGE_MARGIN,
    y: Math.round((screenH - WINDOW_HEIGHT) / 2),
    frame: false,
    transparent: false,
    backgroundColor: '#050506',
    alwaysOnTop: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    minWidth: 320,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
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
ipcMain.on('window:close', () => mainWindow?.hide());
ipcMain.on('window:toggle-pin', (_event, pinned: boolean) => {
  mainWindow?.setAlwaysOnTop(pinned, 'floating');
});

// IPC: renderer can also kick off a screenshot manually (e.g. a button).
ipcMain.on('screenshot:trigger', () => {
  void triggerScreenshot();
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ['media', 'audioCapture', 'mediaKeySystem'];
    cb(allowed.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'audioCapture', 'mediaKeySystem'].includes(permission);
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
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
