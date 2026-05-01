import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls.
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  togglePin: (pinned: boolean) => ipcRenderer.send('window:toggle-pin', pinned),

  // ----------------------------------------------------------------------
  // Screenshot — main-window facing.
  // The main React app calls `triggerScreenshot()` to fire the overlay
  // (same effect as the global Ctrl+Shift+G). It then subscribes to
  // `onScreenshotCaptured` to receive the cropped PNG (base64) plus
  // the dimensions.
  triggerScreenshot: () => ipcRenderer.send('screenshot:trigger'),
  onScreenshotCaptured: (
    cb: (payload: { base64: string; width: number; height: number }) => void,
  ): (() => void) => {
    const handler = (
      _evt: IpcRendererEvent,
      payload: { base64: string; width: number; height: number },
    ) => cb(payload);
    ipcRenderer.on('screenshot:captured', handler);
    return () => ipcRenderer.removeListener('screenshot:captured', handler);
  },

  // ----------------------------------------------------------------------
  // Screenshot — overlay-window facing.
  // Used by the inline overlay HTML loaded into the pre-warmed overlay
  // BrowserWindow. The same preload script is reused for both windows
  // since contextIsolation:true keeps the surfaces parallel.
  notifyOverlayReady: () => ipcRenderer.send('screenshot:overlay-ready'),
  onOverlayShow: (
    cb: (data: { dataUrl: string }) => void,
  ): (() => void) => {
    const handler = (_evt: IpcRendererEvent, data: { dataUrl: string }) =>
      cb(data);
    ipcRenderer.on('screenshot:overlay-show', handler);
    return () => ipcRenderer.removeListener('screenshot:overlay-show', handler);
  },
  completeScreenshot: (
    rect: { x: number; y: number; w: number; h: number },
  ) => ipcRenderer.send('screenshot:complete', rect),
  cancelScreenshot: () => ipcRenderer.send('screenshot:cancel'),
});
