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
}

interface Window {
  electronAPI: ElectronAPI;
}
