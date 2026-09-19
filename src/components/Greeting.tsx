// Top-left greeting — time + warm welcome + cycling quote. Sits over the
// pixel stream with text-shadow for legibility against bright frames. No
// chrome surface; the type carries everything. Fixed at the top-left of
// the stage; the scrollable glance column (components/glance) starts under
// it, which is why this reports its height through onHeight.
//
// Quotes rotate every ~30s with a soft cross-fade. The greeting word
// ("Good Morning / Afternoon / Evening") tracks the wall clock.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useGlanceType } from '../hooks/useGlanceScale';

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
  /** Rendered height (px), so the glance column can start right under it. */
  onHeight?: (h: number) => void;
}

export const GREETING_TOP = 72;

export function Greeting({ userName = 'friend', onHeight }: GreetingProps) {
  const reduce = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  // On a bigger window the headline grows the most, the clock and the quote
  // a little, the attribution barely (hooks/useGlanceScale). The anchor stays
  // put, and the reported height is the real one, so the column clears it.
  const type = useGlanceType();
  const [now, setNow] = useState(() => new Date());

  // The clock shows hours and minutes (a ticking seconds counter at the
  // top of a presence is noise, 2026-09-15). Poll each second but only
  // commit a new Date when the minute turns, so nothing re-renders in
  // between.
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setNow((prev) =>
        prev.getMinutes() === d.getMinutes() && prev.getHours() === d.getHours() ? prev : d,
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeight) return undefined;
    const report = () => onHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  const [quoteIdx, setQuoteIdx] = useState(() =>
    Math.floor(Math.random() * QUOTES.length),
  );

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

  // Per-child stagger. The time/date row settles in first, the headline
  // second, the quote third. Reads as a gentle "the room turns on" beat
  // instead of everything appearing at once.
  const baseDelay = reduce ? 0 : 0.15;
  const stagger = reduce ? 0 : 0.18;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        top: GREETING_TOP,
        left: 22,
        right: 22,
        maxWidth: 520 * type.display,
        zIndex: 5,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Time + date row. Time is the lead; date sits beside it in a
          quieter tone with a hairline dot separator. Tabular numerics
          on both so the row never reflows tick to tick. */}
      <motion.div
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: baseDelay, ease: EASE_OUT_EXPO }}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 10 * type.text,
          marginBottom: 10 * type.text,
          color: 'var(--text-secondary)',
          textShadow: 'var(--text-shadow-floating)',
        }}
      >
        <span style={{
          fontSize: 13 * type.text,
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
          fontSize: 11.5 * type.label,
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
          fontSize: 34 * type.display,
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
        // Reserve two quote lines plus the author line so a longer quote
        // never changes this block's height: the glance column starts
        // right under the greeting and would otherwise shift with every
        // rotation.
        style={{ marginTop: 18 * type.text, minHeight: 66 * type.text }}
      >
        <AnimatePresence mode="wait">
          <motion.p
            key={quoteIdx}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3 }}
            animate={{ opacity: 0.92, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
            style={{
              fontSize: 14.5 * type.text,
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              letterSpacing: '-0.005em',
              margin: 0,
              textShadow: 'var(--text-shadow-floating)',
              maxWidth: 360 * type.text,
            }}
          >
            “{quote.text}”
            <span style={{
              display: 'block',
              marginTop: 6 * type.text,
              fontStyle: 'normal',
              fontSize: 11 * type.label,
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
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  return `${h12}:${mm} ${ampm}`;
}
