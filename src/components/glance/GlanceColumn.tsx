// The left column over the stage, under the fixed greeting: the reminders,
// weather, stocks and news glances as one scrollable stack. Every block is
// bare floating text (no surface), kept narrow so it stays off the face,
// and the column is only as tall as its content.
//
// Expanding a glance happens INSIDE the column (2026-09-15): the other
// sections leave, the chosen one slides to the top and its body swaps
// from the glance rows to the full panel, all in one choreographed beat:
//
//   1. siblings fade out and lift 6px (150 ms, exits are quick)
//   2. the chosen section's header travels to the top (framer layout
//      animation, transform only, ~320 ms ease-out-expo)
//   3. its body swaps to the expanded rows (GlanceSection, 260 ms)
//
// The expanded views are the glances' own, in the same bare-text language
// and the same 240 px, so nothing about the character's side of the
// screen changes shape. Collapsing runs the beat in reverse with the
// siblings returning in a 50 ms stagger; the long boot stagger runs only
// once, on first mount. Reduced motion swaps states instantly.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion';

import type { SheetKey } from '../../hooks/useSheet';
import type { Reminder } from '../../services/reminders';
import { RemindersGlance } from './RemindersGlance';
import { WeatherGlance } from './WeatherGlance';
import { StocksGlance } from './StocksGlance';
import { NewsGlance } from './NewsGlance';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const GLANCE_COLUMN_LEFT = 22;
export const GLANCE_COLUMN_WIDTH = 240;
/** Room kept clear at the bottom for the character controls and the input bar. */
const BOTTOM_CLEARANCE = 146;

type GlanceKey = Exclude<SheetKey, 'wardrobe'>;

interface Props {
  /** Top edge (px in the stage's box); App derives it from the greeting's height. */
  top: number;
  /** null hides every widget glance (before onboarding). */
  reminders: Reminder[] | null;
  onCompleteReminder: (id: string) => void;
  /** The expanded section, if any. */
  activeWidget: SheetKey | null;
  onOpen: (key: SheetKey) => void;
  onClose: () => void;
  /** A reminder was added or deleted inside the column; the owner refetches. */
  onRemindersChanged: () => void;
  refreshKey: number;
}

export function GlanceColumn({
  top, reminders, onCompleteReminder, onRemindersChanged, activeWidget, onOpen, onClose, refreshKey,
}: Props) {
  const reduce = useReducedMotion() ?? false;
  const [now, setNow] = useState(() => new Date());
  const columnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const expanded: GlanceKey | null =
    activeWidget && activeWidget !== 'wardrobe' ? activeWidget : null;

  // The expanded section owns the top of the column: scroll there so the
  // panel is never half hidden, and let Escape collapse it.
  useEffect(() => {
    if (!expanded) return undefined;
    columnRef.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, onClose, reduce]);

  // Boot stagger runs once; every later re-entry (collapse) is quick.
  const bootedRef = useRef(false);
  useEffect(() => { const t = window.setTimeout(() => { bootedRef.current = true; }, 1500); return () => window.clearTimeout(t); }, []);

  const noop = useCallback(() => {}, []);
  const sectionProps = (key: GlanceKey) => ({
    open: expanded === key,
    onOpen: () => onOpen(key),
    onClose,
    onLayout: noop,
  });

  const blocks: Array<{ key: GlanceKey; node: ReactNode }> = reminders ? [
    { key: 'reminders', node: (
      <RemindersGlance reminders={reminders} now={now} onComplete={onCompleteReminder} onChanged={onRemindersChanged} {...sectionProps('reminders')} />
    ) },
    { key: 'weather', node: <WeatherGlance refreshKey={refreshKey} {...sectionProps('weather')} /> },
    { key: 'stocks', node: <StocksGlance refreshKey={refreshKey} {...sectionProps('stocks')} /> },
    { key: 'news', node: <NewsGlance refreshKey={refreshKey} {...sectionProps('news')} /> },
  ] : [];
  const visible = expanded ? blocks.filter((b) => b.key === expanded) : blocks;

  const baseDelay = reduce ? 0 : 0.15;
  const stagger = reduce ? 0 : 0.18;

  return (
    <div
      ref={columnRef}
      className="no-scrollbar"
      style={{
        position: 'absolute',
        top,
        left: GLANCE_COLUMN_LEFT,
        width: GLANCE_COLUMN_WIDTH,
        maxWidth: 'calc(100% - 44px)',
        maxHeight: `calc(100% - ${top + BOTTOM_CLEARANCE}px)`,
        overflowY: 'auto',
        overflowX: 'hidden',
        // Soft cut at the bottom so a scrolled stack fades instead of
        // ending on a hard line over the character.
        WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
        maskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
        paddingBottom: 28,
        paddingLeft: 8,
        marginLeft: -8,
        zIndex: 20,
        pointerEvents: 'auto',
        userSelect: 'none',
        overscrollBehavior: 'contain',
      }}
    >
      <LayoutGroup>
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((b, i) => (
            <motion.div
              key={b.key}
              layout={reduce ? false : 'position'}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
              animate={{
                opacity: 1, y: 0,
                transition: reduce
                  ? { duration: 0 }
                  : {
                      duration: 0.24,
                      delay: expanded ? 0 : bootedRef.current ? i * 0.05 : baseDelay + stagger * (3 + i * 0.5),
                      ease: EASE_OUT_EXPO,
                    },
              }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: 0.15, ease: EASE_OUT_EXPO } }}
              transition={{ layout: { duration: 0.32, ease: EASE_OUT_EXPO } }}
              style={{ marginTop: i === 0 ? 0 : 16, marginLeft: -8 }}
            >
              {b.node}
            </motion.div>
          ))}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}
