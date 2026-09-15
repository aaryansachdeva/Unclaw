// Cycle an index through a list on a timer, the way the greeting rotates
// its quote: one item on screen at a time, a soft cross-fade between them.
// Pauses while the pointer is over the section (so a row can be read and
// clicked) and under reduced motion (first item only).

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

export function useCycle(count: number, intervalMs: number, paused = false): number {
  const reduce = useReducedMotion() ?? false;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (count <= 1 || reduce || paused) return undefined;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % count), intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs, reduce, paused]);
  // Keep the index valid when the list shrinks between refreshes.
  return count > 0 ? idx % count : 0;
}
