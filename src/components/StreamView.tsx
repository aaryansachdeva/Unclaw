import { motion, AnimatePresence } from 'framer-motion';
import { ConnectionState } from '../hooks/usePixelStreaming';

interface StreamViewProps {
  videoParentRef: React.RefObject<HTMLDivElement | null>;
  connectionState: ConnectionState;
  connect: () => void;
}

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
};

export function StreamView({ videoParentRef, connectionState, connect }: StreamViewProps) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'var(--bg-void)' }}>
      <div ref={videoParentRef} className="absolute inset-0" />

      {/* Bottom vignette */}
      <AnimatePresence>
        {connectionState === 'connected' && (
          <motion.div
            key="vignette"
            {...fadeIn}
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
        {connectionState === 'connected' && (
          <motion.div
            key="live"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-20 flex items-center"
            style={{ top: '48px', right: '14px', gap: '6px' }}
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

      {/* Status overlays */}
      <AnimatePresence mode="wait">
        {connectionState !== 'connected' && (
          <motion.div
            key={connectionState}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center"
            style={{ background: 'var(--bg-void)' }}
          >
            {connectionState === 'connecting' && (
              <div className="flex flex-col items-center" style={{ gap: '16px' }}>
                <div className="relative" style={{ width: '40px', height: '40px' }}>
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    border: '2px solid transparent', borderTopColor: 'var(--accent)',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <div style={{
                    position: 'absolute', inset: '6px', borderRadius: '50%',
                    border: '2px solid transparent', borderTopColor: 'var(--accent-strong)',
                    animation: 'spin 1.5s linear infinite reverse',
                  }} />
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Connecting
                </span>
              </div>
            )}

            {connectionState === 'disconnected' && (
              <div className="flex flex-col items-center" style={{ gap: '20px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  border: '1.5px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)',
                  }} />
                </div>
                <div className="flex flex-col items-center" style={{ gap: '6px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Offline
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-ghost)' }}>
                    Waiting for stream on :8080
                  </span>
                </div>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={connect}
                  className="glass-btn"
                  style={{
                    padding: '8px 24px', borderRadius: '10px',
                    border: '1px solid var(--border-focus)',
                    background: 'var(--accent-dim)',
                    color: 'var(--accent)', fontSize: '12px', fontWeight: 600,
                  }}
                >
                  Connect
                </motion.button>
              </div>
            )}

            {connectionState === 'failed' && (
              <div className="flex flex-col items-center" style={{ gap: '16px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  border: '1.5px solid rgba(200,122,122,0.12)',
                  background: 'rgba(200,122,122,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--danger)' }} />
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Connection failed
                </span>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={connect}
                  className="glass-btn"
                  style={{
                    padding: '8px 20px', borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                    fontSize: '12px', fontWeight: 500,
                  }}
                >
                  Retry
                </motion.button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
