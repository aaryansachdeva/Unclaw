import { app, BrowserWindow, screen, ipcMain, session, Tray, Menu, nativeImage } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 760;
const EDGE_MARGIN = 16;

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

  // electron-vite sets this env var in dev mode
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

app.whenReady().then(() => {
  // Grant microphone + media-device access to the renderer so the voice
  // agent's `navigator.mediaDevices.getUserMedia({audio:true})` works.
  // Electron rejects all permission requests by default, which silently
  // fails getUserMedia with NotAllowedError -- that's the "mic button
  // doesn't do anything" symptom. Allow the specific permissions UnClaw
  // needs; everything else still goes through Chromium's default deny.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ['media', 'audioCapture', 'mediaKeySystem'];
    cb(allowed.includes(permission));
  });
  // Some Electron versions also gate via this synchronous check.
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'audioCapture', 'mediaKeySystem'].includes(permission);
  });
  // Auto-pick a device when getUserMedia gets called without picking one.
  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'audioInput' || details.deviceType === 'audioOutput') {
      return true;
    }
    return false;
  });

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
