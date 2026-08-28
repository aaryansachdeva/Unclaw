// SoulBootScreen — quiet awakening, v3.
//
// Composition: monumental lobster as the centerpiece, an elegant
// hairline arc orbiting it as the activity indicator (a watch-second
// hand, not a spinner), a tiny letterspaced UNCLAW wordmark + clock
// beneath. Bottom edge carries soul telemetry as ambient text fading
// into the void.
//
// What's NOT here, deliberately: no headline status text, no
// "loading…" copy, no progress bar, no card frame. The lobster, the
// orbit, the breath. Everything else is whisper.
//
// Functional contract:
//   * Hydrates from `electronAPI.soul.getStatus()` on mount, so a
//     Cmd-R after soul is already up immediately dismisses (instead
//     of waiting forever on IPC events that already fired).
//   * Subscribes to `soul:log` + `soul:ready` for future updates.
//   * Fires `onReady()` when the soul READY marker lands.

import { useEffect, useRef, useState } from 'react';
import logoUrl from '../assets/logo_lg.png';

export interface SoulBootScreenProps {
  onReady: () => void;
}

interface LogLine {
  stream: 'stdout' | 'stderr' | 'meta';
  line: string;
}

const MAX_LINES = 200;

export function SoulBootScreen({ onReady }: SoulBootScreenProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  // Tracks when the supervisor reports soul actually spawned, NOT
  // when this component mounted — those diverge after Cmd-R. The
  // supervisor sends `elapsedMs` in the snapshot so we anchor the
  // clock to real spawn time.
  const [spawnedAt, setSpawnedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const feedRef = useRef<HTMLDivElement | null>(null);
  // Resilience surface: 'booting' (normal), 'retrying' (supervisor is
  // auto-respawning soul after an unexpected exit), 'failed' (boot gave
  // up — show a real reason + Retry instead of an infinite spinner).
  const [status, setStatus] = useState<'booting' | 'retrying' | 'failed'>('booting');
  const [failInfo, setFailInfo] = useState<{ reason: string; recentErrors: string[] } | null>(null);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; max: number } | null>(null);

  // Hydrate from the supervisor's snapshot at mount AND subscribe to
  // future events. Snapshot covers refresh-after-ready; subscription
  // covers cold-boot stream.
  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.soul?.getStatus?.().then((snap) => {
      if (cancelled || !snap) return;
      setLogs(snap.recentLogs.slice(-MAX_LINES));
      setSpawnedAt(Date.now() - snap.elapsedMs);
      if (snap.ready) onReady();
      else if (snap.failed) setStatus('failed');
    });

    const offLog = window.electronAPI?.soul?.onLog?.((data) => {
      setLogs((prev) => {
        const next = [...prev, data];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });
    const offReady = window.electronAPI?.soul?.onReady?.(() => onReady());
    const offRetrying = window.electronAPI?.soul?.onRetrying?.((d) => {
      setStatus('retrying'); setRetryInfo(d);
    });
    const offFailed = window.electronAPI?.soul?.onFailed?.((d) => {
      setStatus('failed'); setFailInfo(d);
    });

    return () => {
      cancelled = true;
      offLog?.();
      offReady?.();
      offRetrying?.();
      offFailed?.();
    };
  }, [onReady]);

  // User-initiated retry from the failure screen: clear failure state,
  // re-anchor the clock, and ask the supervisor for a fresh boot episode.
  const handleRetry = () => {
    setStatus('booting');
    setFailInfo(null);
    setRetryInfo(null);
    setSpawnedAt(Date.now());
    setLogs([]);
    void window.electronAPI?.soul?.restart?.();
  };

  // Reveal the logs folder for support / self-debugging.
  const handleOpenLogs = () => { void window.electronAPI?.soul?.openLogs?.(); };

  // After ~25s of a normal boot, reassure the user this is expected on a
  // cold first run (model loads) rather than a hang.
  const showSlowHint = status === 'booting' && elapsed >= 25;

  // Clock tick.
  useEffect(() => {
    const anchor = spawnedAt ?? Date.now();
    const t = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - anchor) / 1000)));
    }, 250);
    return () => clearInterval(t);
  }, [spawnedAt]);

  // Auto-scroll the ambient feed to its newest line.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [logs]);

  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, '0');
  const timeStr = mm > 0 ? `${mm}:${ss}` : `${ss}″`;

  // Orbit geometry — a single hairline arc that rotates around the
  // logo. The arc is ~38° wide; combined with the slow rotation
  // (9s/turn) it reads as a watch hand sweep, not a spinner. The
  // small leading dot makes it feel directional / alive without
  // being a spinner cliche.
  const ORBIT_DIAMETER = 286;
  const ORBIT_R = ORBIT_DIAMETER / 2;
  const ORBIT_CIRC = 2 * Math.PI * ORBIT_R;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: '#050506',
        overflow: 'hidden',
        WebkitAppRegion: 'drag',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
        color: 'rgba(255, 255, 255, 0.9)',
      } as React.CSSProperties}
    >
      {/* Warm vignette behind the monument. Same large soft-edged
          radial that subtly breathes — the only color in the void. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: '32%',
          left: '50%',
          width: 880,
          height: 880,
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(196, 68, 68, 0.22) 0%, rgba(196, 68, 68, 0.07) 32%, transparent 62%)',
          pointerEvents: 'none',
          animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
        }}
      />

      {/* Top edge hairline — barely visible, breathes with the rest. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: 'linear-gradient(90deg, transparent 10%, rgba(196, 68, 68, 0.55) 50%, transparent 90%)',
          animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
          opacity: 0.6,
        }}
      />

      {/* Monument zone — logo + orbit + tiny wordmark + clock. */}
      <div
        style={{
          flex: '0 0 auto',
          paddingTop: '15vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 22,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Logo + orbit composite. Single positioning container so
            the orbit can be sized independently of (and centered on)
            the logo. */}
        <div
          style={{
            position: 'relative',
            width: ORBIT_DIAMETER,
            height: ORBIT_DIAMETER,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Orbit ring — SVG so we can draw a precise arc with a
              leading dot. The whole <svg> rotates as a unit. */}
          <svg
            aria-hidden
            width={ORBIT_DIAMETER}
            height={ORBIT_DIAMETER}
            viewBox={`0 0 ${ORBIT_DIAMETER} ${ORBIT_DIAMETER}`}
            style={{
              position: 'absolute',
              inset: 0,
              animation: 'unclaw-boot-orbit 9s linear infinite',
              // Force GPU promotion so the rotation stays buttery
              // even when the renderer is busy mounting the rest
              // of the React tree.
              willChange: 'transform',
            }}
          >
            {/* Faint full ring underneath — gives the orbit a "track"
                without competing visually. Just barely visible. */}
            <circle
              cx={ORBIT_R}
              cy={ORBIT_R}
              r={ORBIT_R - 1}
              fill="none"
              stroke="rgba(255, 255, 255, 0.045)"
              strokeWidth={1}
            />
            {/* Active arc — a single segment that ENDS at 3 o'clock
                (path position 0) and trails counterclockwise behind
                the leading dot. Achieved with:
                  - dasharray: 10% on, then rest off (single segment)
                  - dashoffset: shift the pattern backward by exactly
                    one segment length so the dash sits at path
                    positions (90% → 100%), i.e. its END lands on
                    path position 0 / 100% which is 3 o'clock.
                The svg rotates as a whole, so the dot+arc travel
                together; they only have to align at one position. */}
            <circle
              cx={ORBIT_R}
              cy={ORBIT_R}
              r={ORBIT_R - 1}
              fill="none"
              stroke="rgba(196, 68, 68, 0.78)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray={`${ORBIT_CIRC * 0.10} ${ORBIT_CIRC}`}
              strokeDashoffset={ORBIT_CIRC * 0.10}
            />
            {/* Leading dot — sits ON the arc's endpoint at 3 o'clock.
                Positioned at the same radius (ORBIT_R - 1) so it
                overlaps the round stroke cap, making the join read
                as one continuous gesture. */}
            <circle
              cx={ORBIT_R + (ORBIT_R - 1)}
              cy={ORBIT_R}
              r={2.5}
              fill="rgba(255, 200, 190, 0.92)"
            />
          </svg>

          {/* Lobster logo, centered. Halo via drop-shadow + breathing
              opacity so it pulses with the vignette. */}
          <img
            src={logoUrl}
            alt="Unclaw"
            draggable={false}
            style={{
              width: 220,
              height: 220,
              objectFit: 'contain',
              userSelect: 'none',
              filter: 'drop-shadow(0 14px 38px rgba(196, 68, 68, 0.38)) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.65))',
              animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
              position: 'relative',
              zIndex: 1,
            }}
          />
        </div>

        {/* Tiny wordmark — letterspaced, soft. The brand signature
            in place of any "loading" copy. Lowercase letterforms
            with wide tracking + capital sizing give it a refined
            quiet-luxury feel. */}
        <div
          style={{
            fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.62em',
            textTransform: 'uppercase',
            color: 'rgba(255, 255, 255, 0.48)',
            // Compensate for the tracking pushing the visual center
            // to the right — pad the letterspacing's missing space
            // on the right side so the wordmark optically centers.
            paddingLeft: '0.62em',
            marginTop: -4,
          }}
        >
          unclaw
        </div>

        {/* Time anchor — single line, monospace, very low contrast.
            The only changing text in the upper half; doubles as a
            "still working" signal. */}
        <div
          style={{
            fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
            fontSize: 10,
            letterSpacing: '0.18em',
            color: 'rgba(255, 255, 255, 0.28)',
            fontVariantNumeric: 'tabular-nums',
            marginTop: 4,
          }}
        >
          {timeStr}
        </div>
      </div>

      {/* Spacer pushes the ambient feed to the bottom. */}
      <div style={{ flex: '1 1 auto', minHeight: 24 }} />

      {/* Ambient feed — soul stdout as scrolling telemetry at the
          bottom edge. Gradient-masked so older lines visually dissolve
          into the void as they scroll up. No background, no border —
          the void IS the frame. */}
      <div
        ref={feedRef}
        style={{
          flex: '0 0 30%',
          position: 'relative',
          padding: '0 32px 24px',
          overflowY: 'auto',
          overflowX: 'hidden',
          fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
          fontSize: 10.5,
          lineHeight: 1.65,
          color: 'rgba(255, 255, 255, 0.42)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 100%)',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 100%)',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {logs.length === 0 ? (
          <div style={{ height: '100%' }} />
        ) : (
          logs.map((entry, i) => (
            <div
              key={i}
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: entry.stream === 'stderr'
                  ? 'rgba(220, 170, 160, 0.45)'
                  : entry.stream === 'meta'
                  ? 'rgba(170, 190, 220, 0.55)'
                  : 'rgba(255, 255, 255, 0.42)',
              }}
            >
              {entry.line}
            </div>
          ))
        )}
      </div>

      {/* Bottom edge hairline — twin to the top. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          background: 'linear-gradient(90deg, transparent 10%, rgba(196, 68, 68, 0.45) 50%, transparent 90%)',
          animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
          opacity: 0.45,
        }}
      />

      {/* Reassurance on a slow-but-healthy cold boot (first run loads
          models). Whisper-quiet so it never reads as an error. */}
      {showSlowHint && (
        <div
          style={{
            position: 'absolute',
            top: '60%',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 12.5,
            lineHeight: 1.5,
            color: 'rgba(255, 255, 255, 0.5)',
            pointerEvents: 'none',
            padding: '0 40px',
          }}
        >
          First launch is preparing your companion.<br />Loading the AI models can take a minute.
        </div>
      )}

      {/* Auto-respawn in progress: brief, calm. */}
      {status === 'retrying' && (
        <div
          style={{
            position: 'absolute',
            top: '60%',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 12.5,
            color: 'rgba(220, 190, 185, 0.7)',
            pointerEvents: 'none',
            padding: '0 40px',
          }}
        >
          Restarting{retryInfo ? ` (${retryInfo.attempt}/${retryInfo.max})` : ''}…
        </div>
      )}

      {/* NOTE: no relaunch/logs affordance during a healthy boot. This screen
          is the brand moment — lobster, orbit, breath, nothing else. A boot
          that is merely slow is not actionable, and buttons here read as an
          error the user should respond to. The recovery pair lives on the two
          screens where a stall IS real: the `failed` overlay below (boot gave
          up) and StreamView's stalled state (soul up, stream never arrives). */}

      {/* Unrecoverable boot failure: a real reason + Retry, never an
          infinite spinner. Covers the whole void so it's unmissable. */}
      {status === 'failed' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 80,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: 'rgba(5, 5, 6, 0.86)',
            backdropFilter: 'blur(2px)',
            WebkitAppRegion: 'no-drag',
            padding: '0 48px',
            textAlign: 'center',
          } as React.CSSProperties}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.01em' }}>
            Unclaw couldn't start
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.6)', maxWidth: 360 }}>
            {failInfo?.reason
              ? `Soul didn't come up: ${failInfo.reason}.`
              : 'Soul didn’t come up.'}{' '}
            This is usually transient. Retry, and if it keeps happening, restart the app.
          </div>
          {failInfo?.recentErrors && failInfo.recentErrors.length > 0 && (
            <details style={{ maxWidth: 460, width: '100%' }}>
              <summary style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', userSelect: 'none' }}>
                Show details
              </summary>
              <pre style={{
                marginTop: 8,
                maxHeight: 160,
                overflow: 'auto',
                textAlign: 'left',
                fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                fontSize: 10,
                lineHeight: 1.5,
                color: 'rgba(220, 170, 160, 0.7)',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: '10px 12px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {failInfo.recentErrors.join('\n')}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                padding: '10px 26px',
                borderRadius: 999,
                border: '1px solid rgba(196, 68, 68, 0.5)',
                background: 'var(--accent-dim, rgba(196,68,68,0.16))',
                color: 'rgba(255,255,255,0.95)',
                fontSize: 13.5,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleOpenLogs}
              style={{
                padding: '10px 20px',
                borderRadius: 999,
                border: '1px solid rgba(255, 255, 255, 0.16)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              Open logs
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes unclaw-boot-breath {
          0%, 100% { opacity: 0.62; }
          50%      { opacity: 1.0; }
        }
        @keyframes unclaw-boot-orbit {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
