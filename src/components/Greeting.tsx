import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Quote {
  text: string;
  author: string;
}

const QUOTES: Quote[] = [
  { text: 'AI is the new electricity.', author: 'Andrew Ng' },
  { text: 'AI is the most profound technology humanity will ever develop.', author: 'Sundar Pichai' },
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
  { text: 'We see AI as the way to empower every person on the planet.', author: 'Satya Nadella' },
  { text: 'AI will make us work more productively and live longer.', author: 'Fei-Fei Li' },
  { text: 'We are at the beginning of the AI industrial revolution.', author: 'Jensen Huang' },
  { text: 'AI is a powerful tool to help humanity understand the world.', author: 'Demis Hassabis' },
  { text: 'Any sufficiently advanced technology is indistinguishable from magic.', author: 'Arthur C. Clarke' },
  { text: 'The real problem is not whether machines think but whether men do.', author: 'B.F. Skinner' },
  { text: 'Software is eating the world; AI is eating software.', author: 'Jensen Huang' },
];

const QUOTE_ROTATION_MS = 45_000;

function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

interface GreetingProps {
  /** When false, the entire greeting fades out (loading screen, etc). */
  visible: boolean;
  /** Optional first name. */
  userName?: string;
}

export function Greeting({ visible, userName }: GreetingProps) {
  const [now, setNow] = useState(() => new Date());
  const [quoteIndex, setQuoteIndex] = useState(() =>
    Math.floor(Math.random() * QUOTES.length)
  );

  // Tick the clock every second so the seconds digit stays live.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Rotate quote on a slow timer so the panel feels alive without nagging.
  useEffect(() => {
    const t = setInterval(() => {
      setQuoteIndex(i => (i + 1) % QUOTES.length);
    }, QUOTE_ROTATION_MS);
    return () => clearInterval(t);
  }, []);

  const greeting = useMemo(() => greetingForHour(now.getHours()), [now]);
  const time = useMemo(
    () => now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
    [now]
  );

  const quote = QUOTES[quoteIndex];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="greeting"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none select-none"
        >
          {/* Live clock */}
          <div style={{ marginBottom: 'clamp(1px, 0.4vw, 4px)' }}>
            <span
              style={{
                fontSize: 'clamp(9.5px, 2.3vw, 13px)',
                fontWeight: 500,
                color: 'rgba(255,255,255,0.55)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.04em',
                textShadow: '0 1px 6px rgba(0,0,0,0.6)',
              }}
            >
              {time}
            </span>
          </div>

          {/* Greeting headline */}
          <div
            style={{
              fontSize: 'clamp(17px, 5.2vw, 30px)',
              fontWeight: 500,
              color: 'rgba(255,255,255,0.94)',
              letterSpacing: '-0.018em',
              lineHeight: 1.12,
              marginBottom: 'clamp(3px, 1vw, 8px)',
              textShadow: '0 2px 14px rgba(0,0,0,0.55)',
            }}
          >
            Good {greeting}{userName && `, ${userName}`}!
          </div>

          {/* Rotating quote — crossfades every 45s */}
          <div style={{ minHeight: 'clamp(50px, 13vw, 80px)', width: '92%', position: 'relative' }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={quoteIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  fontSize: 'clamp(9.5px, 2.4vw, 14px)',
                  lineHeight: 1.6,
                  color: 'rgba(255,255,255,0.52)',
                  fontStyle: 'italic',
                  textShadow: '0 1px 8px rgba(0,0,0,0.7)',
                }}
              >
                &ldquo;{quote.text}&rdquo;
                <span
                  style={{
                    fontStyle: 'normal',
                    letterSpacing: '0.04em',
                    color: 'rgba(255,255,255,0.4)',
                    marginLeft: '0.4em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  — {quote.author}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
