// Visual feedback for the voice agent. Three layered surfaces:
//
//   1. State icon + label  — "ready" / "listening" / "thinking…" / "transcribing"
//   2. Live VAD bars       — five vertical bars whose heights track the
//                            smoothed speech probability; subtle when idle,
//                            bright + glowing while the user speaks.
//   3. Silence countdown   — a thin progress bar showing elapsed/required
//                            silence ms. Width animates smoothly so the
//                            user can SEE how much pause they have left.
//                            When the dynamic threshold jumps (e.g. the
//                            partial transcript ends in "uh"), the bar
//                            visibly decompresses, telegraphing "you've
//                            got more time."
//
// The silence countdown is the secret-sauce element — almost no
// production voice agent shows it, and it eliminates the "did it cut me
// off?" anxiety because the timeout is now visible.

import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Loader2, Sparkles, AlertCircle } from 'lucide-react';

interface VoiceIndicatorProps {
  isListening: boolean;
  isUserSpeaking: boolean;
  isTranscribing: boolean;
  vadLevel: number;                 // smoothed [0, 1]
  silence: { requiredMs: number; elapsedMs: number };
  error?: string | null;
}

const NUM_BARS = 5;
const BAR_GAP = 3;
const BAR_W = 2.5;
const BAR_MIN = 3;
const BAR_MAX = 16;

const C_TEXT_DIM = 'rgba(255,255,255,0.45)';
const C_TEXT     = 'rgba(255,255,255,0.85)';
const C_TEXT_HOT = 'rgba(170,255,200,0.95)';   // mint when active
const C_BG       = 'rgba(255,255,255,0.04)';
const C_BG_HOT   = 'rgba(170,255,200,0.06)';
const C_BORDER   = 'rgba(255,255,255,0.10)';
const C_BORDER_HOT = 'rgba(170,255,200,0.30)';
const C_BAR_IDLE = 'rgba(255,255,255,0.30)';
const C_BAR_HOT  = 'rgba(170,255,200,0.90)';
const C_RAIL     = 'rgba(255,255,255,0.08)';
const C_FILL_A   = 'rgba(170,255,200,0.95)';   // mint
const C_FILL_B   = 'rgba(180,200,255,0.85)';   // lavender
const C_ERR_FILL = 'rgba(255,160,160,0.95)';
const C_ERR_BG   = 'rgba(220, 80, 80, 0.10)';
const C_ERR_BD   = 'rgba(220, 80, 80, 0.32)';

