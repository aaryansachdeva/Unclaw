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
}

interface Window {
  electronAPI: ElectronAPI;
}
