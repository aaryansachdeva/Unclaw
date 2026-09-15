import { useEffect } from 'react';
import { PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';

/**
 * Streams the OS cursor to Unreal's CursorGazeComponent as `gazeCursor`
 * descriptors, normalized to the character's on-screen frame.
 *
 * Unreal cannot read the cursor itself on Mac: it runs with -RenderOffScreen
 * and the app draws the character, so UE never receives a mouse event, and
 * the component's other source (Win32 GetCursorPos) only exists on Windows.
 * The main process polls screen.getCursorScreenPoint(), which works while the
 * window is unfocused on both platforms, and forwards changes here; this maps
 * them onto the stream container, which covers the character whether it is
 * drawn by the shared-texture canvas or the WebRTC video.
 *
 * x/y: origin at the frame centre, +x right, +y down, 1.0 at the frame edge,
 * clamped to 1.5 so a cursor far outside the window still reads as "far".
 * px/py: frame-relative CSS pixels, which Unreal uses to detect motion.
 */
export function useGazeCursorPublisher(
  pixelStreaming: PixelStreaming | null,
  frameRef: React.RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const subscribe = window.electronAPI?.onGazeCursor;
    if (!pixelStreaming || !subscribe) return;

    let last = '';
    const clamp = (v: number) => Math.max(-1.5, Math.min(1.5, v));

    return subscribe(({ x, y }) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      // Electron's screen points and window.screenX/Y share one coordinate
      // space (DIP) on both platforms, so no devicePixelRatio correction.
      const localX = x - ((window.screenX ?? 0) + rect.left);
      const localY = y - ((window.screenY ?? 0) + rect.top);
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;
      const nx = clamp((localX - halfW) / halfW);
      const ny = clamp((localY - halfH) / halfH);

      const key = `${Math.round(localX)}|${Math.round(localY)}`;
      if (key === last) return;
      last = key;

      pixelStreaming.emitUIInteraction({
        EventType: 'gazeCursor',
        x: Math.round(nx * 1000) / 1000,
        y: Math.round(ny * 1000) / 1000,
        px: Math.round(localX),
        py: Math.round(localY),
      });
    });
  }, [pixelStreaming, frameRef]);
}
