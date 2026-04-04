import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  togglePin: (pinned: boolean) => ipcRenderer.send('window:toggle-pin', pinned),
});
