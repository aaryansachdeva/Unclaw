import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Pin, PinOff, Settings, Eraser } from 'lucide-react';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface TitlebarProps {
  /** Memory turn count — 0 hides the gear's clear-memory row entirely. */
  memoryCount?: number;
  /** Display name of the active persona ("Grace" / "Mark"). */
  personaName?: string;
  /** Clear conversation memory; called after the user confirms. */
  onClearMemory?: () => void;
  /** When true, the chrome shows a "Reconnecting…" banner under the
   *  bar — used while the pixel stream is dropped. */
  showReconnecting?: boolean;
}

export function Titlebar({
  memoryCount = 0,
  personaName,
  onClearMemory,
  showReconnecting = false,
}: TitlebarProps) {
  const reduce = useReducedMotion() ?? false;
  const [pinned, setPinned] = useState(true);
  const [gearOpen, setGearOpen] = useState(false);
  const gearWrapRef = useRef<HTMLDivElement | null>(null);

  const handlePin = () => {
    const next = !pinned;
    setPinned(next);
    window.electronAPI?.togglePin(next);
  };

  // Click-outside on the gear popover.
  useEffect(() => {
    if (!gearOpen) return undefined;
    const onPointer = (e: MouseEvent) => {
      const node = gearWrapRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setGearOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGearOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [gearOpen]);

  return (
    <>
      <motion.div
        initial={reduce ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: reduce ? 0 : 0.1, ease: EASE_OUT_EXPO }}
        className="absolute top-0 left-0 right-0 z-50"
        style={{
          WebkitAppRegion: 'drag',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
          padding: '12px 16px 28px 16px',
        } as React.CSSProperties}
      >
        <div className="flex items-center justify-between">
          {/* Left side — gear (settings/memory). The wordmark moves
              into the center of the bar so the gear feels mirrored
              with the right-side window controls. */}
          <div
            ref={gearWrapRef}
            style={{
              position: 'relative',
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            <motion.button
              type="button"
              whileTap={reduce ? undefined : { scale: 0.88 }}
              onClick={() => setGearOpen(o => !o)}
              aria-label="Settings"
              aria-expanded={gearOpen}
              title="Settings"
              className="glass-btn"
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: gearOpen ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
                color: gearOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
                transition: 'background 180ms var(--ease-out-quart), color 180ms var(--ease-out-quart)',
              }}
              onMouseEnter={e => {
                if (gearOpen) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.10)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={e => {
                if (gearOpen) return;
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <Settings size={14} strokeWidth={2} />
            </motion.button>

            <AnimatePresence>
              {gearOpen && (
                <motion.div
                  key="gear-popover"
                  role="menu"
                  initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                  transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                  style={{
                    position: 'absolute',
                    top: 32,
                    left: 0,
                    minWidth: 220,
                    padding: 6,
                    borderRadius: 12,
                    background: 'var(--glass-bg-panel)',
                    backdropFilter: 'var(--glass-blur)',
                    WebkitBackdropFilter: 'var(--glass-blur)',
                    border: '1px solid var(--glass-border-focus)',
                    boxShadow: [
                      '0 1px 0 rgba(255,255,255,0.06) inset',
                      '0 12px 28px -8px rgba(0,0,0,0.45)',
                    ].join(', '),
                  }}
                >
                  {memoryCount > 0 ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const ok = window.confirm(
                          personaName
                            ? `Clear conversation history with ${personaName}?`
                            : 'Clear conversation history?',
                        );
                        if (ok) onClearMemory?.();
                        setGearOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        fontSize: 13,
                        fontWeight: 500,
                        letterSpacing: '-0.01em',
                        transition: 'background 120ms var(--ease-out-quart)',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <Eraser size={14} strokeWidth={2} color="var(--text-secondary)" />
                      <span style={{ flex: 1 }}>Clear conversation</span>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {memoryCount}
                      </span>
                    </button>
                  ) : (
                    <div
                      style={{
                        padding: '8px 10px',
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Nothing to clear yet.
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Wordmark — stays as the chrome's identity. */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.18em',
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            UNCLAW
          </span>

          <div
            className="flex items-center"
            style={{ WebkitAppRegion: 'no-drag', gap: 4 } as React.CSSProperties}
          >
            {([
              { action: handlePin, label: pinned ? 'Unpin from top' : 'Pin to top', icon: 'pin' as const },
              { action: () => window.electronAPI?.minimize(), label: 'Minimize', icon: 'min' as const },
              { action: () => window.electronAPI?.close(), label: 'Close', icon: 'close' as const },
            ]).map(({ action, label, icon }, i) => (
              <motion.button
                key={icon}
                initial={reduce ? { opacity: 1 } : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{
                  duration: 0.4,
                  delay: reduce ? 0 : 0.5 + i * 0.04,
                  ease: EASE_OUT_EXPO,
                }}
                whileTap={reduce ? undefined : { scale: 0.88 }}
                onClick={action}
                aria-label={label}
                title={label}
                className="glass-btn"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background:
                    icon === 'pin' && pinned
                      ? 'var(--accent-glow)'
                      : 'rgba(255,255,255,0.06)',
                  transition: 'background 180ms var(--ease-out-quart)',
                }}
                onMouseEnter={e => {
                  if (icon === 'pin' && pinned) {
                    e.currentTarget.style.background =
                      'color-mix(in srgb, var(--accent) 22%, transparent)';
                    return;
                  }
                  e.currentTarget.style.background = icon === 'close'
                    ? 'rgba(200,122,122,0.15)'
                    : 'rgba(255,255,255,0.12)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background =
                    icon === 'pin' && pinned
                      ? 'var(--accent-glow)'
                      : 'rgba(255,255,255,0.06)';
                }}
              >
                {icon === 'pin' && (pinned
                  ? <Pin size={14} color="var(--accent)" strokeWidth={2.2} />
                  : <PinOff size={14} color="var(--text-secondary)" strokeWidth={2} />
                )}
                {icon === 'min' && (
                  <svg width="12" height="2" viewBox="0 0 12 2" aria-hidden="true">
                    <line x1="0" y1="1" x2="12" y2="1" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                )}
                {icon === 'close' && (
                  <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                    <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" strokeLinecap="round" />
                    <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                )}
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Stream-disconnected banner — fades in over 600ms, out over
          300ms. Sits below the titlebar without a chrome surface, so
          the text-shadow does the legibility work. */}
      <AnimatePresence>
        {showReconnecting && (
          <motion.div
            key="reconnecting"
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.6, ease: EASE_OUT_EXPO }}
            style={{
              position: 'absolute',
              top: 48,
              left: 0,
              right: 0,
              textAlign: 'center',
              zIndex: 45,
              pointerEvents: 'none',
              userSelect: 'none',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: 'var(--text-secondary)',
              textShadow: '0 1px 3px rgba(0,0,0,0.7)',
            }}
          >
            Reconnecting to UnClaw Engine...
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
