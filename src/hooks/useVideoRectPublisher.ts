import { useEffect, useRef } from 'react';
import { PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';

/**
 * Publishes the streamed <video> element's screen-space geometry to Unreal
 * over the Pixel Streaming data channel as `EventType: "videoRect"`.
 *
 * Unreal's CursorGazeComponent uses this rect to translate the host's OS
 * cursor (read via Win32 GetCursorPos) into video-relative coords, so the
 * MetaHuman's eye gaze keeps tracking the cursor even when the UnClaw
 * window isn't focused. Without this, the gaze either freezes (when the
 * streamed UE window loses input) or tracks the host's invisible cursor.
 *
 * The hook publishes:
 *   - immediately after the <video> element appears
 *   - on any size change (ResizeObserver)
 *   - once per second as a heartbeat (catches window moves, multi-monitor
 *     re-layouts, and any other changes the browser doesn't expose events for)
 */
export function useVideoRectPublisher(
  pixelStreaming: PixelStreaming | null,
  videoParentRef: React.RefObject<HTMLDivElement | null>,
): void {
  const lastPublishedRef = useRef<string>('');

  useEffect(() => {
    if (!pixelStreaming || !videoParentRef.current) return;

    const parent = videoParentRef.current;

    const publish = (): void => {
      const video = parent.querySelector('video') as HTMLVideoElement | null;
      const target: HTMLElement = video ?? parent;
      const rect = target.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      const screenX = (window.screenX ?? 0) + rect.left;
      const screenY = (window.screenY ?? 0) + rect.top;

      // Fingerprint so we don't spam UE with identical messages.
      const fingerprint = `${screenX | 0}|${screenY | 0}|${rect.width | 0}|${rect.height | 0}|${window.devicePixelRatio}`;
      if (fingerprint === lastPublishedRef.current) return;
      lastPublishedRef.current = fingerprint;

      pixelStreaming.emitUIInteraction({
        EventType: 'videoRect',
        // Lower-case aliases for code that prefers the JSON convention.
        type: 'videoRect',
        x: screenX,
        y: screenY,
        w: rect.width,
        h: rect.height,
        width: rect.width,
        height: rect.height,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
    };

    // Heartbeat — covers window moves and any browser layout changes that
    // don't fire ResizeObserver. 1 Hz is plenty for gaze tracking; the JSON
    // payload is tiny and we deduplicate above.
    const heartbeat = window.setInterval(publish, 1000);

    // Detect the <video> element being appended by the PS lib (it isn't
    // there on first render). Republish immediately when found.
    const mo = new MutationObserver(() => publish());
    mo.observe(parent, { childList: true, subtree: true });

    // Resize observers on both the parent and the video element catch CSS
    // resizes, fullscreen toggles, and devtools opening/closing.
    const ro = new ResizeObserver(() => publish());
    ro.observe(parent);
    const observedVideo = parent.querySelector('video');
    if (observedVideo) ro.observe(observedVideo);

    // Window-level events that change the rect.
    window.addEventListener('resize', publish);
    window.addEventListener('scroll', publish, true);

    publish();

    return () => {
      window.clearInterval(heartbeat);
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', publish);
      window.removeEventListener('scroll', publish, true);
    };
  }, [pixelStreaming, videoParentRef]);
}
