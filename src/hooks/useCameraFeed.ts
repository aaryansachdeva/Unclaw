// Video call mode: the user's webcam, owned by the renderer.
//
// One MediaStream (video only, the mic stays with the voice stack), a
// detached <video> element that decodes it, and captureFrame() which paints
// the current frame to a canvas and returns it in the same shape the image
// attachment path uses ({ base64 PNG, width, height }). App.tsx attaches one
// frame per turn while the mode is on; the self-view component renders the
// same element for the picture-in-picture.
//
// Frames are downscaled to FRAME_MAX_EDGE before encoding. The attachment
// path sends full-resolution PNGs, fine for a deliberate screenshot, wrong
// for something that rides along with every spoken sentence: a 1280x720
// PNG is ~1.5 MB and the vision models downscale it anyway.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CameraFrame {
  base64: string;
  width: number;
  height: number;
}

const FRAME_MAX_EDGE = 640;

export interface CameraFeed {
  /** True while the stream is live. */
  active: boolean;
  /** Set when start() failed; cleared on the next successful start. */
  error: string | null;
  /** The decoding <video>; mount it in a self-view via videoRef. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => Promise<boolean>;
  stop: () => void;
  /** Current frame as a downscaled base64 PNG, or null when not live. */
  captureFrame: () => Promise<CameraFrame | null>;
}

export function useCameraFeed(): CameraFeed {
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    if (s) for (const t of s.getTracks()) t.stop();
    const v = videoRef.current;
    if (v) v.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        try { await v.play(); } catch { /* autoplay policy; frames still decode */ }
      }
      // The camera can be unplugged or taken by another app mid-call.
      for (const t of stream.getVideoTracks()) {
        t.onended = () => { if (streamRef.current === stream) stop(); };
      }
      setError(null);
      setActive(true);
      return true;
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      setError(
        name === 'NotAllowedError'
          ? 'Camera access is off, so she can’t see you.'
          : name === 'NotFoundError'
            ? 'No camera found on this Mac.'
            : 'The camera could not be started.',
      );
      setActive(false);
      return false;
    }
  }, [stop]);

  // Late-mounted self-view: attach the live stream when the element appears.
  useEffect(() => {
    const v = videoRef.current;
    if (v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
      v.muted = true;
      void v.play().catch(() => {});
    }
  });

  const captureFrame = useCallback(async (): Promise<CameraFrame | null> => {
    const v = videoRef.current;
    const stream = streamRef.current;
    if (!v || !stream || v.videoWidth === 0 || v.videoHeight === 0) return null;
    const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    // PNG, not JPEG: soul labels every image `image/png` on the wire and
    // Anthropic rejects a media type that does not match the bytes.
    const base64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
    if (!base64) return null;
    return { base64, width: w, height: h };
  }, []);

  useEffect(() => stop, [stop]);

  return { active, error, videoRef, start, stop, captureFrame };
}
