interface ElectronAPI {
  minimize: () => void;
  close: () => void;
  togglePin: (pinned: boolean) => void;

  /** Trigger the screenshot region selector. Same effect as the
   *  global Ctrl+Shift+G shortcut. */
  triggerScreenshot: () => void;
  /** Subscribe to captured screenshots. Returns an unsubscribe fn. */
  onScreenshotCaptured: (
    cb: (payload: { base64: string; width: number; height: number }) => void,
  ) => () => void;

  // Overlay-window facing — only used by the inline overlay HTML.
  // Renderer code in src/ doesn't call these.
  notifyOverlayReady?: () => void;
  onOverlayShow?: (
    cb: (data: { dataUrl: string }) => void,
  ) => () => void;
  completeScreenshot?: (
    rect: { x: number; y: number; w: number; h: number },
  ) => void;
  cancelScreenshot?: () => void;

  // Auth — loopback OAuth flow + safeStorage-backed token persist.
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

  // API keys (BYOK) — local-only safeStorage. JSON string in/out.
  /** Read the persisted JSON blob, or null if none. */
  apiKeysGet: () => Promise<string | null>;
  /** Persist the JSON blob via OS-encrypted storage. */
  apiKeysSet: (payload: string) => Promise<boolean>;
  /** Wipe the persisted blob. */
  apiKeysClear: () => Promise<boolean>;

  // Soul subprocess lifecycle — main spawns (or attaches to) soul on
  // app start. The LoadingScreen subscribes to `onLog` to render boot
  // progress; the App subscribes to `onReady` to dismiss the loader
  // and mount the pixel-streaming connection.
  soul: {
    /** One-shot snapshot. Returns whether soul is already ready
     *  + the recent log buffer. Call on mount so the boot screen
     *  hydrates from past state instead of waiting forever on
     *  events that already fired. */
    getStatus: () => Promise<{
      ready: boolean;
      recentLogs: { stream: 'stdout' | 'stderr' | 'meta'; line: string }[];
      elapsedMs: number;
    }>;
    /** Subscribe to soul stdout/stderr/meta lines. Returns unsubscribe. */
    onLog: (
      cb: (data: { stream: 'stdout' | 'stderr' | 'meta'; line: string }) => void,
    ) => () => void;
    /** Fired ONCE when soul prints its READY banner. */
    onReady: (cb: () => void) => () => void;
    /** Fired if soul exits (clean or crashed). */
    onExit: (
      cb: (data: { code: number | null; signal: string | null }) => void,
    ) => () => void;
  };

  // First-run setup pipeline — provisions the per-user runtime
  // (Python venv, downloaded UE app, downloaded model assets) on a
  // packaged install. In dev, getStatus returns isComplete=true and
  // the wizard never mounts.
  setup: {
    /** Snapshot for hydration on mount. Same replay pattern as
     *  soul.getStatus — without it, a wizard remount mid-pipeline
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
    /** Kick the pipeline. Idempotent — re-calling while it's running
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
}

interface Window {
  electronAPI: ElectronAPI;
}
