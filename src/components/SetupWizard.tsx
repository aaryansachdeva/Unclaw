// SetupWizard — first-run install UI for the packaged Mac build.
//
// Visual sibling to SoulBootScreen: same void background, same lobster
// monument, same hairline orbit, same ambient telemetry feed. The only
// thing that changes is what's beneath the orbit (stage headline +
// detail in place of the clock) and how full the orbit is (it fills
// progressively across the four stages instead of always sweeping a
// fixed 10% arc).
//
// Flow:
//   1. Mount → hydrate from electronAPI.setup.getStatus().
//   2. If already complete → onComplete() immediately (covers Cmd-R
//      after a successful first run).
//   3. Otherwise → electronAPI.setup.start() kicks the coordinator,
//      and we subscribe to setup:stage + setup:log for live updates.
//   4. When stage.id === 'complete' → onComplete().
//   5. When stage.id === 'failed' → render the error inline (no retry
//      button yet — relaunch the app to retry; the pipeline is
//      idempotent so completed stages are skipped).

import { useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from '../assets/logo_lg.png';

export interface SetupWizardProps {
  onComplete: () => void;
}

type StageId =
  | 'preflight' | 'runtime' | 'unreal' | 'models' | 'complete' | 'failed';

interface StageState {
  id: StageId;
  progress: number | null;
  headline: string;
  detail?: string;
}

interface LogLine {
  stream: 'stdout' | 'stderr' | 'meta';
  line: string;
}

const MAX_LINES = 200;

// Each stage owns 25% of the overall progress arc. Indeterminate stages
// (uv pip install can run for 2 minutes with no measurable progress)
// surface as a half-filled chunk so the arc keeps growing even when we
// don't have byte-accurate signal.
const STAGE_ORDER: StageId[] = ['preflight', 'runtime', 'unreal', 'models'];

function computeOverallProgress(stage: StageState): number {
  if (stage.id === 'complete') return 1;
  if (stage.id === 'failed') return 0;
  const idx = STAGE_ORDER.indexOf(stage.id);
  if (idx === -1) return 0;
  const base = idx * 0.25;
  const within = stage.progress ?? 0.5;
  return Math.min(1, base + 0.25 * within);
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [stage, setStage] = useState<StageState>({
    id: 'preflight',
    progress: 0,
    headline: 'Preparing first-run setup…',
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  // Hydrate + subscribe + (maybe) kick the pipeline.
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.setup;
    if (!api) {
      // Dev / browser renderer — nothing to set up.
      onComplete();
      return;
    }

    api.getStatus().then((snap) => {
      if (cancelled || !snap) return;
      setStage(snap.stage);
      setLogs(snap.recentLogs.slice(-MAX_LINES));
      if (snap.isComplete) {
        onComplete();
        return;
      }
      // Only start the pipeline once per mount; ipcMain.handle is
      // idempotent on the coordinator side but we also avoid the
      // double round-trip.
      if (!startedRef.current) {
        startedRef.current = true;
        api.start().catch(() => { /* terminal state surfaces via setup:stage */ });
      }
    });

    const offLog = api.onLog((data) => {
      setLogs((prev) => {
        const next = [...prev, data];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });
    const offStage = api.onStage((s) => {
      setStage(s);
      if (s.id === 'complete') onComplete();
    });

    return () => {
      cancelled = true;
      offLog?.();
      offStage?.();
    };
  }, [onComplete]);

  // Clock — gives the user a "still working" signal even when the
  // pipeline is in a long indeterminate stretch (uv pip install).
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 250);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll the ambient feed.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [logs]);

  // Retry after a failed setup. The coordinator pipeline is idempotent
  // (completed stages skip via their on-disk markers), so this re-runs and
  // resumes rather than starting from scratch. Previously the only recovery
  // was to quit and relaunch the app.
  const handleRetrySetup = () => {
    const api = window.electronAPI?.setup;
    if (!api) return;
    startedRef.current = true;
    setStage({ id: 'preflight', progress: 0, headline: 'Retrying setup…' });
    api.start().catch(() => { /* terminal state surfaces via setup:stage */ });
  };
  const handleOpenLogs = () => { void window.electronAPI?.soul?.openLogs?.(); };

  const overall = useMemo(() => computeOverallProgress(stage), [stage]);

  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, '0');
  const timeStr = mm > 0 ? `${mm}:${ss}` : `${ss}″`;

  // Orbit geometry — matches SoulBootScreen so the transition between
  // the two feels continuous. The arc length is variable here (grows
  // with overall progress) where SoulBootScreen's is fixed at 10%.
  const ORBIT_DIAMETER = 286;
  const ORBIT_R = ORBIT_DIAMETER / 2;
  const ORBIT_CIRC = 2 * Math.PI * ORBIT_R;
  // Floor at 8% so the arc is always visible — pure 0 reads as
  // "broken" rather than "preparing".
  const arcFraction = stage.id === 'failed' ? 0.08 : Math.max(0.08, overall);

  const isFailed = stage.id === 'failed';

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
      {/* Warm vignette behind the monument. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: '32%',
          left: '50%',
          width: 880,
          height: 880,
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

      {/* Monument zone — logo + progress orbit + stage copy. */}
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
          {/* Progress orbit — slow rotation keeps it alive even when
              the arc length is static between progress events. */}
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
            {/* The variable-length arc. Same math as SoulBootScreen —
                arc END lands at position 0 (3 o'clock); length grows
                with overall progress. */}
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
            {/* Leading dot at the arc end. */}
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

        {/* Stage headline + detail. Replaces the wordmark+clock zone
            of SoulBootScreen with the wizard's running narrative.
            Single line each, low contrast — matches the "whisper, don't
            shout" spec. */}
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
            {stage.headline}
          </div>
          {stage.detail && (
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
              {stage.detail}
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

          {/* Failed-setup recovery. The pipeline is idempotent so Retry
              resumes; Open logs surfaces the setup log for support. */}
          {isFailed && (
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                marginTop: 16,
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties}
            >
              <button
                type="button"
                onClick={handleRetrySetup}
                style={{
                  padding: '9px 24px',
                  borderRadius: 999,
                  border: '1px solid rgba(196, 68, 68, 0.5)',
                  background: 'var(--accent-dim, rgba(196,68,68,0.16))',
                  color: 'rgba(255,255,255,0.95)',
                  fontSize: 13,
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
                  padding: '9px 18px',
                  borderRadius: 999,
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: 12.5,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                Open logs
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 24 }} />

      {/* Ambient setup feed — same treatment as SoulBootScreen's. */}
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
