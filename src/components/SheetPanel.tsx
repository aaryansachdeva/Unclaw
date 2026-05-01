// Left-edge sliding sheet. Renders one panel at a time (Reminders,
// Stocks, News, Weather) inside a frosted-slate surface anchored
// between the titlebar and the dock. Closes via the X button, the
// triggering widget icon, click-outside, or Escape.
//
// The motion vocabulary is spring-in / fade-out: the sheet slides
// horizontally on a stiff spring, content inside fades + lifts on a
// brief delay. On close, content fades first (so the user reads
// "leaving" before the surface moves), then the surface itself slides
// out under a faster easeOut.

import {
  ReactNode, useEffect, useRef,
} from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';

import { SheetKey } from '../hooks/useSheet';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const TITLES: Record<SheetKey, string> = {
  reminders: 'Reminders',
  stocks: 'Watchlist',
  news: 'Headlines',
  weather: 'Weather',
};

interface SheetPanelProps {
  /** Currently-active sheet, or null when nothing is open. */
  activeKey: SheetKey | null;
  /** User-driven close. Returns focus to the trigger via `triggerRef`. */
  onClose: () => void;
  /** Element to return focus to once the sheet closes (the widget
   *  icon button in the dock). The map is keyed by sheet name; when
   *  null the close just blurs without restoring focus. */
  triggerRefs?: Partial<Record<SheetKey, React.RefObject<HTMLElement | null>>>;
  /** The active sheet's body. App owns the rendering decision. */
  children: ReactNode;
}

// Vertical offset (px) from the rail's center to each icon's center.
// Rail icon: 38px tall, 4px gap → 42px stride. With 4 icons, the rail
// center sits between Stocks and News. Formula: (i - 1.5) * 42.
const ICON_OFFSET: Record<SheetKey, number> = {
  reminders: -63,
  stocks:    -21,
  news:       21,
  weather:    63,
};

export function SheetPanel({
  activeKey,
  onClose,
  triggerRefs,
  children,
}: SheetPanelProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion() ?? false;

  // Cache the previously-active key so the closing animation knows
  // which trigger to return focus to even after `activeKey` flips
  // back to null.
  const lastKeyRef = useRef<SheetKey | null>(null);
  useEffect(() => {
    if (activeKey) lastKeyRef.current = activeKey;
  }, [activeKey]);

  // Focus management — when the sheet closes, return focus to the
  // triggering rail icon. While open we leave focus where the user
  // put it (no close button to focus anymore — the active rail icon
  // doubles as the close affordance, and Esc/click-outside also work).
  useEffect(() => {
    if (activeKey) return undefined;
    const last = lastKeyRef.current;
    if (last && triggerRefs?.[last]?.current) {
      triggerRefs[last]!.current!.focus();
    }
    return undefined;
  }, [activeKey, triggerRefs]);

  // Click-outside + Escape. We intentionally listen on `mousedown`
  // (not `click`) so a drag that ends inside the sheet can still
  // close if it started outside.
  useEffect(() => {
    if (!activeKey) return undefined;
    const onPointer = (e: MouseEvent) => {
      const node = sheetRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) {
        // Don't fight the dock — clicking a widget icon should toggle
        // through Dock's own handler, not this one. We leave dock
        // clicks alone by checking for the [data-sheet-trigger]
        // attribute that the WidgetIcon stamps onto its button.
        if (target instanceof Element && target.closest('[data-sheet-trigger]')) {
          return;
        }
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [activeKey, onClose]);

  const titleId = activeKey ? `sheet-title-${activeKey}` : undefined;

  return (
    // `mode="wait"` so when the user switches widgets, the old panel
    // fully exits BEFORE the new one enters at its new vertical
    // position. With sync mode the two would briefly overlap at
    // different rows and look glitchy.
    <AnimatePresence mode="wait">
      {activeKey && (
        <motion.aside
          key={activeKey}
          ref={sheetRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          // framer-motion's `y` is composed with our `translateY(-50%)`
          // intent — we keep the panel vertically centered on the
          // active icon by using `y: '-50%'` as the resting state and
          // animating only `x` + opacity for entry/exit.
          initial={reduce
            ? { x: 0, y: '-50%', opacity: 1 }
            : { x: -16, y: '-50%', opacity: 0 }}
          animate={{ x: 0, y: '-50%', opacity: 1 }}
          exit={reduce
            ? { y: '-50%', opacity: 0 }
            : { x: -16, y: '-50%', opacity: 0 }}
          transition={reduce
            ? { duration: 0 }
            : { type: 'spring', stiffness: 320, damping: 34, mass: 0.8 }}
          style={{
            // Vertically centered on the active rail icon — `top: 50%`
            // sits at the rail's midpoint; the offset shifts up/down
            // to land at the specific icon's center. The framer-motion
            // `y: '-50%'` (above) pulls the panel up by half its own
            // height, so the active icon is at the panel's vertical
            // middle.
            position: 'absolute',
            top: `calc(50% + ${ICON_OFFSET[activeKey]}px)`,
            left: 70,
            width: 300,
            maxHeight: 'min(440px, calc(100% - 200px))',
            zIndex: 35,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--glass-bg-panel)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border-focus)',
            borderRadius: 16,
            boxShadow: [
              '0 1px 0 rgba(255, 255, 255, 0.06) inset',
              '0 16px 36px -10px rgba(0, 0, 0, 0.45)',
            ].join(', '),
            overflow: 'hidden',
            willChange: 'transform, opacity',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              height: 44,
              padding: '0 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <motion.h2
              id={titleId}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: reduce ? 0 : 0.12, ease: EASE_OUT_EXPO }}
              style={{
                flex: 1,
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              {TITLES[activeKey]}
            </motion.h2>
          </div>

          {/* Body — scrolls if content overflows; otherwise shrinks
              to content so the panel hugs its data. */}
          <motion.div
            className="sheet-scroll"
            initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.32,
              delay: reduce ? 0 : 0.15,
              ease: EASE_OUT_EXPO,
            }}
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
              padding: '14px 16px',
            }}
          >
            {children}
          </motion.div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
