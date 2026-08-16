/** Live port mapping the supervisor learned from soul (banner or
 *  ports.json fallback). Renderer URL builders consume this to avoid
 *  hardcoding 8765/8080/8888. */
interface SoulPorts {
  http: number;
  signallingStreamer: number;
  signallingPlayer: number;
}

interface ElectronAPI {
  /** Host OS from the main process. 'darwin' | 'win32' | 'linux'. */
  platform: string;
  minimize: () => void;
  close: () => void;
  togglePin: (pinned: boolean) => void;
  focusWindow: () => void;
  /** Open Terminal.app with a pre-filled command (macOS only). Used by
   *  SettingsPanel's Claude Code subscription card to fire
   *  `claude setup-token` in a fresh tab. */
  openTerminalWithCommand: (command: string) => Promise<{ ok: boolean; error?: string }>;
  /** Microphone permission (macOS). `request` triggers the OS prompt (or
   *  resolves false if already denied); `getStatus` reads current access;
   *  `openSettings` jumps to Privacy > Microphone. */
  mic: {
    getStatus: () => Promise<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'>;
    request: () => Promise<boolean>;
    openSettings: () => Promise<{ ok: boolean; error?: string }>;
  };

  /** TEMP(revert): Cmd+H all-chrome hide toggle. Returns an unsubscribe fn. */
  onTempToggleUi?: (cb: () => void) => () => void;

  /** Trigger the screenshot region selector. Same effect as the
   *  global Ctrl+Shift+G shortcut. */
  triggerScreenshot: () => void;
  /** Subscribe to captured screenshots. Returns an unsubscribe fn. */
  onScreenshotCaptured: (
    cb: (payload: { base64: string; width: number; height: number }) => void,
  ) => () => void;

  // Overlay-window facing, only used by the inline overlay HTML.
  // Renderer code in src/ doesn't call these.
  notifyOverlayReady?: () => void;
  onOverlayShow?: (
    cb: (data: { dataUrl: string }) => void,
  ) => () => void;
  completeScreenshot?: (
    rect: { x: number; y: number; w: number; h: number },
  ) => void;
  cancelScreenshot?: () => void;

  // Auth, loopback OAuth flow + safeStorage-backed token persist.
  /** Open a URL in the user's default browser (auth flow start). */
  authOpenExternal: (url: string) => Promise<boolean>;
  /** Persist a JWT via OS-encrypted storage. */
  authSetToken: (token: string) => Promise<boolean>;
  /** Read the persisted JWT, or null if none / decryption failed. */
  authGetToken: () => Promise<string | null>;
  /** Wipe the persisted JWT. */
  authClearToken: () => Promise<boolean>;
  /** Spin up the loopback HTTP server (127.0.0.1:47821) and resolve
   *  with the OAuth callback payload once the provider hits it. */
  authStartOAuthLoopback: () => Promise<{
    code: string | null;
    state: string | null;
    error: string | null;
  }>;
  /** Cancel a pending loopback OAuth flow. */
  authCancelOAuthLoopback: () => Promise<boolean>;

  // API keys (BYOK), local-only safeStorage. JSON string in/out.
  /** Read the persisted JSON blob, or null if none. */
  apiKeysGet: () => Promise<string | null>;
  /** Persist the JSON blob via OS-encrypted storage. */
  apiKeysSet: (payload: string) => Promise<boolean>;
  /** Wipe the persisted blob. */
  apiKeysClear: () => Promise<boolean>;

  /** Durable "which account owns this machine's local state" marker, persisted
   *  in userData next to the API keys so it can't desync from them the way the
   *  old localStorage-only marker could (a lost marker used to wipe keys). */
  getLocalOwner: () => Promise<string | null>;
  setLocalOwner: (ownerId: string) => Promise<boolean>;
  clearLocalOwner: () => Promise<boolean>;

