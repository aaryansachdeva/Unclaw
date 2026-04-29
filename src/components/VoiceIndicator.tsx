// Compact voice-state surface that lives next to AgentSwitcher in the
// bottom row. Geometry mirrors AgentSwitcher (radius 14px, padding
// 8px 12px, glass background) so the row reads as a single design
// family. The chip's footprint is intentionally fixed once mounted —
// only color, icon, and label *content* change while voice mode is
// active. No internal AnimatePresence, no countdown rail, no `ms`
// readout, no two-row layout. Bars + icon + fixed-width label only.
//
// State language:
//   ready        →  mic icon (ghost), "ready" label
//   listening    →  mic in --live, bars react to vadLevel, "listening"
//   thinking     →  mic ghost, bars idle, "thinking" label
//   transcribing →  spinner in --accent, bars freeze, "transcribing"
//   error        →  danger-tinted glass chip, role="alert"
//
// All colors flow through tokens; live/accent glows are derived via
// color-mix so a token swap propagates everywhere automatically.

import { motion } from 'framer-motion';
import { Mic, Loader2, AlertCircle } from 'lucide-react';

interface VoiceIndicatorProps {
  isListening: boolean;
  isUserSpeaking: boolean;
  isTranscribing: boolean;
  vadLevel: number;                             // smoothed [0, 1]
  silence: { requiredMs: number; elapsedMs: number };
  error?: string | null;
}

// Project easing tokens, expressed as bezier tuples because Framer's
// `ease` prop does not accept CSS-variable strings (it silently drops
// them and falls back to default easing).
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const NUM_BARS = 5;
const BAR_GAP = 3;
const BAR_W = 2.5;
const BAR_MIN = 3;
const BAR_MAX = 16;
// How much each off-center bar lags the central one, creating the
// outward "ripple" feel rather than 5 bars moving in lockstep.
const BAR_FALLOFF = 0.18;

const LIVE_GLOW = 'color-mix(in srgb, var(--live) 45%, transparent)';
const ACCENT_GLOW = 'color-mix(in srgb, var(--accent) 45%, transparent)';

// Width of the label slot. "TRANSCRIBING" at 10px / 600 / 0.10em
// uppercase measures ~88px; round up to leave a hair of breathing
// room and lock the chip's total width across all four labels.
const LABEL_SLOT_WIDTH = 92;

export function VoiceIndicator({
  isListening,
  isUserSpeaking,
  isTranscribing,
  vadLevel,
  silence: _silence, // eslint-disable-line @typescript-eslint/no-unused-vars
  error,
}: VoiceIndicatorProps) {
  if (error) return <ErrorChip error={error} />;
  if (!isListening && !isTranscribing) return null;

  const hot = isUserSpeaking || isTranscribing;
  const activeColor = isTranscribing ? 'var(--accent)' : 'var(--live)';
  const activeGlow = isTranscribing ? ACCENT_GLOW : LIVE_GLOW;

  // Four canonical states map to four canonical labels. Order matters:
  // transcribing wins over speaking, speaking wins over listening-idle.
  // "thinking" is reserved for the brief window where we're still in
  // listening mode but neither speaking nor transcribing — i.e. the
  // app is waiting on the user.
  const label = isTranscribing
    ? 'transcribing'
    : isUserSpeaking
      ? 'listening'
      : isListening
        ? 'ready'
        : 'thinking';

  return (
    <motion.div
      key="voice-indicator"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.5, delay: 0.15, ease: EASE_OUT_EXPO }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '14px',
        background: hot ? 'var(--glass-bg-hover)' : 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: `1px solid ${hot ? 'var(--glass-border-focus)' : 'var(--glass-border)'}`,
        transition:
          'background 250ms var(--ease-out-quart), border-color 250ms var(--ease-out-quart)',
      }}
    >
      <StatusIcon
        isUserSpeaking={isUserSpeaking}
        isTranscribing={isTranscribing}
        activeColor={activeColor}
      />

      <Bars
        vadLevel={vadLevel}
        hot={hot}
        activeColor={activeColor}
        activeGlow={activeGlow}
      />

      {/* Fixed-width label slot. Width is locked to the longest
          possible string ("transcribing"), text is left-aligned so
          shorter labels don't recenter on every change. This is the
          load-bearing fix for the resize thrash. */}
      <span
        style={{
          minWidth: `${LABEL_SLOT_WIDTH}px`,
          textAlign: 'left',
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: hot ? activeColor : 'var(--text-secondary)',
          transition: 'color 250ms var(--ease-out-quart)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

// ---------- subviews ---------------------------------------------------

function StatusIcon({
  isUserSpeaking,
  isTranscribing,
  activeColor,
}: {
  isUserSpeaking: boolean;
  isTranscribing: boolean;
  activeColor: string;
}) {
  // Drives the existing `spin` keyframes in styles.css instead of
  // running a Framer rotation loop — gets `prefers-reduced-motion`
  // suppression for free via the global media query.
  if (isTranscribing) {
    return (
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          color: activeColor,
          animation: 'spin 0.9s linear infinite',
        }}
      >
        <Loader2 size={11} strokeWidth={2.4} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        color: isUserSpeaking ? activeColor : 'var(--text-ghost)',
        transition: 'color 250ms var(--ease-out-quart)',
      }}
    >
      <Mic size={11} strokeWidth={2} />
    </span>
  );
}

function Bars({
  vadLevel,
  hot,
  activeColor,
  activeGlow,
}: {
  vadLevel: number;
  hot: boolean;
  activeColor: string;
  activeGlow: string;
}) {
  const totalW = NUM_BARS * BAR_W + (NUM_BARS - 1) * BAR_GAP;
  const center = (NUM_BARS - 1) / 2;

  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: `${BAR_GAP}px`,
        height: `${BAR_MAX}px`,
        width: `${totalW}px`,
      }}
    >
      {Array.from({ length: NUM_BARS }).map((_, i) => {
        const distance = Math.abs(i - center) / center;
        const local = Math.max(0, Math.min(1, vadLevel - distance * BAR_FALLOFF));
        const h = BAR_MIN + local * (BAR_MAX - BAR_MIN);
        const isStrong = hot && local > 0.4;
        return (
          <div
            key={i}
            style={{
              width: `${BAR_W}px`,
              height: `${h}px`,
              borderRadius: '1.5px',
              background: hot ? activeColor : 'var(--text-ghost)',
              opacity: hot ? 0.6 + local * 0.4 : 0.55,
              transition:
                'height 80ms var(--ease-out-quart), background 250ms var(--ease-out-quart), opacity 250ms var(--ease-out-quart)',
              boxShadow: isStrong ? `0 0 4px ${activeGlow}` : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

function ErrorChip({ error }: { error: string }) {
  return (
    <motion.div
      role="alert"
      title={error}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: EASE_OUT_EXPO }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '12px',
        background: 'color-mix(in srgb, var(--danger) 10%, var(--glass-bg))',
        border:
          '1px solid color-mix(in srgb, var(--danger) 28%, var(--glass-border))',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        color: 'var(--danger)',
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        maxWidth: '320px',
      }}
    >
      <AlertCircle size={12} strokeWidth={2.2} aria-hidden />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {error}
      </span>
    </motion.div>
  );
}
