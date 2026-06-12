import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/** Shape of the port mapping the supervisor learns from soul's [ports]
 *  banner (or from ports.json when attaching to an external soul). Kept
 *  in sync with `SoulPorts` in electron/soulSupervisor.ts. */
interface SoulPortsPayload {
  http: number;
  signallingStreamer: number;
  signallingPlayer: number;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls.
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  togglePin: (pinned: boolean) => ipcRenderer.send('window:toggle-pin', pinned),
  /** Force the BrowserWindow to take focus. Used by App.tsx's capture-
   *  phase mousedown listener to defeat the PixelStreaming pointer
   *  capture that would otherwise eat the first click on the streamed
   *  <video> and prevent AppKit from raising the always-on-top window. */
  focusWindow: () => ipcRenderer.send('window:focus'),

  /** Open Terminal.app and run a command. Used by SettingsPanel's
   *  Claude Code subscription card to launch `claude setup-token`
   *  for the user. macOS only, falls back gracefully elsewhere. */
  openTerminalWithCommand: (command: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('terminal:open-with-command', command),

  // ----------------------------------------------------------------------
  // Screenshot, main-window facing.
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
  // Screenshot, overlay-window facing.
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
  // Auth, loopback OAuth flow + safeStorage-backed token persistence.
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
   *  accepts ONE request, caller is responsible for ordering the
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
  // API keys, BYOK (Bring Your Own Keys). Local-only safeStorage blob;
  // the renderer JSON-encodes the full ApiKeysProfile and hands it across
  // as a single string. No cloud sync, no soul wiring yet, scaffolding.
  apiKeysGet: (): Promise<string | null> =>
    ipcRenderer.invoke('apiKeys:get'),
  apiKeysSet: (payload: string): Promise<boolean> =>
    ipcRenderer.invoke('apiKeys:set', payload),
  apiKeysClear: (): Promise<boolean> =>
    ipcRenderer.invoke('apiKeys:clear'),

  // ----------------------------------------------------------------------
  // Soul lifecycle, main spawns (or attaches to) soul on app start and
  // streams stdout/stderr lines through 'soul:log' until the boot
  // marker fires 'soul:ready'. The LoadingScreen subscribes to log;
  // App.tsx subscribes to ready to gate the main UI (and therefore the
  // pixel-streaming connection, which would fail against an unstarted
  // signaling server otherwise).
  soul: {
    /** One-shot snapshot of the current soul state. Used by the
     *  boot screen on mount/refresh to hydrate before subscribing
     *  to future log events, otherwise a Cmd-R after soul booted
     *  leaves the screen waiting on events that already fired. */
    getStatus: (): Promise<{
      ready: boolean;
      recentLogs: { stream: 'stdout' | 'stderr' | 'meta'; line: string }[];
      elapsedMs: number;
      ports: SoulPortsPayload | null;
      failed: boolean;
    }> => ipcRenderer.invoke('soul:get-status'),
    /** User-initiated retry from the boot-failure screen. Tears down any
     *  half-started soul and runs a fresh boot episode. */
    restart: (): Promise<boolean> => ipcRenderer.invoke('soul:restart'),
    /** Latest discovered ports, or null while soul is still booting.
     *  Renderer code that constructs URLs should prefer onPorts() +
     *  the snapshot's ports field over hardcoded 8765/8080/8888. */
    getPorts: (): Promise<SoulPortsPayload | null> =>
      ipcRenderer.invoke('soul:get-ports'),
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
    onPorts: (cb: (ports: SoulPortsPayload) => void): (() => void) => {
      const handler = (_evt: IpcRendererEvent, ports: SoulPortsPayload) =>
        cb(ports);
      ipcRenderer.on('soul:ports', handler);
      return () => ipcRenderer.removeListener('soul:ports', handler);
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
    /** Soul is auto-respawning after an unexpected exit during boot. */
    onRetrying: (
      cb: (data: { attempt: number; max: number }) => void,
    ): (() => void) => {
      const handler = (_evt: IpcRendererEvent, data: { attempt: number; max: number }) => cb(data);
      ipcRenderer.on('soul:retrying', handler);
      return () => ipcRenderer.removeListener('soul:retrying', handler);
    },
    /** Soul boot failed unrecoverably (timeout or exhausted retries). The
     *  boot screen shows a real error + a Retry affordance instead of an
     *  infinite spinner. */
    onFailed: (
      cb: (data: { reason: string; recentErrors: string[] }) => void,
    ): (() => void) => {
      const handler = (
        _evt: IpcRendererEvent,
        data: { reason: string; recentErrors: string[] },
      ) => cb(data);
      ipcRenderer.on('soul:failed', handler);
      return () => ipcRenderer.removeListener('soul:failed', handler);
    },
  },

  // ----------------------------------------------------------------------
  // First-run setup pipeline, provisions the runtime under
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

  // ----------------------------------------------------------------------
  // Auto-updater, runs once per session after setup, before main app.
  // Fetches the remote manifest, compares per category, downloads + swaps
  // any drifted ones. Renderer subscribes to onSnapshot for full state
  // (per-category progress) and calls start() to kick the pipeline.
  // restart() relaunches Unclaw to apply downloaded updates that can't
  // hot-swap (which is currently all of them).
  update: {
    getStatus: (): Promise<UpdateSnapshotShape> =>
      ipcRenderer.invoke('update:get-status'),
    start: (): Promise<UpdateSnapshotShape> =>
      ipcRenderer.invoke('update:start'),
    restart: (): Promise<void> => ipcRenderer.invoke('update:restart'),
    onSnapshot: (cb: (snap: UpdateSnapshotShape) => void): (() => void) => {
      const handler = (_evt: IpcRendererEvent, snap: UpdateSnapshotShape) => cb(snap);
      ipcRenderer.on('update:snapshot', handler);
      return () => ipcRenderer.removeListener('update:snapshot', handler);
    },
    onLog: (cb: (line: string) => void): (() => void) => {
      const handler = (_evt: IpcRendererEvent, line: string) => cb(line);
      ipcRenderer.on('update:log', handler);
      return () => ipcRenderer.removeListener('update:log', handler);
    },
  },

  // ----------------------------------------------------------------------
  // Character store. Renderer fetches the presigned pak URL from the store
  // Worker (it holds the auth token) and hands it here for the heavy
  // download/verify/extract. Plus the unclaw:// deep link that the Polar
  // checkout-complete page bounces through to wake the app.
  characterStore: {
    downloadPak: (args: {
      characterId: string;
      url: string;
    }): Promise<{ ok: boolean; dir?: string; mountPath?: string | null; error?: string }> =>
      ipcRenderer.invoke('character-store:download-pak', args),
    listInstalled: (): Promise<{ ids: string[] }> =>
      ipcRenderer.invoke('character-store:list-installed'),
    // Cloned-voice install. The voice files ride in the same private,
    // entitlement-gated bucket as the pak; the renderer fetches presigned URLs
    // and hands them here. hasVoices lets the renderer skip the fetch when the
    // files are already on disk (already-owned, warm case).
    hasVoices: (args: { characterId: string }): Promise<{
      ok: boolean; present?: { supertonic: boolean; kokoro: boolean }; complete?: boolean; error?: string;
    }> => ipcRenderer.invoke('character-store:has-voices', args),
    downloadVoices: (args: {
      characterId: string;
      files: { kind: 'supertonic' | 'kokoro'; filename: string; url: string }[];
    }): Promise<{ ok: boolean; written?: number; error?: string }> =>
      ipcRenderer.invoke('character-store:download-voices', args),
    onPakProgress: (
      cb: (data: { characterId: string; downloaded: number; total: number }) => void,
    ): (() => void) => {
      const handler = (
        _evt: IpcRendererEvent,
        data: { characterId: string; downloaded: number; total: number },
      ) => cb(data);
      ipcRenderer.on('character-store:pak-progress', handler);
      return () => ipcRenderer.removeListener('character-store:pak-progress', handler);
    },
  },

  // Deep link (unclaw://...). onDeepLink fires for links that arrive while
  // running; getPendingDeepLink pulls one that arrived during cold start.
  onDeepLink: (cb: (url: string) => void): (() => void) => {
    const handler = (_evt: IpcRendererEvent, url: string) => cb(url);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },
  getPendingDeepLink: (): Promise<string | null> =>
    ipcRenderer.invoke('deep-link:get-pending'),
});

// Shape mirror of updateCoordinator.UpdateSnapshot, kept inline rather than
// imported because preload runs in a separate bundle that can't see TS-only
// types from the main process bundle.
type UpdateCategoryStateShape =
  | 'pending' | 'downloading' | 'applying' | 'ready' | 'failed' | 'up-to-date';
interface UpdateCategoryProgressShape {
  id: 'app' | 'soul' | 'unreal' | 'assets';
  state: UpdateCategoryStateShape;
  progress: number | null;
  detail?: string;
  from: string | null;
  to: string;
}
interface UpdateSnapshotShape {
  done: boolean;
  categories: UpdateCategoryProgressShape[];
  restartRequired: boolean;
  fatalError: string | null;
}
