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
// that GPU texture. A WebGPU render pass samples it as an external texture
// straight onto the canvas: no raster work, no copy, the pixels never visit
// the CPU. Because the canvas is ordinary page content, every CSS effect
// (backdrop-filter included) works over the character again.
//
// Canvas 2D drawImage was the first implementation and measured ~22.5% app
// CPU against mode 1's 11.4%: Skia routes VideoFrame draws through its
// general 2D raster pipeline. importExternalTexture is the WebCodecs-blessed
// zero-copy path (webcodecsfundamentals.org benchmarks it fastest by a wide
// margin), so 2D survives below only as the fallback when WebGPU is missing
// or the device is lost.
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

    // Ground-truth status mirror. The contextBridge onStatus callback used to
    // be the ONLY route by which React learned the direct path was live, and
    // on 2026-08-15 that route silently failed: frames flowed and drew at
    // 23.8fps while React's directLive stayed false, so the character sat
    // fully rendered but hidden behind the backdrop gradient. The DOM is
    // shared between the preload world and the page, so every status tick is
    // mirrored into a data attribute + DOM event; React reads the attribute,
    // which cannot go stale or miss a subscription window.
    ipcRenderer.on('direct-surface:status', (_e, s: { connected: boolean }) => {
      try {
        document.documentElement.dataset.unclawDirectLive = s.connected ? '1' : '0';
        document.dispatchEvent(new Event('unclaw:direct-status'));
      } catch { /* document not ready yet; next tick in 2s */ }
    });

    // Render-path selector. 'video' (default) pipes the frames into a
    // MediaStreamTrackGenerator feeding a <video> element, which rides
    // Chromium's dedicated video frame-submission path: no paint, video
    // power optimisations. 'gpu' draws via a WebGPU external-texture pass
    // instead. Both are zero-copy; measured 2026-08-15 at native res, same
    // scene: video 19.0% app CPU, webgpu 21.9%, canvas-2d 22.5%. Failures
    // cascade video -> gpu -> 2d, all landing on the same canvas element.
    let renderVia: 'gpu' | 'video' = process.env.UNCLAW_DIRECT_RENDER === 'gpu' ? 'gpu' : 'video';
    let videoStrikes = 0;

    // WebGPU state. The device/pipeline need no canvas, so they initialise
    // eagerly; the canvas context is configured on first draw. gpuFailed
    // flips the whole path over to the 2D fallback permanently.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let gpuReady: { device: any; pipeline: any; sampler: any } | null = null;
    let gpuFailed = false;
    let gpuStrikes = 0;
    let gpuCtx: any = null;
    let readback: any = null;
    let readbackBusy = false;

    // Fullscreen triangle sampling the frame as an external texture. Alpha is
    // forced to 1 in the shader AND the canvas is configured opaque: Unreal's
    // backbuffer carries alpha 0 (see the 2D path's 'copy' saga) and nothing
    // downstream may ever blend with it.
    const WGSL = `
      struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
        var p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        var o: VSOut;
        o.pos = vec4f(p[i], 0.0, 1.0);
        o.uv = vec2f(p[i].x * 0.5 + 0.5, 1.0 - (p[i].y * 0.5 + 0.5));
        return o;
      }
      @group(0) @binding(0) var t: texture_external;
      @group(0) @binding(1) var s: sampler;
      @fragment fn fs(v: VSOut) -> @location(0) vec4f {
        return vec4f(textureSampleBaseClampToEdge(t, s, v.uv).rgb, 1.0);
      }
    `;

    (async () => {
      // Initialised even when the video path is primary: an idle device costs
      // nothing and it is the first fallback if the generator path dies.
      try {
        const g = (navigator as any).gpu;
        if (!g) throw new Error('navigator.gpu unavailable');
        const adapter = await g.requestAdapter();
        if (!adapter) throw new Error('requestAdapter returned null');
        const device = await adapter.requestDevice();
        device.lost.then((info: any) => {
          console.error('[direct-canvas] WebGPU device lost:', info?.message);
          gpuReady = null;
          gpuCtx = null;
          gpuFailed = true;
        });
        const module = device.createShaderModule({ code: WGSL });
        const pipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format: g.getPreferredCanvasFormat() }] },
          primitive: { topology: 'triangle-list' },
        });
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        gpuReady = { device, pipeline, sampler };
        console.log('[direct-canvas] WebGPU pipeline ready');
      } catch (e) {
        gpuFailed = true;
        console.error('[direct-canvas] WebGPU unavailable, using 2D fallback:', e);
      }
    })();

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

    // Primary path. Bind group and external texture are per-frame by spec
    // (external textures expire with their VideoFrame); both are trivially
    // cheap. The once-a-minute health grid is a GPU readback via
    // copyTextureToBuffer, since a webgpu canvas has no getImageData.
    const drawWebGpu = (vf: VideoFrame): void => {
      const g = gpuReady!;
      if (!gpuCtx) {
        gpuCtx = (canvas as any).getContext('webgpu');
        if (!gpuCtx) throw new Error('webgpu context unavailable (canvas already 2d?)');
        gpuCtx.configure({
          device: g.device,
          format: (navigator as any).gpu.getPreferredCanvasFormat(),
          alphaMode: 'opaque',
          usage: 0x10 | 0x01, // RENDER_ATTACHMENT | COPY_SRC (health grid)
        });
      }
      if (canvas!.width !== vf.displayWidth || canvas!.height !== vf.displayHeight) {
        canvas!.width = vf.displayWidth;
        canvas!.height = vf.displayHeight;
      }
      const ext = g.device.importExternalTexture({ source: vf });
      const bind = g.device.createBindGroup({
        layout: g.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: ext },
          { binding: 1, resource: g.sampler },
        ],
      });
      const enc = g.device.createCommandEncoder();
      const tex = gpuCtx.getCurrentTexture();
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: tex.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(g.pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();

      const sampling = (drawn === 0 || (drawn + 1) % 1800 === 0) && !readbackBusy;
      if (sampling) {
        if (!readback) {
          readback = g.device.createBuffer({ size: 9 * 256, usage: 0x0001 | 0x0008 }); // MAP_READ | COPY_DST
        }
        let i = 0;
        for (const fy of [0.2, 0.5, 0.8]) {
          for (const fx of [0.2, 0.5, 0.8]) {
            enc.copyTextureToBuffer(
              { texture: tex, origin: { x: (canvas!.width * fx) | 0, y: (canvas!.height * fy) | 0 } },
              { buffer: readback, offset: i++ * 256 },
              { width: 1, height: 1 },
            );
          }
        }
      }
      g.device.queue.submit([enc.finish()]);
      if (sampling) {
        readbackBusy = true;
        const atDraw = drawn + 1;
        const w = canvas!.width; const h = canvas!.height;
        readback.mapAsync(0x0001 /* READ */).then(() => {
          // Canvas format on macOS is bgra8unorm.
          const bytes = new Uint8Array(readback.getMappedRange());
          const cells: string[] = [];
          for (let j = 0; j < 9; j++) {
            const o = j * 256;
            cells.push(`${bytes[o + 2].toString(16).padStart(2, '0')}${bytes[o + 1].toString(16).padStart(2, '0')}${bytes[o].toString(16).padStart(2, '0')}`);
          }
          readback.unmap();
          console.log(`[direct-canvas] drawn=${atDraw} dropped=${dropped} ${w}x${h} grid=${cells.join(',')} (webgpu)`);
        }).catch(() => { /* diagnostic only */ }).finally(() => { readbackBusy = false; });
      }
    };

    // Fallback path: canvas 2D with 'copy'. Unreal's backbuffer carries alpha
    // 0 (WebRTC discarded it at encode, so nothing upstream cares); with
    // source-over that degenerates to dst = src + dst and the picture
    // saturates to solid white within four frames. 'copy' replaces, never
    // blends: the same fix mode 1 makes with layer.opaque = YES.
    const draw2d = (vf: VideoFrame): void => {
      if (!ctx) {
        ctx = canvas!.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('2d context unavailable');
        ctx.globalCompositeOperation = 'copy';
      }
      if (canvas!.width !== vf.displayWidth || canvas!.height !== vf.displayHeight) {
        canvas!.width = vf.displayWidth;
        canvas!.height = vf.displayHeight;
        // Resizing resets canvas state, including the composite op.
        ctx.globalCompositeOperation = 'copy';
      }
      ctx.drawImage(vf, 0, 0);
      if (drawn === 0 || (drawn + 1) % 1800 === 0) {
        let grid = 'n/a';
        try {
          const cells: string[] = [];
          for (const fy of [0.2, 0.5, 0.8]) {
            for (const fx of [0.2, 0.5, 0.8]) {
              const px = ctx.getImageData((canvas!.width * fx) | 0, (canvas!.height * fy) | 0, 1, 1).data;
              cells.push(`${px[0].toString(16).padStart(2, '0')}${px[1].toString(16).padStart(2, '0')}${px[2].toString(16).padStart(2, '0')}`);
            }
          }
          grid = cells.join(',');
        } catch { /* diagnostic only */ }
        console.log(`[direct-canvas] drawn=${drawn + 1} dropped=${dropped} ${canvas!.width}x${canvas!.height} grid=${grid} (2d)`);
      }
    };

    // 'video' path: hand each frame to a MediaStreamTrackGenerator whose
    // track feeds a <video> element injected beside the canvas. Ownership of
    // the VideoFrame transfers to the sink on write, so the caller must NOT
    // close a frame this function accepted. Visibility mirrors the canvas so
    // StreamView's directLive toggle keeps working untouched.
    let gen: any = null;
    let genWriter: any = null;
    let videoEl: HTMLVideoElement | null = null;
    let diag: HTMLCanvasElement | null = null;
    let writeFails = 0;
    let lastFrameAt = 0;

    // The preload OWNS the injected video element's visibility, because it is
    // the one part of the system that provably knows whether frames are
    // flowing (it is handing them to the sink). React's directLive is
    // cosmetics (vignette, gamut class) and must never be able to hide the
    // character. z-index 1 keeps the element above the (transparent, idle)
    // WebRTC video regardless of what React shows or hides around it; the
    // page UI lives in later stacking contexts and stays on top.
    const teardownVideoPipeline = (why: string): void => {
      console.error('[direct-canvas] rebuilding video pipeline:', why);
      try { videoEl?.remove(); } catch { /* gone */ }
      videoEl = null;
      gen = null;
      genWriter = null;
      writeFails = 0;
    };

    // Frames-stalled watchdog: if nothing has been drawn for 2.5s the picture
    // is stale; hide it so the WebRTC fallback (or the loading state) shows
    // instead of a frozen frame.
    setInterval(() => {
      if (videoEl && lastFrameAt && Date.now() - lastFrameAt > 2500
          && videoEl.style.visibility !== 'hidden') {
        videoEl.style.visibility = 'hidden';
        console.log('[direct-canvas] frames stalled >2.5s, hiding video');
      }
    }, 1000);

    const drawVideo = (vf: VideoFrame): void => {
      const MSTG = (window as any).MediaStreamTrackGenerator;
      if (!MSTG) throw new Error('MediaStreamTrackGenerator unavailable');
      if (!gen) {
        gen = new MSTG({ kind: 'video' });
        genWriter = gen.writable.getWriter();
      }
      if (!videoEl || !videoEl.isConnected) {
        videoEl = document.createElement('video');
        videoEl.muted = true;
        videoEl.autoplay = true;
        videoEl.setAttribute('playsinline', '');
        videoEl.dataset.directVideo = '1';
        videoEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;visibility:hidden;';
        // Gamut match (2026-08-18): UE lights its scenes against an
        // UNMANAGED window, which a P3 display shows punchy; Chromium
        // color-manages our frames as sRGB and renders them flatter than
        // authored. Reuse the WebRTC path's P3-to-sRGB feColorMatrix
        // (defined by StreamView, same toggle key). Tagging the imported
        // texture as P3 instead renders black through the generator path —
        // see directSurface.ts.
        try {
          if (localStorage.getItem('unclaw-stream-gamut-off') == null
              && document.getElementById('ue-gamut-match')) {
            videoEl.style.filter = 'url(#ue-gamut-match)';
          }
        } catch { /* filter is cosmetic */ }
        canvas!.style.display = 'none';
        canvas!.parentElement!.insertBefore(videoEl, canvas!);
        videoEl.srcObject = new MediaStream([gen]);
        videoEl.play().catch(() => { /* muted autoplay is allowed */ });
      }
      lastFrameAt = Date.now();
      if (videoEl.style.visibility !== 'visible') videoEl.style.visibility = 'visible';
      // Unreal's backbuffer carries alpha 0 and, unlike the canvas paths, the
      // video pipeline honours it: raw frames display as pure black. The
      // clone-with-discard marks the frame opaque (metadata, not pixels).
      let out: VideoFrame = vf;
      let wrapped = false;
      try {
        out = new VideoFrame(vf, { alpha: 'discard' } as VideoFrameInit);
        wrapped = true;
      } catch { /* older runtime: send the raw frame and hope */ }
      genWriter.write(out).then(() => { writeFails = 0; }).catch((e: unknown) => {
        if (dropped++ < 3) console.error('[direct-canvas] generator write failed:', e);
        // A WritableStream that errors once rejects every write after it, so
        // a poisoned writer would otherwise mean a permanently black stream
        // while every counter looks healthy. Three consecutive failures =
        // scrap the generator, element and writer; the next frame rebuilds
        // the whole chain from scratch.
        if (++writeFails >= 3) teardownVideoPipeline('generator writer poisoned');
      });
      if (wrapped) vf.close();
      const n = drawn + 1;
      if (n === 1 || n % 1800 === 0) {
        // Health grid: the frame reaches the element asynchronously, so
        // sample it a beat later by drawing the element into a scratch 2D
        // canvas (a video element has no getImageData of its own).
        setTimeout(() => {
          try {
            if (!videoEl || !videoEl.videoWidth) {
              console.log(`[direct-canvas] drawn=${n} dropped=${dropped} NO PICTURE: videoWidth=${videoEl?.videoWidth ?? -1} readyState=${videoEl?.readyState ?? -1} track=${gen?.readyState} (video)`);
              return;
            }
            if (!diag) diag = document.createElement('canvas');
            diag.width = videoEl.videoWidth;
            diag.height = videoEl.videoHeight;
            const dctx = diag.getContext('2d', { willReadFrequently: true })!;
            dctx.drawImage(videoEl, 0, 0);
            const cells: string[] = [];
            for (const fy of [0.2, 0.5, 0.8]) {
              for (const fx of [0.2, 0.5, 0.8]) {
                const px = dctx.getImageData((diag.width * fx) | 0, (diag.height * fy) | 0, 1, 1).data;
                cells.push(`${px[0].toString(16).padStart(2, '0')}${px[1].toString(16).padStart(2, '0')}${px[2].toString(16).padStart(2, '0')}`);
              }
            }
            console.log(`[direct-canvas] drawn=${n} dropped=${dropped} ${diag.width}x${diag.height} grid=${cells.join(',')} (video)`);
          } catch { /* diagnostic only */ }
        }, 500);
      }
    };

    const drawSurface = (sid: number) => {
      const held = heldTextures.get(sid);
      if (!held) { dropped++; return; }
      if (!canvas || !canvas.isConnected) {
        canvas = document.querySelector<HTMLCanvasElement>('canvas[data-direct-canvas]');
        // A canvas can only ever hold one context type, so a remount resets
        // both context handles.
        gpuCtx = null;
        ctx = null;
        if (!canvas) { dropped++; return; }
      }
      let vf: VideoFrame;
      try {
        vf = held.getVideoFrame();
      } catch (err) {
        if (dropped++ < 3) console.error('[direct-canvas] getVideoFrame failed:', err);
        return;
      }
      if (renderVia === 'video') {
        try {
          drawVideo(vf); // ownership transferred; the sink closes the frame
          videoStrikes = 0;
          drawn++;
        } catch (err) {
          vf.close();
          if (++videoStrikes >= 3) {
            renderVia = 'gpu';
            if (videoEl) { videoEl.remove(); videoEl = null; }
            if (canvas) canvas.style.display = '';
            console.error('[direct-canvas] video path failed 3x, falling back to canvas:', err);
          } else if (dropped++ < 6) {
            console.error('[direct-canvas] video path failed:', err);
          }
        }
        return;
      }
      try {
        if (gpuReady && !gpuFailed) {
          try {
            drawWebGpu(vf);
            gpuStrikes = 0;
            drawn++;
            return;
          } catch (err) {
            gpuCtx = null;
            if (++gpuStrikes >= 3) {
              gpuFailed = true;
              console.error('[direct-canvas] WebGPU draw failed 3x, switching to 2D fallback:', err);
            } else {
              if (dropped++ < 6) console.error('[direct-canvas] WebGPU draw failed:', err);
              return;
            }
          }
        }
        if (!gpuFailed) { dropped++; return; } // WebGPU still initialising (~first 100ms)
        draw2d(vf);
        drawn++;
      } catch (err) {
        if (dropped++ < 3) console.error('[direct-canvas] draw failed:', err);
      } finally {
        // Closing per draw is the leak-free lifecycle; WebGPU's submitted
        // work holds its own reference until the GPU is done.
        vf.close();
      }
    };

    ipcRenderer.on('direct-surface:frame', (_e, f: { surfaceId: number }) => {
      drawSurface(f.surfaceId);
    });
    ipcRenderer.on('direct-surface:reset', () => {
      for (const t of heldTextures.values()) { try { t.release(); } catch { /* gone */ } }
      heldTextures.clear();
      if (videoEl) {
        videoEl.remove();
        videoEl = null;
        if (canvas) canvas.style.display = '';
      }
      lastFrameAt = 0;
      console.log('[direct-canvas] reset: released all held textures');
    });
    console.log('[direct-canvas] shared texture receiver registered');
  }
}
