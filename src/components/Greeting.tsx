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
  { text: 'The future is already here — it’s just not evenly distributed.', author: 'William Gibson' },
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.4, ease: EASE_OUT_EXPO }}
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
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--text-secondary)',
          fontVariantNumeric: 'tabular-nums',
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
          marginBottom: 8,
        }}
      >
        {timeStr}
      </div>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 500,
          color: 'var(--text-primary)',
          letterSpacing: '-0.022em',
          lineHeight: 1.1,
          margin: 0,
          textShadow: '0 2px 8px rgba(0, 0, 0, 0.65)',
        }}
      >
        Good {greetingWord}, {userName}!
      </h1>

      <AnimatePresence mode="wait">
        <motion.p
          key={quoteIdx}
          initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 0.92, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
          style={{
            marginTop: 10,
            fontSize: 15,
            fontWeight: 400,
            fontStyle: 'italic',
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
            letterSpacing: 0,
            margin: '10px 0 0 0',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.55)',
            maxWidth: 360,
          }}
        >
          “{quote.text}” <span style={{ opacity: 0.7 }}>— {quote.author}</span>
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
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
