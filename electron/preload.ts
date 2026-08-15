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
  /** Host OS, surfaced from the main process so the renderer never has to
   *  sniff navigator.userAgent/platform. 'darwin' | 'win32' | 'linux'. */
  platform: process.platform,

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

  /** Microphone permission (macOS). `requestMic` proactively triggers the OS
   *  prompt (or resolves false if already denied) BEFORE getUserMedia so voice
   *  mode never fails silently. `getMicStatus` reads current access, and
   *  `openMicSettings` jumps to the Privacy > Microphone pane. */
  mic: {
    getStatus: (): Promise<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'> =>
      ipcRenderer.invoke('mic:get-status'),
    request: (): Promise<boolean> => ipcRenderer.invoke('mic:request'),
    openSettings: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('mic:open-settings'),
  },

  // ----------------------------------------------------------------------
  // Screenshot, main-window facing.
  // The main React app calls `triggerScreenshot()` to fire the overlay
  // (same effect as the global Ctrl+Shift+G). It then subscribes to
  // `onScreenshotCaptured` to receive the cropped PNG (base64) plus
  // the dimensions.
  // TEMP(revert): Cmd+H all-chrome hide toggle. Fired from main's globalShortcut.
  onTempToggleUi: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('temp:toggle-ui', handler);
    return () => ipcRenderer.removeListener('temp:toggle-ui', handler);
  },

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
  getLocalOwner: (): Promise<string | null> =>
    ipcRenderer.invoke('localOwner:get'),
  setLocalOwner: (ownerId: string): Promise<boolean> =>
    ipcRenderer.invoke('localOwner:set', ownerId),
  clearLocalOwner: (): Promise<boolean> =>
    ipcRenderer.invoke('localOwner:clear'),

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
    /** Reveal the logs folder in Finder/Explorer. Surfaced from the boot
     *  screen so a user hitting a stuck launch can grab logs for support. */
    openLogs: (): Promise<boolean> => ipcRenderer.invoke('system:open-logs'),
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
    listInstalled: (): Promise<{ ids: string[]; stale: string[] }> =>
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

  // Photo identity (DEV local inference). Renderer downloads the capture zip
  // (it holds the auth token) and hands the bytes here; main runs the local
  // pipeline and returns UE-container paths for the applyIdentity descriptor.
  identity: {
    runInference: (args: { sessionId: string; zipBytes: Uint8Array; groom?: unknown }): Promise<{
      ok: boolean; dnaPath?: string; blobPath?: string; baseColorPath?: string;
      grooming?: { gender: 'm' | 'f'; hairIndex: number; browIndex: number; lashIndex: number }; error?: string;
    }> => ipcRenderer.invoke('identity:run-inference', args),
    runPhotoInference: (args: { localId: string; photoBytes: Uint8Array; ext: 'jpg' | 'png'; groom?: unknown }): Promise<{
      ok: boolean; dnaPath?: string; blobPath?: string; baseColorPath?: string;
      grooming?: { gender: 'm' | 'f'; hairIndex: number; browIndex: number; lashIndex: number }; error?: string;
    }> => ipcRenderer.invoke('identity:run-inference-photo', args),
    /** H3D tier: gen-3D bust -> conform -> rigged character. Minutes, not seconds. */
    runH3D: (args: {
      localId: string; photoBytes: Uint8Array; ext: 'jpg' | 'png';
      catalogs?: { hairs: { index: number; name: string }[]; brows: { index: number; name: string }[]; lashes: { index: number; name: string }[] };
    }): Promise<{
      ok: boolean; dnaPath?: string; jointsPath?: string; bustPath?: string; cleanImagePath?: string;
      baseColorPath?: string; normalPath?: string;
      grooming?: { gender: 'm' | 'f'; build: 'skinny' | 'fit' | 'fat'; hairIndex: number; browIndex: number; lashIndex: number;
        hairColor?: string; eyeColor?: string;
        hairColorParams?: { melanin: number; redness: number }; irisVariant?: string };
      error?: string;
    }> => ipcRenderer.invoke('identity:run-h3d', args),
    /** Re-roll ONLY the skin texture for a character that already exists.
     *  Seconds, one image call, no Rodin credit and no headless UE boot. */
    regenBasecolor: (args: { localId: string }): Promise<{
      ok: boolean; baseColorPath?: string;
      skins?: Array<{ path: string; label: string }>; error?: string;
    }> => ipcRenderer.invoke('identity:regen-basecolor', args),
    /** Every skin generated for this character, oldest first. */
    listBasecolors: (args: { localId: string }): Promise<{
      ok: boolean; skins: Array<{ path: string; label: string }>;
    }> => ipcRenderer.invoke('identity:list-basecolors', args),
    onProgress: (cb: (data: { stage: string; line: string }) => void): (() => void) => {
      const handler = (_evt: IpcRendererEvent, data: { stage: string; line: string }) => cb(data);
      ipcRenderer.on('identity:progress', handler);
      return () => ipcRenderer.removeListener('identity:progress', handler);
    },
  },

  /** Direct IOSurface display status. `connected` false means the WebRTC video
   *  is still what the user is seeing, so the renderer must keep showing it. */
  directSurface: {
    /** '1' native layer, '2' shared-texture canvas, null when off. The
     *  renderer needs this to decide between hiding its backgrounds (mode 1)
     *  and showing the stream canvas (mode 2). */
    mode: process.platform === 'darwin'
      && (process.env.UNCLAW_DIRECT_SURFACE === '1' || process.env.UNCLAW_DIRECT_SURFACE === '2')
      ? process.env.UNCLAW_DIRECT_SURFACE
      : null,
    onStatus: (cb: (s: { connected: boolean; frames: number; gaps: number;
                         fps: number; surfaces: number }) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, s: { connected: boolean; frames: number;
        gaps: number; fps: number; surfaces: number }) => cb(s);
      ipcRenderer.on('direct-surface:status', handler);
      return () => ipcRenderer.removeListener('direct-surface:status', handler);
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

// ---------------------------------------------------------------------------
// Direct surface, mode 2: draw Unreal's frames onto the in-page canvas.
//
// The main process imports each IOSurface into Chromium's GPU process and
// transfers it here; getVideoFrame() yields a real web VideoFrame backed by
// that GPU texture, and drawImage moves it onto the canvas without the pixels
// ever visiting the CPU. Because the canvas is ordinary page content, every
// CSS effect (backdrop-filter included) works over the character again.
//
// This lives in the preload rather than the React tree because the electron
// `sharedTexture` module is only reachable here (the window runs with
// sandbox: false for exactly this reason, context isolation still on). The
// preload shares the page's DOM, so it can draw straight onto the canvas that
// StreamView renders; the two sides rendezvous on the data attribute alone.
if (process.platform === 'darwin' && process.env.UNCLAW_DIRECT_SURFACE === '2') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sharedTexture } = require('electron');
  if (!sharedTexture?.setSharedTextureReceiver) {
    console.error('[direct-canvas] electron.sharedTexture missing in preload; is the window sandboxed?');
  } else {
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let drawn = 0;
    let dropped = 0;

    // One transferred texture per ring surface, held for the connection's
    // life; frames are just "surface N updated" pings after that. Mirrors how
    // mode 1 wraps each surface as a Metal texture exactly once: re-importing
    // per frame degraded Chromium's view of the surfaces to solid white after
    // ~a minute even though the sources stayed perfect.
    const heldTextures = new Map<number, { getVideoFrame(): VideoFrame; release(): void }>();

    sharedTexture.setSharedTextureReceiver(async (data: {
      importedSharedTexture: { getVideoFrame(): VideoFrame; release(): void };
    }, meta?: { surfaceId?: number }) => {
      const sid = meta?.surfaceId;
      if (typeof sid !== 'number') {
        // Unknown shape; release rather than leak.
        data.importedSharedTexture.release();
        return;
      }
      heldTextures.get(sid)?.release();
      heldTextures.set(sid, data.importedSharedTexture);
      console.log(`[direct-canvas] surface ${sid} received (${heldTextures.size} held)`);
    });

    const drawSurface = (sid: number) => {
      const held = heldTextures.get(sid);
      if (!held) { dropped++; return; }
      try {
        if (!canvas || !canvas.isConnected) {
          canvas = document.querySelector<HTMLCanvasElement>('canvas[data-direct-canvas]');
          ctx = canvas
            ? canvas.getContext('2d', { alpha: false, willReadFrequently: true })
            : null;
          if (!canvas || !ctx) { dropped++; return; }
          // Unreal's backbuffer carries alpha 0: it renders colour and never
          // writes alpha (WebRTC discarded it at encode, so nothing upstream
          // cares). Source-over with srcAlpha=0 degenerates to dst = src + dst,
          // so every draw ADDS the frame to the canvas and the picture
          // saturates to solid white within four frames. Mode 1 fixed the same
          // bug with layer.opaque = YES; 'copy' is that fix for canvas:
          // replace, never blend.
          ctx.globalCompositeOperation = 'copy';
        }
        // EXPERIMENT: no vf.close(). Every lifecycle variant that closed the
        // frame went solid white from the second draw of a surface onward,
        // across per-frame and import-once flows and across three canvas
        // types, while the sources stayed perfect. If frames stay good
        // without close(), the close is what kills the shared image.
        const vf = held.getVideoFrame();
        try {
          if (canvas.width !== vf.displayWidth || canvas.height !== vf.displayHeight) {
            canvas.width = vf.displayWidth;
            canvas.height = vf.displayHeight;
            // Resizing resets canvas state, including the composite op.
            ctx!.globalCompositeOperation = 'copy';
          }
          ctx!.drawImage(vf, 0, 0);
        } finally {
          // Never the culprit (the white was alpha accumulation), and closing
          // per draw is the leak-free lifecycle.
          vf.close();
        }
        drawn++;
        if (drawn === 1 || drawn % 1800 === 0) {
          let centre = 'n/a';
          try {
            const cells: string[] = [];
            for (const fy of [0.2, 0.5, 0.8]) {
              for (const fx of [0.2, 0.5, 0.8]) {
                const px = ctx!.getImageData((canvas.width * fx) | 0, (canvas.height * fy) | 0, 1, 1).data;
                cells.push(`${px[0].toString(16).padStart(2, '0')}${px[1].toString(16).padStart(2, '0')}${px[2].toString(16).padStart(2, '0')}`);
              }
            }
            centre = cells.join(',');
          } catch { /* diagnostic only */ }
          console.log(`[direct-canvas] drawn=${drawn} dropped=${dropped} ${canvas.width}x${canvas.height} grid=${centre}`);
        }
      } catch (err) {
        if (dropped++ < 3) console.error('[direct-canvas] draw failed:', err);
      }
    };

    ipcRenderer.on('direct-surface:frame', (_e, f: { surfaceId: number }) => {
      drawSurface(f.surfaceId);
    });
    ipcRenderer.on('direct-surface:reset', () => {
      for (const t of heldTextures.values()) { try { t.release(); } catch { /* gone */ } }
      heldTextures.clear();
      console.log('[direct-canvas] reset: released all held textures');
    });
    console.log('[direct-canvas] shared texture receiver registered');
  }
}
