import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectionState } from '../hooks/usePixelStreaming';
import logoUrl from '../assets/logo.png';

const MIN_LOADING_MS = 2000;

// ---------------------------------------------------------------------------
// Stream gamut match (the Mac "faded colors" fix)
//
// UE on Mac never sets a colorspace on its CAMetalLayer (verified in 5.8
// MetalViewport.cpp), so the editor and the packaged app window are
// color-UNMANAGED: their sRGB pixel values go raw to the panel, and on the
// wide-gamut P3 displays every modern Mac ships, raw sRGB numbers read as P3
// coordinates. That reinterpretation widens saturation, and it is the look
// everyone tunes the character against in the editor.
//
// Chromium, by contrast, IS color-managed: it converts the decoded stream to
// honest sRGB and maps it correctly onto the P3 panel. Correct, but visibly
// duller than the UE window next to it. No encoder/YUV-side change can close
// that gap; a mathematically perfect pipeline lands exactly on the duller look.
//
// So we reproduce UE's unmanaged presentation for the stream only: a
// linear-space P3->sRGB matrix applied to the video. Chromium then runs its
// sRGB->P3 management on the pre-distorted pixels and the two transforms
// cancel, leaving the panel with the same raw values the UE window would have
// pushed. Identity on P3 displays; on a plain sRGB external monitor it
// slightly oversaturates, in the same direction the editor itself would.
//
// The matrix is the standard linear Display-P3 -> sRGB conversion (D65).
// color-interpolation-filters must be linearRGB (the SVG default, set
// explicitly) so the matrix runs on linearized values, not gamma-encoded ones.
// Out-of-range results clamp, which is the same gamut clip the panel applies.
const GAMUT_MATRIX = [
  1.224940, -0.224940, 0, 0, 0,
  -0.042057, 1.042057, 0, 0, 0,
  -0.019638, -0.078636, 1.098265, 0, 0,
  0, 0, 0, 1, 0,
].join(' ');

// Presence of the key disables the filter (default is ON).
const GAMUT_OFF_KEY = 'unclaw-stream-gamut-off';

/** Average decoded RGB of the stream's center patch, as Chromium interprets
 *  it (canvas readback is sRGB and ignores CSS filters). This isolates the
 *  DECODE layer: if these numbers match the UE backbuffer for the same scene,
 *  the YUV matrix/range signaling is correct and any remaining visual gap is
 *  display management, which the gamut filter owns. */
function sampleStreamRGB(): { r: number; g: number; b: number } | null {
  const v = document.querySelector('video');
  if (!v || !(v instanceof HTMLVideoElement) || v.videoWidth < 256 || v.videoHeight < 256) return null;
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(v, (v.videoWidth - 256) / 2, (v.videoHeight - 256) / 2, 256, 256, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  let r = 0, g = 0, b = 0;
  const n = S * S;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  return { r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1) };
}
// How long the stream can sit un-connected before we surface a recovery
// affordance. When UE fails to launch, soul (and its signalling server) are
// healthy but there's no streamer peer, so the connection stays 'connecting'
// forever behind the logo with no feedback , the "character won't launch"
// symptom. Generous so a normal UE cold start (a big app booting) never trips
// it; it only appears when something is genuinely wrong.
const STALL_HINT_MS = 40000;

interface StreamViewProps {
  videoParentRef: React.RefObject<HTMLDivElement | null>;
  connectionState: ConnectionState;
}

