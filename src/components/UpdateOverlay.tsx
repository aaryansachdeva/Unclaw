// UpdateOverlay — second-launch onward, runs after SetupWizard between the
// setup-complete gate and SoulBootScreen.
//
// Mirrors SetupWizard's monument aesthetic (void bg, lobster orbit, breathing
// vignette) so the boot-flow surfaces feel continuous: SetupWizard → this →
// SoulBootScreen → AppMain all share the same visual grammar.
//
// What changes inside the monument: a per-category status list instead of a
// single stage line. When a restart is required to apply downloaded updates,
// the overlay surfaces a "Restart now" / "Continue with old version" pair.

import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../assets/logo_lg.png';

export interface UpdateOverlayProps {
  onComplete: () => void;
}

// Same shape exported by env.d.ts — re-declared inline to avoid a circular
// import on the global Window interface.
type CategoryId = 'app' | 'soul' | 'unreal' | 'assets';
type CategoryState =
  | 'pending' | 'downloading' | 'applying' | 'ready' | 'failed' | 'up-to-date';

interface CategoryProgress {
  id: CategoryId;
  state: CategoryState;
  progress: number | null;
  detail?: string;
  from: string | null;
  to: string;
}

interface Snapshot {
  done: boolean;
  categories: CategoryProgress[];
  restartRequired: boolean;
  fatalError: string | null;
}

const CATEGORY_LABEL: Record<CategoryId, string> = {
  app:    'App shell',
  soul:   'Voice core',
  unreal: 'Character',
  assets: 'Models',
};

function overallProgress(snap: Snapshot): number {
  if (snap.categories.length === 0) return 0.08;
  const sum = snap.categories.reduce((acc, c) => acc + (c.progress ?? 0), 0);
  return Math.max(0.08, sum / snap.categories.length);
}

function headline(snap: Snapshot): string {
  if (snap.fatalError) return 'Update check ran into a problem.';
  if (snap.categories.length === 0) return 'Checking for updates…';
  if (snap.restartRequired) return 'Updates ready.';
  if (snap.done) return 'You’re up to date.';
  const downloading = snap.categories.find((c) => c.state === 'downloading');
  if (downloading) return `Downloading ${CATEGORY_LABEL[downloading.id].toLowerCase()}…`;
  const applying = snap.categories.find((c) => c.state === 'applying');
  if (applying) return `Installing ${CATEGORY_LABEL[applying.id].toLowerCase()}…`;
  return 'Preparing updates…';
}

function detail(snap: Snapshot): string | undefined {
  if (snap.fatalError) return snap.fatalError;
  const active = snap.categories.find(
    (c) => c.state === 'downloading' || c.state === 'applying',
  );
  return active?.detail;
}

