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

  // ----------------------------------------------------------------------
  // Auth — loopback OAuth flow + safeStorage-backed token persistence.
  // The renderer drives the UX (sign-in screen, status state); main
  // owns the OS-level pieces (custom protocol, encrypted token file,
  // shell.openExternal).
  authOpenExternal: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('auth:open-external', url),
  authSetToken: (token: string): Promise<boolean> =>
    ipcRenderer.invoke('auth:set-token', token),
  authGetToken: (): Promise<string | null> =>
    ipcRenderer.invoke('auth:get-token'),
  authClearToken: (): Promise<boolean> =>
    ipcRenderer.invoke('auth:clear-token'),
  /** Spin up the loopback HTTP server and resolve when the OAuth
   *  provider hits it (or on error/timeout/cancel). The server only
   *  accepts ONE request — caller is responsible for ordering the
   *  call BEFORE openExternal so no callback can race the listener. */
  authStartOAuthLoopback: (): Promise<{
    code: string | null
    state: string | null
    error: string | null
  }> => ipcRenderer.invoke('auth:start-oauth-loopback'),
  /** Cancel a pending OAuth flow (closes the loopback server). */
  authCancelOAuthLoopback: (): Promise<boolean> =>
    ipcRenderer.invoke('auth:cancel-oauth-loopback'),

  // ----------------------------------------------------------------------
  // API keys — BYOK (Bring Your Own Keys). Local-only safeStorage blob;
  // the renderer JSON-encodes the full ApiKeysProfile and hands it across
  // as a single string. No cloud sync, no soul wiring yet — scaffolding.
  apiKeysGet: (): Promise<string | null> =>
    ipcRenderer.invoke('apiKeys:get'),
  apiKeysSet: (payload: string): Promise<boolean> =>
    ipcRenderer.invoke('apiKeys:set', payload),
  apiKeysClear: (): Promise<boolean> =>
    ipcRenderer.invoke('apiKeys:clear'),

  // ----------------------------------------------------------------------
  // Soul lifecycle — main spawns (or attaches to) soul on app start and
  // streams stdout/stderr lines through 'soul:log' until the boot
  // marker fires 'soul:ready'. The LoadingScreen subscribes to log;
  // App.tsx subscribes to ready to gate the main UI (and therefore the
  // pixel-streaming connection, which would fail against an unstarted
  // signaling server otherwise).
  soul: {
    /** One-shot snapshot of the current soul state. Used by the
     *  boot screen on mount/refresh to hydrate before subscribing
     *  to future log events — otherwise a Cmd-R after soul booted
     *  leaves the screen waiting on events that already fired. */
    getStatus: (): Promise<{
      ready: boolean;
      recentLogs: { stream: 'stdout' | 'stderr' | 'meta'; line: string }[];
      elapsedMs: number;
    }> => ipcRenderer.invoke('soul:get-status'),
    onLog: (
      cb: (data: { stream: 'stdout' | 'stderr' | 'meta'; line: string }) => void,
    ): (() => void) => {
      const handler = (
        _evt: IpcRendererEvent,
        data: { stream: 'stdout' | 'stderr' | 'meta'; line: string },
      ) => cb(data);
      ipcRenderer.on('soul:log', handler);
      return () => ipcRenderer.removeListener('soul:log', handler);
    },
    onReady: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('soul:ready', handler);
      return () => ipcRenderer.removeListener('soul:ready', handler);
    },
    onExit: (
      cb: (data: { code: number | null; signal: NodeJS.Signals | null }) => void,
    ): (() => void) => {
      const handler = (
        _evt: IpcRendererEvent,
        data: { code: number | null; signal: NodeJS.Signals | null },
      ) => cb(data);
      ipcRenderer.on('soul:exit', handler);
      return () => ipcRenderer.removeListener('soul:exit', handler);
    },
  },

  // ----------------------------------------------------------------------
  // First-run setup pipeline — provisions the runtime under
  // ~/Library/Application Support/Unclaw/runtime/ on a packaged install
  // (downloads UE app, creates Python venv, fetches model assets). The
  // SetupWizard subscribes to onLog/onStage for live progress; start()
  // triggers the pipeline. In dev / unpackaged renderers, getStatus
  // returns isComplete=true and the gate immediately falls through.
  setup: {
    getStatus: (): Promise<{
      isComplete: boolean;
      releaseTag: string;
      stage: {
        id: 'preflight' | 'runtime' | 'unreal' | 'models' | 'complete' | 'failed';
        progress: number | null;
        headline: string;
        detail?: string;
      };
      recentLogs: { stream: 'stdout' | 'stderr' | 'meta'; line: string }[];
      lastError: string | null;
    }> => ipcRenderer.invoke('setup:get-status'),
    start: (): Promise<boolean> => ipcRenderer.invoke('setup:start'),
    onLog: (
      cb: (data: { stream: 'stdout' | 'stderr' | 'meta'; line: string }) => void,
    ): (() => void) => {
      const handler = (
        _evt: IpcRendererEvent,
        data: { stream: 'stdout' | 'stderr' | 'meta'; line: string },
      ) => cb(data);
      ipcRenderer.on('setup:log', handler);
      return () => ipcRenderer.removeListener('setup:log', handler);
    },
    onStage: (
      cb: (data: {
        id: 'preflight' | 'runtime' | 'unreal' | 'models' | 'complete' | 'failed';
        progress: number | null;
        headline: string;
        detail?: string;
      }) => void,
    ): (() => void) => {
      const handler = (
        _evt: IpcRendererEvent,
        data: {
          id: 'preflight' | 'runtime' | 'unreal' | 'models' | 'complete' | 'failed';
          progress: number | null;
          headline: string;
          detail?: string;
        },
      ) => cb(data);
      ipcRenderer.on('setup:stage', handler);
      return () => ipcRenderer.removeListener('setup:stage', handler);
    },
  },
});