  // Soul subprocess lifecycle, main spawns (or attaches to) soul on
  // app start. The LoadingScreen subscribes to `onLog` to render boot
  // progress; the App subscribes to `onReady` to dismiss the loader
  // and mount the pixel-streaming connection.
  soul: {
    /** One-shot snapshot. Returns whether soul is already ready
     *  + the recent log buffer + the live port mapping (null until
     *  the [ports] banner fires). Call on mount so the boot screen
     *  hydrates from past state instead of waiting forever on
     *  events that already fired. */
    getStatus: () => Promise<{
      ready: boolean;
      recentLogs: { stream: 'stdout' | 'stderr' | 'meta'; line: string }[];
      elapsedMs: number;
      ports: SoulPorts | null;
      failed: boolean;
    }>;
    /** User-initiated retry from the boot-failure screen. */
    restart: () => Promise<boolean>;
    /** Reveal the logs folder in Finder/Explorer (support affordance). */
    openLogs: () => Promise<boolean>;
    /** Latest known port mapping, or null while soul is still booting.
     *  Renderer-side URL builders (services/soulBase.ts) call this
     *  during init so they don't construct stale URLs. */
    getPorts: () => Promise<SoulPorts | null>;
    /** Subscribe to soul stdout/stderr/meta lines. Returns unsubscribe. */
    onLog: (
      cb: (data: { stream: 'stdout' | 'stderr' | 'meta'; line: string }) => void,
    ) => () => void;
    /** Fired ONCE when soul prints its READY banner. */
    onReady: (cb: () => void) => () => void;
    /** Fired ONCE when soul prints its [ports] banner (or immediately
     *  with hydrated ports.json values when attaching to an external
     *  soul). Emitted BEFORE 'soul:ready' so URL builders are ready
     *  by the time the rest of the app starts making requests. */
    onPorts: (cb: (ports: SoulPorts) => void) => () => void;
    /** Fired if soul exits (clean or crashed). */
    onExit: (
      cb: (data: { code: number | null; signal: string | null }) => void,
    ) => () => void;
    /** Fired when the supervisor auto-respawns soul after an unexpected
     *  exit during boot. */
    onRetrying: (cb: (data: { attempt: number; max: number }) => void) => () => void;
    /** Fired when soul boot fails unrecoverably (timeout or exhausted
     *  retries). The boot screen shows a recoverable error + Retry. */
    onFailed: (
      cb: (data: { reason: string; recentErrors: string[] }) => void,
    ) => () => void;
  };

  // First-run setup pipeline, provisions the per-user runtime
  // (Python venv, downloaded UE app, downloaded model assets) on a
  // packaged install. In dev, getStatus returns isComplete=true and
  // the wizard never mounts.
  setup: {
    /** Snapshot for hydration on mount. Same replay pattern as
     *  soul.getStatus, without it, a wizard remount mid-pipeline
     *  loses all events that already fired. */
    getStatus: () => Promise<{
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
    }>;
    /** Kick the pipeline. Idempotent, re-calling while it's running
     *  is a no-op. Resolves with true on success, false on failure. */
    start: () => Promise<boolean>;
    /** Subscribe to per-line log output from each stage. */
    onLog: (
      cb: (data: { stream: 'stdout' | 'stderr' | 'meta'; line: string }) => void,
    ) => () => void;
    /** Subscribe to stage transitions + progress updates. */
    onStage: (
      cb: (data: {
        id: 'preflight' | 'runtime' | 'unreal' | 'models' | 'complete' | 'failed';
        progress: number | null;
        headline: string;
        detail?: string;
      }) => void,
    ) => () => void;
  };

  // Runtime auto-updater. Runs on every launch after setup completes , 
  // fetches a remote manifest, downloads + swaps any categories that have
  // drifted from the installed-versions ledger. Categories: app (Electron
  // shell, handled by electron-updater), soul (Python source), unreal
  // (UE Shipping .app), assets (models + lipsync).
  update?: {
    /** Snapshot for hydration. Same replay pattern as setup.getStatus. */
    getStatus: () => Promise<UpdateSnapshot>;
    /** Kick the update check. Idempotent, second call returns the
     *  in-progress snapshot rather than starting a parallel run. */
    start: () => Promise<UpdateSnapshot>;
    /** Relaunch Unclaw to apply downloaded updates. */
    restart: () => Promise<void>;
    /** Subscribe to per-update-pass snapshot diffs. Fired any time a
     *  category's progress changes. */
    onSnapshot: (cb: (snap: UpdateSnapshot) => void) => () => void;
    /** Subscribe to one-line diagnostic log strings. Lower-volume than
     *  setup.onLog, mostly for surfacing errors in dev. */
    onLog: (cb: (line: string) => void) => () => void;
  };

