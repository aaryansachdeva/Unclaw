// How much the glance column grows with the window. The widgets are drawn
// in px for the default 600 x 780 window; on a bigger window they looked
// tiny. The column scales with the tighter of the two axes, a little less
// than proportionally (Aryan: "the ratios the same as the default size or
// a little smaller"), never below the default and never past MAX.

import { useEffect, useState } from 'react';

/** The window size the glance px values were designed at (electron/main.ts). */
const DESIGN_WIDTH = 600;
const DESIGN_HEIGHT = 780;
/** Share of the window's growth the column follows (1 = exactly proportional). */
const FOLLOW = 0.85;
const MAX = 1.8;

export function glanceScaleFor(width: number, height: number): number {
  const s = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  if (!(s > 1)) return 1;
  return Math.min(MAX, 1 + (s - 1) * FOLLOW);
}

export function useGlanceScale(): number {
  const [scale, setScale] = useState(() => glanceScaleFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Two decimals: a live drag re-renders only when the step is visible.
        const next = Math.round(glanceScaleFor(window.innerWidth, window.innerHeight) * 100) / 100;
        setScale((cur) => (cur === next ? cur : next));
      });
    };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, []);
  return scale;
}
