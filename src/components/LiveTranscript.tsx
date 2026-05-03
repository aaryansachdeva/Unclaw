// Streaming-transcription display. Replaces the InputBar textarea
// while voice is active so we can render committed words solid and
// tentative text dim/italic — something a textarea can't do because
// its content is uniform-styled.
//
// Two responsibilities, one component:
//   * TranscriptText (memoized on committed/tentative) — plain text
//     render, no animations on the text itself. Earlier versions used
//     per-word AnimatePresence which caused noticeable React /
//     reconciliation cost on long utterances; ripped out here.
//   * AmplitudeCursor — a fat vertical "terminal cursor" that bobs
//     with the live mic RMS so the user has constant feedback that
//     they're being heard. Re-renders on every level update; isolated
//     from the text so the text doesn't churn.

import { memo } from 'react';

interface LiveTranscriptProps {
  /** Words the LocalAgreement-2 algorithm has confirmed. */
  committed: string;
  /** Latest model output past the agreement point. */
  tentative: string;
  /** Mic RMS in [0, 1] — drives the trailing cursor's height pulse.
   *  Updated at the worklet rate (~31 Hz). */
  level: number;
}

export function LiveTranscript({ committed, tentative, level }: LiveTranscriptProps) {
  return (
    <div
      style={{
        position: 'relative',
        minHeight: 22,
        maxHeight: 260,
        overflowY: 'auto',
        padding: '2px 0',
        fontFamily: 'inherit',
        fontSize: 14.5,
        lineHeight: 1.5,
        color: 'var(--text-primary)',
        letterSpacing: '-0.005em',
        // Subtle accent left-edge cue so the user reads the surface
        // as "voice is feeding this", not "I typed this".
        borderLeft: '2px solid var(--accent)',
        paddingLeft: 12,
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: 0,
      }}
    >
      <TranscriptText committed={committed} tentative={tentative} />
      <AmplitudeCursor level={level} />
    </div>
  );
}

/** Plain-text render of committed + tentative. Memoized so it only
 *  re-renders when the actual text changes (i.e. on a partial /
 *  final from the server, not on every audio level tick). */
const TranscriptText = memo(function TranscriptText({
  committed,
  tentative,
}: {
  committed: string;
  tentative: string;
}) {
  const c = committed.trim();
  const t = tentative.trim();
  return (
    <span style={{ display: 'inline' }}>
      {c && <span>{c}</span>}
      {c && t && <span>&nbsp;</span>}
      {t && (
        <span
          style={{
            fontStyle: 'italic',
            color: 'var(--text-primary)',
            opacity: 0.55,
          }}
        >
          {t}
        </span>
      )}
    </span>
  );
});

/** Amplitude-driven cursor. Sits at the trailing edge of the
 *  transcript and grows/shrinks with mic RMS. Replaces the old
 *  "Listening..." mic-pill — the cursor itself signals
 *  "we're listening" without copy. Always present while voice is
 *  active, including before any words have been committed. */
const AmplitudeCursor = memo(function AmplitudeCursor({ level }: { level: number }) {
  // Map RMS to a visible height range. Level is typically 0-0.3 for
  // speech; we boost it so the cursor reads as obviously "alive"
  // and clamp to a max so loud syllables don't spike it absurdly.
  const boosted = Math.min(1, Math.max(0, level * 3.5));
  // Idle height ~14px (visible even when silent) up to ~30px when loud.
  const height = 14 + boosted * 16;
  // Idle: pulse slowly via CSS keyframe. Speaking: punchy via JS-driven
  // height (the keyframe still runs but the height transition wins
  // visually).
  const isSilent = level < 0.012;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 6,
        height: 22, // line-box height so flex-baseline doesn't shift
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height,
          borderRadius: 1.5,
          background: 'var(--accent)',
          boxShadow: isSilent
            ? '0 0 6px rgba(196, 68, 68, 0.30)'
            : '0 0 10px rgba(196, 68, 68, 0.55)',
          transition: 'height 80ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          animation: isSilent ? 'amp-cursor-idle 1.2s ease-in-out infinite' : 'none',
        }}
      />
      <style>{`
        @keyframes amp-cursor-idle {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1.00; }
        }
      `}</style>
    </span>
  );
});
