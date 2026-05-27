// Top-left greeting — time + warm welcome + cycling quote. Sits over
// the pixel stream with text-shadow for legibility against bright
// frames. No chrome surface; the type carries everything.
//
// Quotes rotate every ~30s with a soft cross-fade. The greeting word
// ("Good Morning / Afternoon / Evening") tracks the wall clock.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const QUOTES: { text: string; author: string }[] = [
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
  { text: 'AI is a powerful tool to help humanity understand the world.', author: 'Demis Hassabis' },
  { text: 'Any sufficiently advanced technology is indistinguishable from magic.', author: 'Arthur C. Clarke' },
  { text: 'We are at the beginning of the AI industrial revolution.', author: 'Jensen Huang' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'The future is already here, it’s just not evenly distributed.', author: 'William Gibson' },
];

interface GreetingProps {
  /** Display name to greet ("Aryan"). Defaults to a generic warm welcome
   *  if absent so the surface still reads correctly. */
  userName?: string;
}

export function Greeting({ userName = 'friend' }: GreetingProps) {
  const reduce = useReducedMotion() ?? false;
  const [now, setNow] = useState(() => new Date());
  const [quoteIdx, setQuoteIdx] = useState(() =>
    Math.floor(Math.random() * QUOTES.length),
  );

  // Tick the time every second. Re-renders every second now (we show
  // seconds in the time string), but the cost is just one cheap
  // setState — no DOM thrash since the parent layout is stable.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Rotate quotes every 30s. Pause if the user prefers reduced motion.
  useEffect(() => {
    if (reduce) return undefined;
    const id = window.setInterval(() => {
      setQuoteIdx(i => (i + 1) % QUOTES.length);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [reduce]);

  const greetingWord = greetingFor(now);
  const timeStr = formatClock(now);
  const quote = QUOTES[quoteIdx];

  const dateStr = formatDate(now);

  // Per-child stagger. The wrapper no longer fades as one block — the
  // time/date row settles in first, the headline second, the quote
  // third. Reads as a gentle "the room turns on" beat instead of
  // everything appearing at once.
  const baseDelay = reduce ? 0 : 0.15;
  const stagger = reduce ? 0 : 0.18;

  return (
    <div
      style={{
        position: 'absolute',
        top: 72,
        left: 22,
        right: 22,
        maxWidth: 520,
        zIndex: 5,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Time + date row. Time is the lead; date sits beside it in a
          quieter tone with a hairline dot separator. Tabular numerics
          on both so the row never reflows tick to tick. The whole
          row uses warm-ash rather than a heavier label color so it
          reads as ambient telemetry, not a UI element fighting the
          headline for attention. */}
      <motion.div
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: baseDelay, ease: EASE_OUT_EXPO }}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 10,
          color: 'var(--text-secondary)',
          textShadow: 'var(--text-shadow-floating)',
        }}
      >
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: '0.01em',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-primary)',
          opacity: 0.92,
        }}>
          {timeStr}
        </span>
        <span aria-hidden style={{
          width: 3, height: 3, borderRadius: 1.5,
          background: 'currentColor', opacity: 0.4,
          alignSelf: 'center',
        }} />
        <span style={{
          fontSize: 11.5,
          fontWeight: 500,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          opacity: 0.78,
        }}>
          {dateStr}
        </span>
      </motion.div>

      <motion.h1
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.65,
          delay: baseDelay + stagger,
          ease: EASE_OUT_EXPO,
        }}
        style={{
          fontSize: 34,
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.028em',
          lineHeight: 1.04,
          margin: 0,
          textShadow: 'var(--text-shadow-display)',
        }}
      >
        Good {greetingWord},{' '}
        <span style={{ fontWeight: 500, fontStyle: 'italic' }}>
          {userName}
        </span>
        {/* Tiny mood-tinted period. Picks up the wardrobe lighting
            color via --mood-accent so the only saturated speck on the
            greeting subtly matches the light the character sits in. */}
        <span aria-hidden style={{
          color: 'var(--mood-accent)',
          fontWeight: 600,
          marginLeft: 1,
          transition: 'color var(--duration-base) var(--ease-out-quart)',
        }}>.</span>
      </motion.h1>

      <motion.div
        initial={reduce ? { opacity: 1 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: 0.55,
          delay: baseDelay + stagger * 2,
          ease: EASE_OUT_EXPO,
        }}
        style={{ marginTop: 18 }}
      >
        <AnimatePresence mode="wait">
          <motion.p
            key={quoteIdx}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3 }}
            animate={{ opacity: 0.92, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
            style={{
              fontSize: 14.5,
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              letterSpacing: '-0.005em',
              margin: 0,
              textShadow: 'var(--text-shadow-floating)',
              maxWidth: 360,
            }}
          >
            “{quote.text}”
            <span style={{
              display: 'block',
              marginTop: 6,
              fontStyle: 'normal',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-ghost)',
              opacity: 0.85,
            }}>
              {quote.author}
            </span>
          </motion.p>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function formatDate(d: Date): string {
  // Short weekday + day-of-month without year. "Mon · May 26" reads
  // like a journal entry above the rotating thought; "Monday, May 26,
  // 2026" would overwhelm. No leading zero on the day.
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5)  return 'Evening';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

function formatClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return `${h12}:${mm}:${ss} ${ampm}`;
}