export function VoiceIndicator({
  isListening,
  isUserSpeaking,
  isTranscribing,
  vadLevel,
  silence,
  error,
}: VoiceIndicatorProps) {
  // Error chip wins — show it whenever we have one, even if not listening.
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        title={error}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          padding: '5px 11px',
          borderRadius: '999px',
          background: C_ERR_BG,
          border: `1px solid ${C_ERR_BD}`,
          color: C_ERR_FILL,
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          maxWidth: '320px',
        }}
      >
        <AlertCircle size={11} strokeWidth={2.2} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {error}
        </span>
      </motion.div>
    );
  }

  if (!isListening && !isTranscribing) return null;

  const inTrailing = silence.requiredMs > 0;
  const remainingMs = inTrailing ? Math.max(0, silence.requiredMs - silence.elapsedMs) : 0;
  const countdownPct = inTrailing
    ? Math.min(1, Math.max(0, silence.elapsedMs / silence.requiredMs))
    : 0;
  const hot = isUserSpeaking || isTranscribing;

  // Status label drives the whole tone of the chip.
  let label = 'ready';
  if (isTranscribing) label = 'transcribing';
  else if (isUserSpeaking) label = 'listening';
  else if (inTrailing) label = 'thinking';

  return (
    <motion.div
      key="voice-indicator"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '6px',
        padding: '6px 12px 7px',
        borderRadius: '14px',
        background: hot ? C_BG_HOT : C_BG,
        border: `1px solid ${hot ? C_BORDER_HOT : C_BORDER}`,
        backdropFilter: 'blur(8px) saturate(1.1)',
        WebkitBackdropFilter: 'blur(8px) saturate(1.1)',
        boxShadow: hot ? '0 0 16px rgba(170,255,200,0.10)' : 'none',
        transition: 'background 200ms ease, border-color 200ms ease, box-shadow 240ms ease',
        minWidth: '180px',
      }}
    >
      {/* row 1: icon · bars · label · ms */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <StatusIcon
          isUserSpeaking={isUserSpeaking}
          isTranscribing={isTranscribing}
          inTrailing={inTrailing}
        />

        <Bars vadLevel={vadLevel} hot={hot} />

        <span style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
          color: hot ? C_TEXT_HOT : C_TEXT_DIM,
          transition: 'color 180ms ease',
          fontVariantCaps: 'all-small-caps',
        }}>
          {label}
        </span>

        {/* spacer pushes ms to the right */}
        <span style={{ flex: 1 }} />

        <AnimatePresence>
          {inTrailing && (
            <motion.span
              key="ms"
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 0.7, x: 0 }}
              exit={{ opacity: 0, x: 4 }}
              transition={{ duration: 0.14 }}
              style={{
                fontSize: '10px',
                fontVariantNumeric: 'tabular-nums',
                color: C_TEXT,
                fontWeight: 500,
                letterSpacing: '0.02em',
              }}
            >
              {remainingMs.toFixed(0)}<span style={{ opacity: 0.5, marginLeft: '2px' }}>ms</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* row 2: countdown rail (always present so layout doesn't jump,
          opacity hides it until trailing) */}
      <div
        aria-hidden
        style={{
          height: '2px',
          width: '100%',
          borderRadius: '1px',
          background: C_RAIL,
          overflow: 'hidden',
          opacity: inTrailing ? 1 : 0,
          transition: 'opacity 160ms ease',
        }}
      >
        <div
          style={{
            width: `${countdownPct * 100}%`,
            height: '100%',
            background: `linear-gradient(to right, ${C_FILL_A}, ${C_FILL_B})`,
            transition: 'width 60ms linear',
            boxShadow: '0 0 6px rgba(170,255,200,0.4)',
          }}
        />
      </div>
    </motion.div>
  );
}

// ---------- subviews ---------------------------------------------------

function StatusIcon({
  isUserSpeaking, isTranscribing, inTrailing,
}: { isUserSpeaking: boolean; isTranscribing: boolean; inTrailing: boolean }) {
  if (isTranscribing) {
    return (
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        style={{ display: 'inline-flex', color: C_TEXT_HOT }}
      >
        <Loader2 size={11} strokeWidth={2.4} />
      </motion.span>
    );
  }
  if (inTrailing) {
    return (
      <motion.span
        animate={{ opacity: [0.45, 1, 0.45] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        style={{ display: 'inline-flex', color: C_TEXT_HOT }}
      >
        <Sparkles size={11} strokeWidth={2} />
      </motion.span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex',
      color: isUserSpeaking ? C_TEXT_HOT : C_TEXT_DIM,
      transition: 'color 180ms ease',
    }}>
      <Mic size={11} strokeWidth={2} />
    </span>
  );
}

function Bars({ vadLevel, hot }: { vadLevel: number; hot: boolean }) {
  const totalW = NUM_BARS * BAR_W + (NUM_BARS - 1) * BAR_GAP;
  return (
    <div
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
        // Center bar is loudest; outer bars need higher level to peak.
        const center = (NUM_BARS - 1) / 2;
        const distance = Math.abs(i - center) / center;        // 0..1
        const local = Math.max(0, Math.min(1, vadLevel - distance * 0.18));
        const h = BAR_MIN + local * (BAR_MAX - BAR_MIN);
        return (
          <div
            key={i}
            style={{
              width: `${BAR_W}px`,
              height: `${h}px`,
              borderRadius: '1.5px',
              background: hot
                ? `linear-gradient(to top, ${C_BAR_HOT}, ${C_FILL_B})`
                : C_BAR_IDLE,
              transition: 'height 80ms cubic-bezier(0.4, 0, 0.2, 1), background 200ms ease',
              boxShadow: hot && local > 0.4
                ? '0 0 4px rgba(170,255,200,0.45)' : 'none',
            }}
          />
        );
      })}
    </div>
  );
}
