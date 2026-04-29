// Compact voice-state surface: a 5-bar VU meter inside a glass chip.
// No labels, no icons — the bars themselves carry every state cue:
//
//   listening (idle):   bars at minimum, ghost color
//   listening (speech): bars react to vadLevel, --live (green)
//   transcribing:       bars freeze into a phase-offset wave, --accent
//   error:              red-tinted glass chip with the error text
//
// The chip's footprint never changes — bars use `transform: scaleY`
// during transcription (GPU-accelerated, no layout thrash) and the
// container width is fixed by the bars' total width + padding.

import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';

interface VoiceIndicatorProps {
  isListening: boolean;
  isUserSpeaking: boolean;
  isTranscribing: boolean;
  vadLevel: number;                             // smoothed [0, 1]
  silence: { requiredMs: number; elapsedMs: number };
  error?: string | null;
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const NUM_BARS = 5;
const BAR_GAP = 3;
const BAR_W = 2.5;
const BAR_MIN = 3;
const BAR_MAX = 16;
// Match AgentSwitcher's inner content height (its chevron buttons are
// 24×24, so the chip's total height is 24 + 2 × 8 padding = 40 px).
// Our bars are shorter than that — render them inside a 24px-tall
// box so the two chips line up perfectly in the row.
const BAR_BOX_HEIGHT = 24;
// How much each off-center bar lags the central one when reacting to
// vadLevel — gives the meter an outward "ripple" feel instead of all
// 5 bars moving in lockstep.
const BAR_FALLOFF = 0.18;

const LIVE_GLOW = 'color-mix(in srgb, var(--live) 45%, transparent)';
const ACCENT_GLOW = 'color-mix(in srgb, var(--accent) 45%, transparent)';

// During transcription the wave duration + per-bar delays are picked
// so the wave reads left→center→right and back. Symmetric delays make
// the center bar lead and the edges lag.
const WAVE_DURATION_MS = 900;
const WAVE_DELAY_BY_BAR = [0, 90, 180, 90, 0];

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

  return (
    <motion.div
      key="voice-indicator"
      role="status"
      aria-live="polite"
      aria-label={isTranscribing ? 'Transcribing' : isUserSpeaking ? 'Listening' : 'Ready'}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.5, delay: 0.15, ease: EASE_OUT_EXPO }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '8px 14px',
        borderRadius: '14px',
        background: hot ? 'var(--glass-bg-hover)' : 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: `1px solid ${hot ? 'var(--glass-border-focus)' : 'var(--glass-border)'}`,
        transition:
          'background 250ms var(--ease-out-quart), border-color 250ms var(--ease-out-quart)',
      }}
    >
      <Bars
        vadLevel={vadLevel}
        hot={hot}
        isTranscribing={isTranscribing}
        activeColor={activeColor}
        activeGlow={activeGlow}
      />
    </motion.div>
  );
}

// ---------- subviews ---------------------------------------------------

function Bars({
  vadLevel,
  hot,
  isTranscribing,
  activeColor,
  activeGlow,
}: {
  vadLevel: number;
  hot: boolean;
  isTranscribing: boolean;
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
        height: `${BAR_BOX_HEIGHT}px`,
        width: `${totalW}px`,
      }}
    >
      {Array.from({ length: NUM_BARS }).map((_, i) => {
        const distance = Math.abs(i - center) / center;
        const local = Math.max(0, Math.min(1, vadLevel - distance * BAR_FALLOFF));
        const isStrong = hot && local > 0.4;

        // During transcribe: bar is rendered at full BAR_MAX height and
        // a CSS keyframe scales it via transform. No height-driven
        // reflow, no JS-driven RAF. During listen/speak: bar height
        // tracks the smoothed VAD probability and CSS transitions ease
        // it toward the target each frame.
        const transcribeHeight = BAR_MAX;
        const liveHeight = BAR_MIN + local * (BAR_MAX - BAR_MIN);

        return (
          <div
            key={i}
            style={{
              width: `${BAR_W}px`,
              height: `${isTranscribing ? transcribeHeight : liveHeight}px`,
              borderRadius: '1.5px',
              background: hot ? activeColor : 'var(--text-ghost)',
              opacity: hot ? 0.6 + local * 0.4 : 0.55,
              transformOrigin: 'center',
              transform: isTranscribing ? undefined : 'scaleY(1)',
              animation: isTranscribing
                ? `voice-bar-wave ${WAVE_DURATION_MS}ms ease-in-out ${WAVE_DELAY_BY_BAR[i]}ms infinite`
                : undefined,
              transition: isTranscribing
                ? 'background 250ms var(--ease-out-quart), opacity 250ms var(--ease-out-quart)'
                : 'height 80ms var(--ease-out-quart), background 250ms var(--ease-out-quart), opacity 250ms var(--ease-out-quart)',
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