export function UpdateOverlay({ onComplete }: UpdateOverlayProps) {
  const [snap, setSnap] = useState<Snapshot>({
    done: false,
    categories: [],
    restartRequired: false,
    fatalError: null,
  });
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(false);
  // Once we've decided to dismiss, ignore any late snapshots that might
  // arrive after a slow IPC round-trip — the parent has already mounted
  // SoulBootScreen and a stale "ready" state would surface as flicker.
  const dismissedRef = useRef(false);

  // Hydrate + subscribe + start.
  useEffect(() => {
    const api = window.electronAPI?.update;
    if (!api) {
      // Dev / browser renderer / pre-update-API binary — never blocks.
      onComplete();
      return;
    }

    let cancelled = false;
    api.getStatus().then((s) => {
      if (cancelled) return;
      // Already done from a prior invocation in this session? Skip
      // straight through — the update check is once per process.
      if (s && s.done && !s.restartRequired) {
        dismissedRef.current = true;
        onComplete();
        return;
      }
      if (s) setSnap(s);
      if (!startedRef.current) {
        startedRef.current = true;
        api.start().catch(() => { /* terminal state surfaces via update:snapshot */ });
      }
    }).catch(() => {
      // IPC failure — don't block launch.
      dismissedRef.current = true;
      onComplete();
    });

    const offSnap = api.onSnapshot((s) => {
      if (dismissedRef.current) return;
      setSnap(s);
      // Auto-dismiss when there's nothing requiring user attention — a
      // category that's 'failed' is a non-recoverable end state for this
      // session (we couldn't reach the manifest, Squirrel choked, etc.)
      // and shouldn't block the user from launching the app. Only
      // 'ready' + restartRequired holds the overlay open with a button.
      const terminal = (state: string) =>
        state === 'up-to-date' || state === 'failed';
      const allClear = s.done
        && !s.restartRequired
        && s.categories.every((c) => terminal(c.state));
      if (allClear) {
        dismissedRef.current = true;
        // Tiny visual beat so the user sees the final state land rather
        // than the overlay flickering away.
        setTimeout(onComplete, 350);
      }
    });

    return () => {
      cancelled = true;
      offSnap?.();
    };
  }, [onComplete]);

  // Clock — same "still working" beacon as SetupWizard.
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 250);
    return () => clearInterval(t);
  }, []);

  const overall = useMemo(() => overallProgress(snap), [snap]);
  const isFailed = snap.fatalError !== null
    || snap.categories.some((c) => c.state === 'failed');

  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, '0');
  const timeStr = mm > 0 ? `${mm}:${ss}` : `${ss}″`;

  const ORBIT_DIAMETER = 286;
  const ORBIT_R = ORBIT_DIAMETER / 2;
  const ORBIT_CIRC = 2 * Math.PI * ORBIT_R;
  const arcFraction = Math.max(0.08, overall);

  const onRestart = () => {
    window.electronAPI?.update?.restart().catch(() => { /* main process will quit either way */ });
  };
  const onContinue = () => {
    dismissedRef.current = true;
    onComplete();
  };

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
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: '32%', left: '50%',
          width: 880, height: 880,
          transform: 'translate(-50%, -50%)',
          background: isFailed
            ? 'radial-gradient(circle, rgba(220, 100, 100, 0.18) 0%, rgba(180, 70, 70, 0.06) 32%, transparent 62%)'
            : 'radial-gradient(circle, rgba(196, 68, 68, 0.22) 0%, rgba(196, 68, 68, 0.07) 32%, transparent 62%)',
          pointerEvents: 'none',
          animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
        }}
      />

      <span
        aria-hidden
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg, transparent 10%, rgba(196, 68, 68, 0.55) 50%, transparent 90%)',
          animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
          opacity: 0.6,
        }}
      />

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
          <svg
            aria-hidden
            width={ORBIT_DIAMETER}
            height={ORBIT_DIAMETER}
            viewBox={`0 0 ${ORBIT_DIAMETER} ${ORBIT_DIAMETER}`}
            style={{
              position: 'absolute',
              inset: 0,
              animation: 'unclaw-boot-orbit 9s linear infinite',
              willChange: 'transform',
            }}
          >
            <circle
              cx={ORBIT_R} cy={ORBIT_R} r={ORBIT_R - 1}
              fill="none"
              stroke="rgba(255, 255, 255, 0.045)"
              strokeWidth={1}
            />
            <circle
              cx={ORBIT_R} cy={ORBIT_R} r={ORBIT_R - 1}
              fill="none"
              stroke={isFailed ? 'rgba(220, 110, 110, 0.78)' : 'rgba(196, 68, 68, 0.78)'}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray={`${ORBIT_CIRC * arcFraction} ${ORBIT_CIRC}`}
              strokeDashoffset={ORBIT_CIRC * arcFraction}
              style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.22, 1, 0.36, 1), stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
            <circle
              cx={ORBIT_R + (ORBIT_R - 1)} cy={ORBIT_R}
              r={2.5}
              fill="rgba(255, 200, 190, 0.92)"
            />
          </svg>

          <img
            src={logoUrl}
            alt="Unclaw"
            draggable={false}
            style={{
              width: 220, height: 220,
              objectFit: 'contain',
              userSelect: 'none',
              filter: 'drop-shadow(0 14px 38px rgba(196, 68, 68, 0.38)) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.65))',
              animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
              position: 'relative',
              zIndex: 1,
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            maxWidth: 380,
            textAlign: 'center',
            padding: '0 24px',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.02em',
              color: 'rgba(255, 255, 255, 0.78)',
              transition: 'color 400ms ease',
            }}
          >
            {headline(snap)}
          </div>
          {detail(snap) && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: '0.04em',
                color: isFailed
                  ? 'rgba(220, 150, 150, 0.7)'
                  : 'rgba(255, 255, 255, 0.42)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {detail(snap)}
            </div>
          )}
          <div
            style={{
              fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
              fontSize: 10,
              letterSpacing: '0.18em',
              color: 'rgba(255, 255, 255, 0.22)',
              fontVariantNumeric: 'tabular-nums',
              marginTop: 4,
            }}
          >
            {timeStr}
          </div>
        </div>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 24 }} />

      {/* Per-category status list — replaces SetupWizard's ambient log feed.
          Update flows are short enough that a structured per-category view is
          more useful than a streaming console. */}
      <div
        style={{
          flex: '0 0 auto',
          padding: '0 48px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {snap.categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </div>

      {/* Restart prompt — only after the pipeline finishes AND we have
          downloaded updates queued for next launch. */}
      {snap.restartRequired && (
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
            padding: '0 48px 36px',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <button
            onClick={onRestart}
            style={{
              padding: '10px 22px',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: 'rgba(255, 255, 255, 0.92)',
              background: 'rgba(196, 68, 68, 0.42)',
              border: '1px solid rgba(255, 200, 190, 0.34)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 200ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(196, 68, 68, 0.62)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(196, 68, 68, 0.42)'; }}
          >
            Restart now
          </button>
          <button
            onClick={onContinue}
            style={{
              padding: '10px 22px',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: 'rgba(255, 255, 255, 0.62)',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 200ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.09)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
          >
            Continue without restarting
          </button>
        </div>
      )}

      {snap.fatalError && !snap.restartRequired && (
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            justifyContent: 'center',
            padding: '0 48px 36px',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          <button
            onClick={onContinue}
            style={{
              padding: '10px 22px',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: 'rgba(255, 255, 255, 0.78)',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Continue anyway
          </button>
        </div>
      )}

      <span
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg, transparent 10%, rgba(196, 68, 68, 0.45) 50%, transparent 90%)',
          animation: 'unclaw-boot-breath 4.6s ease-in-out infinite',
          opacity: 0.45,
        }}
      />

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

function CategoryRow({ category }: { category: CategoryProgress }) {
  const fillPct = Math.round((category.progress ?? 0) * 100);
  const isDone = category.state === 'up-to-date' || category.state === 'ready';
  const isFailed = category.state === 'failed';
  const isActive = category.state === 'downloading' || category.state === 'applying';

  // Color encodes state — same red-on-dark palette as the orbit so the row
  // reads as part of the same family. Up-to-date rows fade into the bg.
  const fillColor = isFailed
    ? 'rgba(220, 110, 110, 0.55)'
    : isDone
    ? 'rgba(160, 220, 170, 0.28)'
    : 'rgba(196, 68, 68, 0.55)';
  const labelColor = isDone
    ? 'rgba(255, 255, 255, 0.42)'
    : isFailed
    ? 'rgba(220, 170, 160, 0.78)'
    : 'rgba(255, 255, 255, 0.78)';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr 60px',
        alignItems: 'center',
        gap: 12,
        fontSize: 11,
        letterSpacing: '0.02em',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ color: labelColor }}>{CATEGORY_LABEL[category.id]}</div>
      <div
        style={{
          position: 'relative',
          height: 4,
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.06)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${fillPct}%`,
            background: fillColor,
            transition: 'width 400ms cubic-bezier(0.22, 1, 0.36, 1), background 200ms ease',
            // Indeterminate states (progress=null during 'applying') get a
            // subtle shimmer rather than a static fill.
            opacity: isActive && category.progress === null ? 0.55 : 1,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
          fontSize: 10,
          letterSpacing: '0.06em',
          color: labelColor,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {isDone ? category.to.split('.').slice(-1)[0] || category.to : `${fillPct}%`}
      </div>
    </div>
  );
}
