import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConnectionState } from '../hooks/usePixelStreaming';
import logoUrl from '../assets/logo.png';

const MIN_LOADING_MS = 2000;

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

      {/* Live badge */}
      <AnimatePresence>
        {isConnected && (
          <motion.div
            key="live"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-20 flex items-center"
            style={{ top: '58px', right: '20px', gap: '7px' }}
          >
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--live)',
                boxShadow: '0 0 8px var(--live)',
                animation: 'pulse-dot 2.5s ease-in-out infinite',
              }}
            />
            <span style={{
              fontSize: '9px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--live)',
              opacity: 0.8,
            }}>
              LIVE
            </span>
          </motion.div>
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
                Awaiting stream
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