  // Character store. The renderer resolves the presigned pak URL from the
  // store Worker (it holds the auth token) and hands it here for the heavy
  // download/verify/extract into the runtime.
  identity: {
    runInference: (args: { sessionId: string; zipBytes: Uint8Array; groom?: unknown }) => Promise<{
      ok: boolean; dnaPath?: string; blobPath?: string; baseColorPath?: string;
      grooming?: { gender: 'm' | 'f'; hairIndex: number; browIndex: number; lashIndex: number }; error?: string;
    }>;
    runPhotoInference: (args: { localId: string; photoBytes: Uint8Array; ext: 'jpg' | 'png'; groom?: unknown }) => Promise<{
      ok: boolean; dnaPath?: string; blobPath?: string; baseColorPath?: string;
      grooming?: { gender: 'm' | 'f'; hairIndex: number; browIndex: number; lashIndex: number }; error?: string;
    }>;
    runH3D: (args: {
      localId: string; photoBytes: Uint8Array; ext: 'jpg' | 'png';
      catalogs?: { hairs: { index: number; name: string }[]; brows: { index: number; name: string }[]; lashes: { index: number; name: string }[] };
    }) => Promise<{
      ok: boolean; dnaPath?: string; jointsPath?: string; bustPath?: string; cleanImagePath?: string;
      baseColorPath?: string; normalPath?: string;
      grooming?: { gender: 'm' | 'f'; build: 'skinny' | 'fit' | 'fat'; hairIndex: number; browIndex: number; lashIndex: number };
      error?: string;
    }>;
    /** Re-roll ONLY the skin texture for an existing character. */
    regenBasecolor: (args: { localId: string }) => Promise<{
      ok: boolean; baseColorPath?: string;
      skins?: Array<{ path: string; label: string }>; error?: string;
    }>;
    /** Every skin generated for this character, oldest first. */
    listBasecolors: (args: { localId: string }) => Promise<{
      ok: boolean; skins: Array<{ path: string; label: string }>;
    }>;
    onProgress: (cb: (data: { stage: string; line: string }) => void) => () => void;
  };
  characterStore: {
    /** Download + SHA-verify + extract a purchased pak. `url` is the
     *  short-lived presigned URL from the store Worker; main reads sha256 +
     *  sizeBytes from its own manifest. */
    downloadPak: (args: {
      characterId: string;
      url: string;
    }) => Promise<{ ok: boolean; dir?: string; mountPath?: string | null; error?: string }>;
    /** Character ids whose pak is downloaded locally (in the staging dir),
     *  plus `stale`: those whose staged version drifted from the manifest and
     *  should be re-downloaded. */
    listInstalled: () => Promise<{ ids: string[]; stale: string[] }>;
    /** Which of a character's cloned voice files are already on disk. */
    hasVoices: (args: { characterId: string }) => Promise<{
      ok: boolean; present?: { supertonic: boolean; kokoro: boolean }; complete?: boolean; error?: string;
    }>;
    /** Download + install presigned cloned-voice files into the soul voices dirs. */
    downloadVoices: (args: {
      characterId: string;
      files: { kind: 'supertonic' | 'kokoro'; filename: string; url: string }[];
    }) => Promise<{ ok: boolean; written?: number; error?: string }>;
    /** Subscribe to byte progress for a pak download. */
    onPakProgress: (
      cb: (data: { characterId: string; downloaded: number; total: number }) => void,
    ) => () => void;
  };

  /** Direct IOSurface display status, polled main-side every 2s. `connected`
   *  false means the WebRTC video is still what the user sees. Absent when the
   *  native addon was never built, hence the optional member. */
  directSurface?: {
    /** '1' native layer, '2' shared-texture canvas, null when off. */
    mode: '1' | '2' | null;
    onStatus: (cb: (s: {
      connected: boolean; frames: number; gaps: number;
      fps: number; surfaces: number;
    }) => void) => () => void;
  };

  /** unclaw:// deep link arriving while the app is running (the Polar
   *  checkout-complete page bounces through it). Returns unsubscribe. */
  onDeepLink: (cb: (url: string) => void) => () => void;
  /** Pull a deep link that arrived during cold start, or null. */
  getPendingDeepLink: () => Promise<string | null>;
}

interface UpdateCategoryProgress {
  id: 'app' | 'soul' | 'unreal' | 'assets';
  state: 'pending' | 'downloading' | 'applying' | 'ready' | 'failed' | 'up-to-date';
  progress: number | null;
  detail?: string;
  /** Installed version before this update pass, null on first install
   *  for this category. */
  from: string | null;
  to: string;
}

interface UpdateSnapshot {
  done: boolean;
  categories: UpdateCategoryProgress[];
  restartRequired: boolean;
  fatalError: string | null;
}

interface Window {
  electronAPI: ElectronAPI;
}
