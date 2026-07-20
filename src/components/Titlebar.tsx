import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Pin, PinOff, LogOut, Settings, Trash2, LogIn, UserCircle2, RotateCcw, Smartphone } from 'lucide-react';
import { getSoulBaseUrl } from '../services/soulBase';
import { ClawsIcon } from './ClawsBalance';
import { CompanionPanel } from './CompanionPanel';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Shared row style for entries inside the profile popover. The
 *  destructive "Reset all data" row overrides the color/background
 *  fields when armed. */
const menuItemStyle: React.CSSProperties = {
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
  // Cohesive with the SettingsPanel rail-item easing. The 160ms duration
  // is just slow enough that the row "settles" rather than snapping when
  // the user sweeps the menu with the cursor.
  transition: 'background var(--duration-fast) var(--ease-out-quart), color var(--duration-fast) var(--ease-out-quart)',
};

interface TitlebarUser {
  name: string | null;
  email: string;
  avatar_url: string | null;
}

interface TitlebarProps {
  /** Minimal-chrome mode for full-screen modes like Customization.
   *  Hides the profile cluster and UNCLAW wordmark; keeps only the
   *  pin / minimize / close window controls so the user can still
   *  manage the window without the identity chrome competing with
   *  the overlay's own UI. */
  minimalMode?: boolean;
  /** Replacement content for the left slot when minimalMode is on
   *  (where the profile button normally sits). Used by Customization
   *  to drop a Back button into the same DOM subtree as the working
   *  right-side window controls, so its click reliably wins over the
   *  Titlebar's drag region (which can't be defeated by z-index
   *  alone — WebkitAppRegion hit-testing operates at a different
   *  layer than CSS stacking). */
  leftSlot?: React.ReactNode;
  /** When true, the chrome shows a "Reconnecting…" banner under the
   *  bar — used while the pixel stream is dropped. */
  showReconnecting?: boolean;
  /** Signed-in user. When set, the profile avatar shows on the LEFT
   *  side (where the gear used to be) and clicking it opens a small
   *  menu with email + Sign out. */
  user?: TitlebarUser | null;
  /** True when the user picked "Continue without an account". The
   *  popover still mounts (so they can hit Reset / Sign in) but
   *  shows "Guest" as the identity and offers a "Sign in" affordance
   *  in place of "Sign out". */
  guestMode?: boolean;
  /** Triggered from the profile menu's "Sign out" row. */
  onSignOut?: () => void;
  /** Triggered from the "Sign in" row that's only shown in guest
   *  mode — drops the user back to the SignInScreen so they can
   *  promote a guest session into a real account. */
  onSignIn?: () => void;
  /** Triggered from the "Reset all data" row. Caller is responsible
   *  for confirming + actually wiping (resetEverything). The Titlebar
   *  just owns a two-step confirm UI (click once → "click again to
   *  confirm" — no separate dialog). */
  onResetAccount?: () => void;
  /** Triggered from the "Reset session" row. Sends a reset descriptor
   *  to the Unreal pixel stream so the character returns to a neutral
   *  pose / clears any in-progress speech. Same two-click confirm UI
   *  as Reset all data, since interrupting Grace mid-sentence on an
   *  accidental click would be annoying. */
  onResetSession?: () => void;
  /** Triggered from the "Settings" row in the profile dropdown. Opens
   *  the SettingsPanel modal where users can reconfigure LLM, TTS,
   *  agentic, and graphics settings post-onboarding. */
  onOpenSettings?: () => void;
  /** Claws balance shown as a pill just inboard of the profile cluster.
   *  undefined = hide it (signed out / minimal mode). */
  clawsBalance?: number | null;
  /** Signed-in session, threaded to the "Connect your phone" popover so it
   *  can pair the desktop (mint credential -> soul /pair/install). null hides
   *  the phone button (guest / signed out). */
  companionAuth?: { token: string | null; userId: string | null } | null;
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
  guestMode = false,
  onSignOut,
  onSignIn,
  onResetAccount,
  onResetSession,
  onOpenSettings,
  clawsBalance,
  companionAuth = null,
  minimalMode = false,
  leftSlot,
}: TitlebarProps) {
  const reduce = useReducedMotion() ?? false;
  const [pinned, setPinned] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  // "Connect your phone" popover (phone icon in the right capsule).
  const [companionOpen, setCompanionOpen] = useState(false);
  const companionWrapRef = useRef<HTMLDivElement | null>(null);
  // Two-step confirm for the destructive "Reset all data" row. First
  // click flips this on (the row turns red and prompts to confirm);
  // second click runs onResetAccount. Reset to false on popover close.
  const [resetArmed, setResetArmed] = useState(false);
  // Same two-click pattern for the softer "Reset session" row. Sends
  // a reset descriptor to Unreal but leaves the user's account / keys
  // untouched. Separate state so arming one doesn't affect the other.
  const [sessionResetArmed, setSessionResetArmed] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);
  // Click-the-balance explainer: claws can't be bought, only earned.
  const [clawsInfoOpen, setClawsInfoOpen] = useState(false);
  const clawsWrapRef = useRef<HTMLDivElement | null>(null);

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

  // Click-outside / Escape handler for the claws explainer popover.
  useEffect(() => {
    if (!clawsInfoOpen) return undefined;
    const onPointer = (e: MouseEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (!target) return;
      if (clawsWrapRef.current && !clawsWrapRef.current.contains(target)) {
        setClawsInfoOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setClawsInfoOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [clawsInfoOpen]);

  // Click-outside / Escape handler for the "Connect your phone" popover.
  useEffect(() => {
    if (!companionOpen) return undefined;
    const onPointer = (e: MouseEvent) => {
      const target = e.target instanceof Node ? e.target : null;
      if (target && companionWrapRef.current && !companionWrapRef.current.contains(target)) {
        setCompanionOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCompanionOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [companionOpen]);

  // Disarm the reset confirms when the popover closes — otherwise the
  // user could open it again and a stray click would skip the confirm.
  useEffect(() => {
    if (!profileOpen) {
      setResetArmed(false);
      setSessionResetArmed(false);
    }
  }, [profileOpen]);

  // macOS-only: reserve space on the left for the native NSWindow traffic
  // lights (close + min + full-screen) that main.ts surfaces via
  // titleBarStyle:'hidden' + trafficLightPosition:{x:12,y:12}. The lights
  // span ~70px starting at x=12 → end at x=82; padding-left=88 gives 6px
  // breathing room before the profile cluster starts.
  const isMacPlatform =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const titlebarPadding = isMacPlatform
    ? '12px 16px 28px 88px'
    : '12px 16px 28px 16px';

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
          padding: titlebarPadding,
        } as React.CSSProperties}
      >
        {/* macOS: flex-direction row-reverse swaps the left/right clusters
            so the profile (was on left) lands on the right edge, and the
            pin button (was on right) lands just past the native traffic
            lights on the left. The absolutely-positioned wordmark in the
            middle is unaffected by the flex direction flip. */}
        <div
          className="flex items-center justify-between"
          style={isMacPlatform ? { flexDirection: 'row-reverse' } : undefined}
        >
          {/* Left side — profile cluster (was on the right; gear was
              here previously). Bigger now so it reads as a primary
              identity affordance, not a chrome button. The dropdown
              opens DOWN-LEFT so it sits below the avatar without
              clipping the window's left edge.
              Renders in two modes: signed-in (avatar + initials) and
              guest mode (generic UserCircle icon). Both surface the
              same "Reset all data" row; the auth-state row swaps
              between Sign out (signed in) and Sign in (guest). */}
          {minimalMode ? (
            // Customization mode: hide the profile cluster. If a
            // leftSlot was provided, render it here (the no-drag
            // wrapper means clicks work — same plumbing as the
            // right-side window controls below). Otherwise a 36×36
            // spacer keeps the right cluster anchored.
            leftSlot ? (
              <div
                style={{
                  WebkitAppRegion: 'no-drag',
                } as React.CSSProperties}
              >
                {leftSlot}
              </div>
            ) : (
              <div style={{ width: 36, height: 36 }} />
            )
          ) : (user || guestMode) ? (
            <div
              ref={profileWrapRef}
              style={{
                position: 'relative',
                // One unified glass capsule holding the whole right cluster
                // (claws balance + pin + avatar). Height 36 with radius 18 ⇒
                // the rounded ends share the avatar circle's curvature, so the
                // avatar reads as the capsule's right cap.
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                // A touch taller than the 36px avatar so the circle floats
                // inside the capsule rather than capping it flush.
                height: 44,
                paddingLeft: clawsBalance !== undefined ? 14 : 8,
                paddingRight: 4,
                borderRadius: 22,
                background: 'var(--glass-bg, rgba(40, 48, 65, 0.5))',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
            >
              {/* Claws balance — the in-app currency, rendered inline as the
                  capsule's left content. Hidden when undefined (signed out).
                  Clickable: opens a tiny explainer that claws can't be bought,
                  only earned by interacting with agents. */}
              {clawsBalance !== undefined && (
                <div ref={clawsWrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
                  <button
                    type="button"
                    onClick={() => setClawsInfoOpen((o) => !o)}
                    aria-label="About claws"
                    aria-expanded={clawsInfoOpen}
                    title={clawsBalance == null ? 'Claws' : `${clawsBalance} claws`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      fontSize: 13.5,
                      fontWeight: 700,
                      fontFamily: 'inherit',
                      letterSpacing: '0.01em',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      WebkitAppRegion: 'no-drag',
                    } as React.CSSProperties}
                  >
                    <ClawsIcon size={18} animated />
                    {clawsBalance == null ? '—' : clawsBalance.toLocaleString()}
                  </button>

                  <AnimatePresence>
                    {clawsInfoOpen && (
                      <motion.div
                        key="claws-info"
                        role="dialog"
                        initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                        transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 12px)',
                          // Centered under the claws pill. marginLeft = -width/2
                          // (not translateX) so it doesn't fight framer-motion's
                          // animated transform on the y axis.
                          left: '50%',
                          marginLeft: -122,
                          width: 244,
                          padding: '13px 15px',
                          borderRadius: 14,
                          background: 'var(--glass-bg-panel)',
                          backdropFilter: 'var(--glass-blur)',
                          WebkitBackdropFilter: 'var(--glass-blur)',
                          border: '1px solid var(--glass-border)',
                          boxShadow: [
                            'var(--shadow-panel-ground)',
                            '0 12px 28px -12px rgba(196, 68, 68, 0.18)',
                          ].join(', '),
                          zIndex: 70,
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 12,
                            right: 12,
                            height: 1,
                            pointerEvents: 'none',
                            background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent)',
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                          <ClawsIcon size={16} animated={false} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                            Claws can't be bought
                          </span>
                        </div>
                        <p style={{
                          margin: 0,
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: 'var(--text-secondary)',
                        }}>
                          You earn a claw every time you interact with your agents, then spend them to unlock new ones.
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Hairline divider: separates the claws balance from the action
                  icons (discord / phone / pin) on its right. macOS only. */}
              {isMacPlatform && clawsBalance !== undefined && (
                <span
                  aria-hidden
                  style={{
                    width: 1,
                    height: 18,
                    background: 'rgba(255, 255, 255, 0.16)',
                    flex: '0 0 auto',
                  }}
                />
              )}

              {/* Join-our-Discord: opens join.unclaw.io in the user's browser.
                  Flat-colored to match the other icon buttons (not blurple). */}
              <button
                type="button"
                onClick={() => { void window.electronAPI?.authOpenExternal('https://join.unclaw.io'); }}
                aria-label="Join our Discord"
                title="Join our Discord"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: 8,
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  transition: 'background 150ms var(--ease-out-quart), color 150ms var(--ease-out-quart)',
                  WebkitAppRegion: 'no-drag',
                } as React.CSSProperties}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <svg viewBox="0 0 256 199" width="18" height="14" aria-hidden fill="currentColor">
                  <path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A161.094 161.094 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632 108.636 108.636 0 0 0 5.356-4.237c42.122 19.702 87.89 19.702 129.51 0a131.66 131.66 0 0 0 5.355 4.237 136.07 136.07 0 0 1-21.886 10.653c4.006 8.02 8.638 15.67 13.873 22.848 21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.804 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.2 23.014-26.2c12.867 0 23.236 11.804 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z" />
                </svg>
              </button>

              {/* Connect-your-phone: QR popover to pair the iOS companion. Sits
                  just left of the pin. Shown only when signed in (a session is
                  needed to pair). */}
              {companionAuth && (
                <div ref={companionWrapRef} style={{ position: 'relative', display: 'inline-flex', marginLeft: -5 }}>
                  <button
                    type="button"
                    onClick={() => setCompanionOpen((o) => !o)}
                    aria-label="Connect your phone"
                    aria-expanded={companionOpen}
                    title="Connect your phone"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 30, height: 30, borderRadius: 8,
                      background: companionOpen ? 'var(--glass-bg-hover)' : 'transparent',
                      border: 'none', padding: 0, cursor: 'pointer',
                      color: companionOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
                      transition: 'background 150ms var(--ease-out-quart), color 150ms var(--ease-out-quart)',
                      WebkitAppRegion: 'no-drag',
                    } as React.CSSProperties}
                    onMouseEnter={(e) => { if (!companionOpen) e.currentTarget.style.background = 'var(--glass-bg-hover)'; }}
                    onMouseLeave={(e) => { if (!companionOpen) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Smartphone size={17} strokeWidth={2} />
                  </button>
                  <AnimatePresence>
                    {companionOpen && (
                      <CompanionPanel
                        key="companion"
                        authToken={companionAuth.token}
                        userId={companionAuth.userId}
                        reduce={reduce}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* macOS-only: pin button rides INSIDE the profile cluster
                  so it lives on the right edge of the chrome (next to
                  the avatar) instead of getting orphaned on the left
                  next to the traffic lights. On Windows/Linux the pin
                  stays in the right-cluster buttons array below. */}
              {isMacPlatform && (
                <>
                  <motion.button
                    type="button"
                    whileTap={reduce ? undefined : { scale: 0.88 }}
                    onClick={handlePin}
                    aria-label={pinned ? 'Unpin from top' : 'Pin to top'}
                    title={pinned ? 'Unpin from top' : 'Pin to top'}
                    style={{
                      // Bare icon, no chip/circle. Brightness conveys state:
                      // bright when pinned, dim when not.
                      width: 22,
                      height: 22,
                      marginLeft: -5,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      opacity: pinned ? 1 : 0.4,
                      transition: 'opacity 180ms var(--ease-out-quart)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = pinned ? '1' : '0.7'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = pinned ? '1' : '0.4'; }}
                  >
                    <Pin size={15} color="#ffffff" strokeWidth={2} />
                  </motion.button>
                </>
              )}
              <motion.button
                type="button"
                whileTap={reduce ? undefined : { scale: 0.92 }}
                onClick={() => setProfileOpen((o) => !o)}
                aria-label="Profile menu"
                aria-expanded={profileOpen}
                title={user ? userDisplayName(user) : 'Guest'}
                className="glass-btn"
                style={{
                  // Caps the right end of the unified capsule. 36px circle vs
                  // the capsule's 18px radius ⇒ flush, framed by the capsule
                  // border (no own border needed).
                  width: 36,
                  height: 36,
                  flex: '0 0 auto',
                  borderRadius: '50%',
                  background: profileOpen
                    ? 'rgba(255, 255, 255, 0.16)'
                    : 'rgba(255, 255, 255, 0.07)',
                  border: 'none',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  transition: 'background 180ms var(--ease-out-quart)',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
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
                {user && user.avatar_url ? (
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
                ) : user ? (
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
                ) : (
                  <UserCircle2
                    size={20}
                    strokeWidth={1.6}
                    aria-hidden
                    color="var(--text-secondary)"
                  />
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
                      // Anchor side depends on which edge the profile
                      // cluster lives on. macOS: profile is on the right
                      // edge (row-reverse flex) — popover anchors right:0
                      // so it grows to the LEFT and doesn't clip off the
                      // window edge. Windows/Linux: profile on the left —
                      // popover anchors left:0 so it grows to the right.
                      ...(isMacPlatform ? { right: 0 } : { left: 0 }),
                      minWidth: 248,
                      padding: 6,
                      borderRadius: 14,
                      // NOTE: this popover is nested inside the profile capsule,
                      // which itself has backdrop-filter. Chromium can't
                      // composite the page content behind a *nested*
                      // backdrop-filter, so the blur here references the
                      // capsule's tiny region, not the chat/stream the menu
                      // floats over — it reads as un-blurred and blends in. We
                      // therefore carry readability with a near-opaque surface
                      // (the backdrop-filter stays as a harmless enhancement
                      // wherever it does composite).
                      background: 'rgba(26, 31, 43, 0.88)',
                      backdropFilter: 'blur(16px) saturate(1.4)',
                      WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
                      border: '1px solid var(--glass-border)',
                      // Use the shared panel-ground shadow so the popover
                      // sits in the same depth language as the SettingsPanel
                      // and widget panels. The accent-tinted underglow at
                      // the bottom warms the menu without color-tinting
                      // any of its content rows.
                      boxShadow: [
                        'var(--shadow-panel-ground)',
                        '0 12px 28px -12px rgba(196, 68, 68, 0.18)',
                      ].join(', '),
                      overflow: 'hidden',
                    }}
                  >
                    {/* Hairline-top ambient highlight, matching the
                        SettingsPanel + ChatPane + SoulBootScreen pattern. */}
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 12,
                        right: 12,
                        height: 1,
                        pointerEvents: 'none',
                        background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent)',
                      }}
                    />
                    <div
                      style={{
                        padding: '12px 12px 10px',
                        // Gradient hairline separator instead of a flat
                        // border-bottom. Reads less like a panel rule
                        // and more like a real piece of light catching
                        // the lip of the identity card.
                        position: 'relative',
                        marginBottom: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
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
                        {user ? userDisplayName(user) : 'Guest'}
                      </span>
                      {user && user.name && (
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
                      {!user && guestMode && (
                        <span
                          style={{
                            fontSize: 11.5,
                            color: 'var(--text-secondary)',
                            letterSpacing: '0.005em',
                          }}
                        >
                          Local-only session
                        </span>
                      )}
                      {/* Gradient hairline closing the identity card.
                          Fades from a faint mid-tone in the middle to
                          transparent at both edges so the separator
                          reads as ambient light rather than a ruled line. */}
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: 0,
                          height: 1,
                          pointerEvents: 'none',
                          background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.10), transparent)',
                        }}
                      />
                    </div>
                    {/* Settings — opens the in-app SettingsPanel modal
                        where users reconfigure LLM provider/model/key,
                        TTS provider/voice/key, agentic on/off + backend,
                        and graphics quality. Saves through the same
                        encrypted safeStorage path as onboarding. */}
                    {onOpenSettings && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          onOpenSettings();
                        }}
                        style={menuItemStyle}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <Settings size={14} strokeWidth={2} color="var(--text-secondary)" />
                        <span>Settings</span>
                      </button>
                    )}
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
                        const url = `${getSoulBaseUrl()}/`;
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
                      style={menuItemStyle}
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
                    {/* Reset session — sends a reset descriptor to the
                        Unreal pixel stream. Resets the character to a
                        neutral pose / clears any in-progress speech
                        without touching the user's keys, profile, or
                        account. Two-click confirm so an accidental hit
                        doesn't yank Grace out of mid-sentence. */}
                    {onResetSession && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          if (!sessionResetArmed) {
                            setSessionResetArmed(true);
                            return;
                          }
                          setProfileOpen(false);
                          setSessionResetArmed(false);
                          onResetSession();
                        }}
                        style={{
                          ...menuItemStyle,
                          color: sessionResetArmed
                            ? 'var(--accent)'
                            : 'var(--text-primary)',
                          background: sessionResetArmed
                            ? 'rgba(196, 68, 68, 0.10)'
                            : 'transparent',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = sessionResetArmed
                            ? 'rgba(196, 68, 68, 0.16)'
                            : 'rgba(255, 255, 255, 0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = sessionResetArmed
                            ? 'rgba(196, 68, 68, 0.10)'
                            : 'transparent';
                        }}
                      >
                        <RotateCcw
                          size={14}
                          strokeWidth={2}
                          color={sessionResetArmed
                            ? 'var(--accent)'
                            : 'var(--text-secondary)'}
                        />
                        <span>
                          {sessionResetArmed ? 'Click again to confirm' : 'Reset session'}
                        </span>
                      </button>
                    )}
                    {/* Sign in / Sign out — flips based on whether
                        the session is real (auth token) or guest. */}
                    {user ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          onSignOut?.();
                        }}
                        style={menuItemStyle}
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
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          onSignIn?.();
                        }}
                        style={menuItemStyle}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <LogIn size={14} strokeWidth={2} color="var(--text-secondary)" />
                        <span>Sign in</span>
                      </button>
                    )}

                    {/* Reset all data — destructive, two-click confirm.
                        First click flips the row red; second runs the
                        provided callback (which is responsible for the
                        actual wipe across local + cloud). The popover
                        closes on the second click since the App will
                        re-render without an authToken anyway. */}
                    {onResetAccount && (
                      <>
                        <div
                          aria-hidden
                          style={{
                            height: 1,
                            margin: '4px 4px',
                            background: 'rgba(255, 255, 255, 0.06)',
                          }}
                        />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            if (!resetArmed) {
                              setResetArmed(true);
                              return;
                            }
                            setProfileOpen(false);
                            setResetArmed(false);
                            onResetAccount();
                          }}
                          style={{
                            ...menuItemStyle,
                            color: resetArmed ? 'var(--accent)' : 'var(--text-primary)',
                            background: resetArmed
                              ? 'rgba(196, 68, 68, 0.10)'
                              : 'transparent',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = resetArmed
                              ? 'rgba(196, 68, 68, 0.16)'
                              : 'rgba(255, 255, 255, 0.06)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = resetArmed
                              ? 'rgba(196, 68, 68, 0.10)'
                              : 'transparent';
                          }}
                        >
                          <Trash2
                            size={14}
                            strokeWidth={2}
                            color={resetArmed ? 'var(--accent)' : 'var(--text-secondary)'}
                          />
                          <span style={{ flex: 1 }}>
                            {resetArmed ? 'Click again to confirm' : 'Reset all data'}
                          </span>
                          {!resetArmed && (
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--text-ghost)',
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                            >
                              testing
                            </span>
                          )}
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            // Spacer when signed-out, so the wordmark layout stays
            // balanced (the right cluster still anchors at right).
            <div style={{ width: 36, height: 36 }} />
          )}

          {/* Wordmark removed by request — the dock icon + app name in
              the menu bar are sufficient brand presence; the centered
              text was crowding the streamed face. */}

          <div
            className="flex items-center"
            style={{ WebkitAppRegion: 'no-drag', gap: 4 } as React.CSSProperties}
          >
            {/* Profile cluster moved to the LEFT (above). Right side
                only carries OS-style window controls now. */}

            {(() => {
              // On macOS the real NSWindow traffic lights (close + min +
              // full-screen) ride in the top-left via main.ts's
              // titleBarStyle:'hidden' and the `pin` button moved into
              // the profile cluster on the right. This cluster ends up
              // empty on macOS — kept around as a no-op placeholder so
              // the row-reverse flex's spacing math stays consistent.
              // Windows + Linux keep the full pin/min/close trio.
              if (isMacPlatform) return [];
              return [
                { action: handlePin, label: pinned ? 'Unpin from top' : 'Pin to top', icon: 'pin' as const },
                { action: () => window.electronAPI?.minimize(), label: 'Minimize', icon: 'min' as const },
                { action: () => window.electronAPI?.close(), label: 'Close', icon: 'close' as const },
              ];
            })().map(({ action, label, icon }, i) => (
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
            Reconnecting to Unclaw-Soul...
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
