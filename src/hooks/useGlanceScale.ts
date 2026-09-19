// How the greeting and the glance column respond to a bigger window: a type
// ramp, not a zoom. The px values are drawn for the 600 x 780 default; on a
// larger window the headline grows the most, reading text a little, the small
// uppercase labels barely at all, and spacing follows the reading text. That
// is how a printed page scales: hierarchy gets MORE pronounced, not stretched.
// Widths follow the type they hold, so line lengths stay the same.
//
// History: this first zoomed everything by up to 1.8x ("not just a stupid
// zoom"), then only widened the boundaries; neither read as designed.

import { useEffect, useState } from 'react';

/** The window size the glance px values were designed at (electron/main.ts). */
const DESIGN_WIDTH = 600;
const DESIGN_HEIGHT = 780;
/** Growth past which nothing grows further (2 = a window twice the default). */
const MAX_GROWTH = 2;

/** How much each tier grows at MAX_GROWTH. */
const RAMP = { display: 0.40, text: 0.18, label: 0.08 } as const;

export interface GlanceType {
  /** The greeting headline. */
  display: number;
  /** Reading text, row spacing and the widths that hold them. */
  text: number;
  /** Small uppercase labels and attributions. */
  label: number;
}

export function glanceTypeFor(width: number, height: number): GlanceType {
  const s = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  const g = Math.max(0, Math.min(MAX_GROWTH, s) - 1) / (MAX_GROWTH - 1);
  const at = (k: number) => Math.round((1 + g * k) * 100) / 100;
  return { display: at(RAMP.display), text: at(RAMP.text), label: at(RAMP.label) };
}

export function useGlanceType(): GlanceType {
  const [type, setType] = useState(() => glanceTypeFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = glanceTypeFor(window.innerWidth, window.innerHeight);
        setType((cur) => (cur.display === next.display && cur.text === next.text && cur.label === next.label ? cur : next));
      });
    };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, []);
  return type;
}
