import { useCallback } from 'react';

export type SheetKey = 'reminders' | 'stocks' | 'news' | 'weather';

/**
 * Imperative API around an externally-owned `activeWidget` state.
 * App.tsx holds the source of truth so opening one sheet closes the
 * others; consumers (Dock, slash menu, keyboard) call into this to
 * mutate it without each owning their own copy.
 */
export interface SheetController {
  active: SheetKey | null;
  open: (key: SheetKey) => void;
  close: () => void;
  toggle: (key: SheetKey) => void;
}

export function useSheet(
  active: SheetKey | null,
  setActive: (next: SheetKey | null) => void,
): SheetController {
  const open = useCallback((key: SheetKey) => setActive(key), [setActive]);
  const close = useCallback(() => setActive(null), [setActive]);
  const toggle = useCallback(
    (key: SheetKey) => setActive(active === key ? null : key),
    [active, setActive],
  );
  return { active, open, close, toggle };
}