export function StreamView({ videoParentRef, connectionState }: StreamViewProps) {
  const streamReady = connectionState === 'connected';

  // Gamut match on by default on EVERY platform; persisted opt-out for A/B.
  // The CSS @media (color-gamut: p3) gate is the real switch, and it is the
  // correct one on all three OSes: it turns on exactly when the display is
  // wide-gamut AND Chromium is color-managing into it, which is precisely
  // when the cancellation math holds. UE windows are color-unmanaged
  // everywhere (Mac Metal layer, Windows DWM without ACM, Linux
  // compositors), so "match the unmanaged UE look" is the right target for
  // the stock Windows/Linux Pixel Streaming plugin just as much as for the
  // NativeMac one. On plain sRGB monitors the query is false and the filter
  // is inert, which is also correct: there, unmanaged and honest sRGB
  // coincide.
  const [gamutOn, setGamutOn] = useState(() => localStorage.getItem(GAMUT_OFF_KEY) == null);

  // Dev/live-tuning console surface:
  //   __unclawStream.gamut(false)  toggle the P3 match without a reload
  //   __unclawStream.sample()      decoded center-patch RGB (see helper above)
  useEffect(() => {
    const api = {
      gamut: (on: boolean) => {
        setGamutOn(on);
        if (on) localStorage.removeItem(GAMUT_OFF_KEY);
        else localStorage.setItem(GAMUT_OFF_KEY, '1');
        return `stream gamut match: ${on ? 'ON (UE-window look)' : 'OFF (honest sRGB)'}`;
      },
      sample: sampleStreamRGB,
    };
    (window as unknown as Record<string, unknown>).__unclawStream = api;
    return () => {
      const w = window as unknown as Record<string, unknown>;
      if (w.__unclawStream === api) delete w.__unclawStream;
    };
  }, []);

  // Enforce a minimum display duration on the loading screen so it never flashes.
  const [canShowStream, setCanShowStream] = useState(false);
  const loadingShownAt = useRef<number>(Date.now());
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stalled-connection surface. Flips true after STALL_HINT_MS of continuous
  // non-connected state; reset whenever we connect.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (streamReady) { setStalled(false); return; }
    const t = setTimeout(() => setStalled(true), STALL_HINT_MS);
    return () => clearTimeout(t);
  }, [streamReady]);

  const handleRelaunchSoul = () => {
    setStalled(false);
    void window.electronAPI?.soul?.restart?.();
  };
  const handleOpenLogs = () => { void window.electronAPI?.soul?.openLogs?.(); };

  useEffect(() => {
    if (streamReady) {
      const elapsed = Date.now() - loadingShownAt.current;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      releaseTimer.current = setTimeout(() => setCanShowStream(true), remaining);
    } else {
      // Reset when we drop back to loading
      setCanShowStream(false);
      loadingShownAt.current = Date.now();
      if (releaseTimer.current) {
        clearTimeout(releaseTimer.current);
        releaseTimer.current = null;
      }
    }
    return () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    };
  }, [streamReady]);

  // Direct IOSurface mode: Unreal's frames are composited by the window server
  // on a native layer BEHIND this web content, so the video element and the
  // opaque backdrop have to get out of the way. Only once real frames are
  // arriving, though. If the publisher is not up, `connected` stays false and
  // the ordinary WebRTC video keeps playing, which is what makes this safe to
  // leave enabled.
  const [directLive, setDirectLive] = useState(false);
  const directMode = window.electronAPI?.directSurface?.mode ?? null;
  useEffect(() => {
    const api = window.electronAPI?.directSurface;
    if (!api?.onStatus) return;
    return api.onStatus((s) => setDirectLive(!!s.connected));
  }, []);

  // Mode 1 only: the native layer sits BEHIND the page, so the page's opaque
  // backgrounds have to get out of the way. Mode 2 draws the frame on the
  // canvas below, which is ordinary page content over an opaque window, so the
  // backgrounds stay and backdrop-filter works.
  useEffect(() => {
    const on = directLive && directMode === '1';
    document.documentElement.classList.toggle('direct-surface', on);
    return () => document.documentElement.classList.remove('direct-surface');
  }, [directLive, directMode]);

  const isConnected = (streamReady && canShowStream) || directLive;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: directLive && directMode === '1' ? 'transparent' : 'var(--bg-void)' }}
    >
      {/* Filter definition for the gamut match. Zero-size, never paints. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="ue-gamut-match" colorInterpolationFilters="linearRGB">
          <feColorMatrix type="matrix" values={GAMUT_MATRIX} />
        </filter>
      </svg>
      {/* Shared-texture mode: the preload draws Unreal's frames here (it finds
          this element by the data attribute). Always mounted in mode 2 so the
          receiver has a target from the first frame; revealed once frames are
          actually flowing. object-cover mirrors how the <video> fills. */}
      {directMode === '2' && (
        <canvas
          data-direct-canvas
          className="absolute inset-0 h-full w-full object-cover"
          style={{ visibility: directLive ? 'visible' : 'hidden' }}
        />
      )}
      {/* Kept mounted, never unmounted: the PixelStreaming SDK owns the video
          element inside this node, and tearing it down would drop the peer
          connection that still carries input and audio. Hidden only. */}
      <div
        ref={videoParentRef}
        className={`absolute inset-0${gamutOn && !directLive ? ' stream-gamut-match' : ''}`}
        style={directLive ? { visibility: 'hidden' } : undefined}
      />

      {/* Bottom vignette */}
      <AnimatePresence>
        {isConnected && (
          <motion.div
            key="vignette"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute bottom-0 left-0 right-0 pointer-events-none"
            style={{
              height: '40%',
              background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 30%, transparent 100%)',
              zIndex: 10,
            }}
          />
        )}
      </AnimatePresence>

      {/* Loading screen (shown whenever not connected) */}
      <AnimatePresence>
        {!isConnected && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center"
            style={{ background: 'var(--bg-void)', paddingBottom: '120px' }}
          >
            {/* Ambient red glow behind logo */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -60%)',
                width: '360px',
                height: '360px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(196,68,68,0.12) 0%, rgba(196,68,68,0.04) 40%, transparent 70%)',
                filter: 'blur(20px)',
                pointerEvents: 'none',
              }}
            />

            {/* Logo + breathing aura */}
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              style={{ position: 'relative', zIndex: 1 }}
            >
              <motion.img
                src={logoUrl}
                alt="UnClaw"
                animate={{
                  scale: [1, 1.03, 1],
                  filter: [
                    'drop-shadow(0 0 18px rgba(196,68,68,0.25))',
                    'drop-shadow(0 0 28px rgba(196,68,68,0.4))',
                    'drop-shadow(0 0 18px rgba(196,68,68,0.25))',
                  ],
                }}
                transition={{
                  duration: 3.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                style={{
                  width: '180px',
                  height: '180px',
                  objectFit: 'contain',
                  userSelect: 'none',
                  WebkitUserDrag: 'none',
                } as React.CSSProperties}
                draggable={false}
              />
            </motion.div>

            {/* Status text */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              style={{
                // The ruby-ring logo fills its box to the edge (the old mark
                // had bottom padding), so a positive gap is needed for the
                // dots + status to clear the logo.
                marginTop: '32px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                zIndex: 1,
              }}
            >
              {/* Loading dots */}
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      opacity: [0.25, 1, 0.25],
                      y: [0, -2, 0],
                    }}
                    transition={{
                      duration: 1.4,
                      repeat: Infinity,
                      delay: i * 0.18,
                      ease: 'easeInOut',
                    }}
                    style={{
                      width: '4px',
                      height: '4px',
                      borderRadius: '50%',
                      background: 'var(--accent)',
                    }}
                  />
                ))}
              </div>

              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--text-ghost)',
              }}>
                {stalled ? 'Still waiting for your companion' : 'Waiting for Unclaw-Soul'}
              </span>
            </motion.div>

            {/* Stalled-connection recovery. Appears only after a long wait
                (UE not launching), replacing the download helper with an
                actionable relaunch + logs pair. Non-blocking , the stream
                keeps trying to connect underneath. */}
            {stalled && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: 'absolute',
                  bottom: '30px',
                  left: 0,
                  right: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px',
                  zIndex: 2,
                }}
              >
                <span style={{
                  fontSize: '11px',
                  color: 'var(--text-ghost)',
                  letterSpacing: '0.02em',
                  maxWidth: 320,
                  textAlign: 'center',
                  lineHeight: 1.5,
                }}>
                  Your companion is taking longer than usual to appear.
                </span>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={handleRelaunchSoul}
                    style={{
                      padding: '6px 16px',
                      borderRadius: 999,
                      border: '1px solid rgba(196, 68, 68, 0.45)',
                      background: 'var(--accent-dim, rgba(196,68,68,0.14))',
                      color: 'rgba(255,255,255,0.9)',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    Relaunch soul
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenLogs}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-ghost)',
                      fontSize: '11px',
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      textUnderlineOffset: 3,
                    }}
                  >
                    Open logs
                  </button>
                </div>
              </motion.div>
            )}

            {/* Download link — small, ghost, drifts in after a beat so it
                doesn't compete with the logo on quick reconnects. Pinned
                to the bottom of the loading screen, not stacked under the
                status, so it reads as a quiet helper rather than a CTA. */}
            {!stalled && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.2, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'absolute',
                bottom: '32px',
                left: 0,
                right: 0,
                textAlign: 'center',
                fontSize: '11px',
                color: 'var(--text-ghost)',
                letterSpacing: '0.02em',
                zIndex: 1,
              }}
            >
              Don't have it?{' '}
              <a
                href="https://unclaw.io"
                onClick={(e) => {
                  e.preventDefault();
                  window.electronAPI?.authOpenExternal('https://unclaw.io');
                }}
                style={{
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  fontWeight: 500,
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  transition: 'color 0.2s ease, text-shadow 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.textShadow = '0 0 8px rgba(196,68,68,0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.textShadow = 'none';
                }}
              >
                UNCLAW.IO
              </a>
            </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
