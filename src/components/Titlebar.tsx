import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Pin, PinOff, LogOut, Settings } from 'lucide-react';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface TitlebarUser {
  name: string | null;
  email: string;
  avatar_url: string | null;
}

interface TitlebarProps {
  /** When true, the chrome shows a "Reconnecting…" banner under the
   *  bar — used while the pixel stream is dropped. */
  showReconnecting?: boolean;
  /** Signed-in user. When set, the profile avatar shows on the LEFT
   *  side (where the gear used to be) and clicking it opens a small
   *  menu with email + Sign out. */
  user?: TitlebarUser | null;
  /** Triggered from the profile menu's "Sign out" row. */
  onSignOut?: () => void;
  /** Width of the workspace area in pixels — i.e. window width minus
   *  any open chat pane. Used to keep the UNCLAW wordmark centered
   *  over the visible stream view rather than the whole window. When
   *  omitted, the wordmark falls back to its old flex-centered slot. */
  workspaceWidth?: number;
}

function userInitials(user: TitlebarUser): string {
  const source = (user.name || user.email || '').trim();
  if (!source) return '?';
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source[0].toUpperCase();
}

function userDisplayName(user: TitlebarUser): string {
  return (user.name && user.name.trim()) || user.email;
}

export function Titlebar({
  showReconnecting = false,
  user = null,
  onSignOut,
  workspaceWidth,
}: TitlebarProps) {
  const reduce = useReducedMotion() ?? false;
  const [pinned, setPinned] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);

  const handlePin = () => {
    const next = !pinned;
    setPinned(next);
    window.electronAPI?.togglePin(next);
  };

  // Click-outside handler for the profile popover.
  useEffect(() => {
    if (!profileOpen) return undefined;
    const onPointer = (e: MouseEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!target) return;
      if (profileOpen && profileWrapRef.current && !profileWrapRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setProfileOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen]);

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
          {/* Left side — profile cluster (was on the right; gear was
              here previously). Bigger now so it reads as a primary
              identity affordance, not a chrome button. The dropdown
              opens DOWN-LEFT so it sits below the avatar without
              clipping the window's left edge. */}
          {user ? (
            <div
              ref={profileWrapRef}
              style={{
                position: 'relative',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
            >
              <motion.button
                type="button"
                whileTap={reduce ? undefined : { scale: 0.92 }}
                onClick={() => setProfileOpen((o) => !o)}
                aria-label="Profile menu"
                aria-expanded={profileOpen}
                title={userDisplayName(user)}
                className="glass-btn"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: profileOpen
                    ? 'rgba(255, 255, 255, 0.14)'
                    : 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.10)',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  transition: 'background 180ms var(--ease-out-quart)',
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  if (profileOpen) return;
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.10)';
                }}
                onMouseLeave={(e) => {
                  if (profileOpen) return;
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                }}
              >
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '50%',
                      display: 'block',
                    }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    aria-hidden
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {userInitials(user)}
                  </span>
                )}
              </motion.button>

              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    key="profile-popover"
                    role="menu"
                    initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                    transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                    style={{
                      position: 'absolute',
                      top: 42,
                      // Anchored LEFT now that the avatar lives on the
                      // left side of the chrome.
                      left: 0,
                      minWidth: 240,
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
                    <div
                      style={{
                        padding: '10px 12px 8px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                        marginBottom: 4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          letterSpacing: '-0.01em',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {userDisplayName(user)}
                      </span>
                      {user.name && (
                        <span
                          style={{
                            fontSize: 11.5,
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {user.email}
                        </span>
                      )}
                    </div>
                    {/* Soul Settings — opens the soul portal in the
                        user's default browser. Engine power-user surface;
                        most users never need it but it's the canonical
                        place to tune lipsync sliders, model picks,
                        signalling config, and the live stats viz. */}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileOpen(false);
                        const url = 'http://127.0.0.1:8765/';
                        // Open in the user's default browser via Electron's
                        // shell.openExternal. The auth:open-external IPC
                        // handler accepts any http(s) URL — name's a misnomer
                        // (it just shells out). Browser fallback for non-
                        // Electron contexts (vite dev preview, etc.).
                        if (window.electronAPI?.authOpenExternal) {
                          void window.electronAPI.authOpenExternal(url);
                        } else {
                          window.open(url, '_blank', 'noopener,noreferrer');
                        }
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
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <Settings size={14} strokeWidth={2} color="var(--text-secondary)" />
                      <span>Soul Settings</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileOpen(false);
                        onSignOut?.();
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
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <LogOut size={14} strokeWidth={2} color="var(--text-secondary)" />
                      <span>Sign out</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            // Spacer when signed-out, so the wordmark layout stays
            // balanced (the right cluster still anchors at right).
            <div style={{ width: 36, height: 36 }} />
          )}

          {/* Wordmark — pinned absolutely to the WORKSPACE center
              (not the window center) so it stays visually centered
              over the streamed face even when the chat pane opens
              and the workspace shrinks. Falls back to the original
              centered flex slot when workspaceWidth isn't provided. */}
          {workspaceWidth !== undefined ? (
            <span
              aria-hidden="false"
              style={{
                position: 'absolute',
                // Vertically aligned with the gear / right-cluster
                // buttons. Titlebar padding is 12px top + ~26px
                // button height, so the row's center sits at y≈25.
                top: 25,
                left: workspaceWidth / 2,
                transform: 'translate(-50%, -50%)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.18em',
                color: 'rgba(255,255,255,0.4)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                transition: 'left 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              UNCLAW
            </span>
          ) : (
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
          )}

          <div
            className="flex items-center"
            style={{ WebkitAppRegion: 'no-drag', gap: 4 } as React.CSSProperties}
          >
            {/* Profile cluster moved to the LEFT (above). Right side
                only carries OS-style window controls now. */}

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
                      ? 'rgba(255, 255, 255, 0.18)'
                      : 'rgba(255,255,255,0.06)',
                  transition: 'background 180ms var(--ease-out-quart)',
                }}
                onMouseEnter={e => {
                  if (icon === 'pin' && pinned) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.26)';
                    return;
                  }
                  e.currentTarget.style.background = icon === 'close'
                    ? 'rgba(200,122,122,0.15)'
                    : 'rgba(255,255,255,0.12)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background =
                    icon === 'pin' && pinned
                      ? 'rgba(255, 255, 255, 0.18)'
                      : 'rgba(255,255,255,0.06)';
                }}
              >
                {icon === 'pin' && (pinned
                  ? <Pin size={14} color="#ffffff" strokeWidth={2.2} />
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
