// Typewriter brand title for the sign-in screen. Types out "unclaw"
// one character at a time, with a terminal-style block caret that
// rides along with the typed text. Once the word is complete the
// caret stays put and blinks indefinitely.
//
// Font: Helvetica CE Bold (Central European Helvetica), pulled from
// the user's system. Bold weight is requested both via the family
// name AND via font-weight so it resolves whether the system has
// "Helvetica CE Bold" as a discrete family OR "Helvetica CE" as one
// family with weight axes.
//
// Caret color: #D22F2D (the user's punchy red).

import { useEffect, useState } from 'react';

const WORD = 'unclaw';

// Per-character delay. 110 ms feels like confident typing — fast
// enough not to drag, slow enough that each letter registers.
const TYPE_INTERVAL_MS = 110;

// Pause before the first character lands so the user catches the
// caret blinking on an empty space first (sets the "terminal is
// about to type" mood).
const TYPE_START_DELAY_MS = 240;

export function TypewriterTitle() {
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let i = 0;
    let intervalId: number | null = null;
    const startId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        i += 1;
        setTyped(WORD.slice(0, i));
        if (i >= WORD.length) {
          if (intervalId !== null) window.clearInterval(intervalId);
          setDone(true);
        }
      }, TYPE_INTERVAL_MS);
    }, TYPE_START_DELAY_MS);

    return () => {
      window.clearTimeout(startId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div
      aria-label={WORD}
      style={{
        position: 'relative',
        zIndex: 1,
        // Helvetica CE Bold from the user's system. Multiple aliases
        // covered so the OS finds it under whichever name it's
        // registered with (PostScript name vs family name vary).
        fontFamily:
          '"Helvetica CE Bold", "HelveticaCE-Bold", "Helvetica CE", "Helvetica Ce", Helvetica, "Helvetica Neue", sans-serif',
        fontWeight: 700,
        fontSize: 28,
        lineHeight: 1,
        letterSpacing: '0.06em',
        color: '#ffffff',
        textShadow: '0 1px 4px rgba(0, 0, 0, 0.5)',
        // Shrink-to-content so the parent card's `alignItems: center`
        // actually centers the box. With a fixed minWidth + textAlign
        // left (the previous version) the text rendered against the
        // box's left edge while the box was centered, so the WORD
        // appeared offset left of the card's center. Letting the box
        // size itself to the typed text means the parent flex
        // re-centers it on every render and the word grows outward
        // from the visual center. Slight horizontal motion as letters
        // land is part of the typewriter cadence.
        width: 'fit-content',
      }}
    >
      <span>{typed}</span>
      <span
        aria-hidden
        style={{
          // Underscore-style caret: thin horizontal rectangle sitting
          // just under the baseline of the typed text. Width ~half a
          // character; height ~3px reads as "terminal cursor" not
          // "decorative bar".
          display: 'inline-block',
          width: '0.55em',
          height: 3,
          marginLeft: 1,
          // verticalAlign baseline keeps the caret aligned with the
          // text's typographic baseline; combined with a small
          // negative margin-bottom it sits just below the text in the
          // descender region.
          verticalAlign: 'baseline',
          marginBottom: '-1px',
          background: '#D22F2D',
          boxShadow: '0 0 6px rgba(210, 47, 45, 0.50)',
          borderRadius: 1,
          animation: done
            ? 'typewriter-caret-blink 1.05s steps(2, start) infinite'
            : 'none',
        }}
      />
    </div>
  );
}
