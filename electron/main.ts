import { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 620;
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
    minWidth: 280,
    minHeight: 400,
    maxWidth: 600,
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
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
