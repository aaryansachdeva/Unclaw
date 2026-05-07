import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectionState } from '../hooks/usePixelStreaming';
import { fetchUnrealStatus, restartUnreal, UnrealStatus } from '../services/unreal';
import logoUrl from '../assets/logo.png';

const MIN_LOADING_MS = 2000;
// Poll cadence while the stream isn't connected. Once connected we stop
// polling — the stream itself is the liveness signal; soul's /unreal
// endpoint exists to recover crashes, not to babysit a healthy game.
const UNREAL_POLL_MS = 4000;

interface StreamViewProps {
  videoParentRef: React.RefObject<HTMLDivElement | null>;
  connectionState: ConnectionState;
}

export function StreamView({ videoParentRef, connectionState }: StreamViewProps) {
  const streamReady = connectionState === 'connected';

  // Enforce a minimum display duration on the loading screen so it never flashes.
  const [canShowStream, setCanShowStream] = useState(false);
  const loadingShownAt = useRef<number>(Date.now());
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isConnected = streamReady && canShowStream;

  // Poll soul's /unreal/status while the stream isn't connected, so we
  // can offer a Restart button when the game has crashed/exited. Stops
  // polling once the stream is up — at that point the stream itself is
  // the liveness signal and there's no UI surface for the status.
  const [unreal, setUnreal] = useState<UnrealStatus | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (isConnected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const s = await fetchUnrealStatus();
      if (cancelled) return;
      setUnreal(s);
      timer = setTimeout(poll, UNREAL_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isConnected]);

  const handleRestart = useCallback(async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      const s = await restartUnreal();
      if (s) setUnreal(s);
    } finally {
      setRestarting(false);
    }
  }, [restarting]);

  // Show a "stopped" state when soul reports the game is gone. `idle`
  // also surfaces here so the user gets a clear hint when soul booted
  // without UNREAL_PIXELSTREAMING_EXE configured (instead of a silent
  // dark stream). `crashed` carries an error string we can surface.
  const engineStopped = unreal !== null
    && (unreal.state === 'crashed'
        || unreal.state === 'exited'
        || unreal.state === 'idle');
  const engineHint = unreal?.state === 'crashed'
    ? `Engine crashed${unreal.error ? ` — ${unreal.error}` : ''}`
    : unreal?.state === 'exited'
      ? 'Engine stopped'
      : unreal?.state === 'idle'
        ? 'Engine not configured'
        : null;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'var(--bg-void)' }}>
      <div ref={videoParentRef} className="absolute inset-0" />

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
                width: '580px',
                height: '580px',
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
                  width: '340px',
                  height: '340px',
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
                marginTop: '-8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                zIndex: 1,
              }}
            >
              {/* Loading dots — only while we believe the engine is
                  alive and we're just waiting for the WebRTC handshake.
                  When soul reports the engine stopped, we swap them
                  for the Restart affordance below. */}
              {!engineStopped && (
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
              )}

              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: engineStopped ? 'rgba(196,68,68,0.85)' : 'var(--text-ghost)',
                textAlign: 'center',
                maxWidth: '380px',
              }}>
                {engineHint ?? 'Waiting for UnClaw Engine'}
              </span>

              {/* Restart affordance. Prominent (warm-red filled) when
                  the engine is stopped; subtle ghost link otherwise so
                  it's available as an escape hatch during a long
                  handshake without dominating the loading screen. */}
              <button
                type="button"
                onClick={handleRestart}
                disabled={restarting}
                style={{
                  marginTop: 6,
                  padding: engineStopped ? '7px 16px' : '4px 10px',
                  borderRadius: 999,
                  fontSize: engineStopped ? 11 : 10,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: restarting ? 'default' : 'pointer',
                  background: engineStopped
                    ? 'rgba(196,68,68,0.14)'
                    : 'transparent',
                  border: engineStopped
                    ? '1px solid rgba(196,68,68,0.35)'
                    : '1px solid rgba(255,255,255,0.08)',
                  color: engineStopped
                    ? 'rgba(255,210,210,0.95)'
                    : 'var(--text-ghost)',
                  opacity: restarting ? 0.55 : 1,
                  transition: 'opacity 160ms ease, background 160ms ease',
                }}
              >
                {restarting
                  ? 'Restarting…'
                  : engineStopped ? 'Restart engine' : 'Restart'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
