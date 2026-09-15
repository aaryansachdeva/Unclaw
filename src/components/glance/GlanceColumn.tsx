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
//
// Edit mode ("Edit widgets" at the foot of the column): every section
// collapses to its header with a drag handle and a remove control, the
// list reorders by dragging (framer Reorder, transform only), hidden
// widgets return through "+ Weather" rows, and Done leaves. The layout
// persists per install (services/glanceLayout).
//
// The stock watchlist and the weather places are edited inside their
// expanded glances and saved with the account (user settings `glance`).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, LayoutGroup, Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { Plus, SlidersHorizontal, Check } from 'lucide-react';

import type { SheetKey } from '../../hooks/useSheet';
import type { Reminder } from '../../services/reminders';
import type { NewsArticle } from '../../services/news';
import { readGlancePrefs, type GlancePrefs } from '../../services/userSettings';
import {
  ALL_GLANCES, GLANCE_LABELS, hiddenGlances, loadGlanceLayout, saveGlanceLayout,
  type GlanceKey, type GlanceLayout,
} from '../../services/glanceLayout';
import { RemindersGlance } from './RemindersGlance';
import { WeatherGlance } from './WeatherGlance';
import { StocksGlance } from './StocksGlance';
import { NewsGlance } from './NewsGlance';
import { GLANCE_LABEL_STYLE } from './GlanceSection';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const GLANCE_COLUMN_LEFT = 22;
export const GLANCE_COLUMN_WIDTH = 240;
/** Room kept clear at the bottom for the character controls and the input bar. */
const BOTTOM_CLEARANCE = 146;

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
  /** Fade the column out (chat pane open: the stream half is too narrow
   *  for it to stay off the face). State is kept, nothing remounts. */
  faded?: boolean;
  /** The account's saved glance lists (user settings `glance`). */
  glance?: GlancePrefs | null;
  /** The watchlist or the places changed; the owner saves it. */
  onGlanceChange?: (next: GlancePrefs) => void;
  /** Summarize under a news headline: stage the article in the input bar. */
  onSummarizeArticle?: (article: NewsArticle) => void;
  /** Reminders +: start a reminder in the input bar (on a picked day). */
  onAddReminder?: (day?: string) => void;
}

export function GlanceColumn({
  top, reminders, onCompleteReminder, onRemindersChanged, activeWidget, onOpen, onClose, refreshKey, faded = false,
  glance, onGlanceChange, onSummarizeArticle, onAddReminder,
}: Props) {
  const reduce = useReducedMotion() ?? false;
  const [now, setNow] = useState(() => new Date());
  const columnRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<GlanceLayout>(() => loadGlanceLayout());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const updateLayout = useCallback((next: GlanceLayout) => {
    setLayout(next);
    saveGlanceLayout(next);
  }, []);

  const expanded: GlanceKey | null =
    !editing && activeWidget && activeWidget !== 'wardrobe' ? activeWidget : null;

  // Entering edit mode collapses whatever was expanded.
  useEffect(() => {
    if (editing && activeWidget && activeWidget !== 'wardrobe') onClose();
  }, [editing, activeWidget, onClose]);

  // The expanded section owns the top of the column: scroll there so the
  // panel is never half hidden, and let Escape collapse it (or leave edit).
  useEffect(() => {
    if (!expanded && !editing) return undefined;
    if (expanded) columnRef.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (editing) setEditing(false); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, editing, onClose, reduce]);

  // Boot stagger runs once; every later re-entry (collapse) is quick.
  const bootedRef = useRef(false);
  useEffect(() => { const t = window.setTimeout(() => { bootedRef.current = true; }, 1500); return () => window.clearTimeout(t); }, []);

  const hidden = useMemo(() => hiddenGlances(layout), [layout]);
  const remove = (key: GlanceKey) => updateLayout({ order: layout.order.filter((k) => k !== key) });
  const add = (key: GlanceKey) => updateLayout({ order: [...layout.order, key] });

  const noop = useCallback(() => {}, []);
  const prefs = useMemo(() => readGlancePrefs(glance), [glance]);
  const sectionProps = (key: GlanceKey) => ({
    open: expanded === key,
    onOpen: () => onOpen(key),
    onClose,
    onLayout: noop,
    editing,
    onRemove: editing ? () => remove(key) : undefined,
  });

  const nodeFor = (key: GlanceKey, extra: object = {}): ReactNode => {
    const p = { ...sectionProps(key), ...extra };
    switch (key) {
      case 'reminders':
        return <RemindersGlance reminders={reminders ?? []} now={now} onComplete={onCompleteReminder} onChanged={onRemindersChanged} onAdd={onAddReminder} {...p} />;
      case 'weather':
        return (
          <WeatherGlance
            refreshKey={refreshKey}
            places={prefs.places ?? null}
            onPlacesChange={onGlanceChange ? (places) => onGlanceChange({ ...prefs, places }) : undefined}
            {...p}
          />
        );
      case 'stocks':
        return (
          <StocksGlance
            refreshKey={refreshKey}
            symbols={prefs.stocks ?? null}
            onSymbolsChange={onGlanceChange ? (stocks) => onGlanceChange({ ...prefs, stocks }) : undefined}
            {...p}
          />
        );
      case 'news': return <NewsGlance refreshKey={refreshKey} onSummarize={onSummarizeArticle} {...p} />;
    }
  };

  const visible: GlanceKey[] = !reminders ? [] : expanded ? layout.order.filter((k) => k === expanded) : layout.order;

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
        pointerEvents: faded ? 'none' : 'auto',
        opacity: faded ? 0 : 1,
        transition: reduce ? undefined : 'opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        userSelect: 'none',
        overscrollBehavior: 'contain',
      }}
      aria-hidden={faded || undefined}
    >
      {editing ? (
        /* Edit mode: headers only, drag to reorder, x to remove, hidden
           widgets offered back below, Done at the foot. */
        <Reorder.Group
          axis="y"
          values={layout.order}
          onReorder={(order) => updateLayout({ order: order as GlanceKey[] })}
          as="div"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {layout.order.map((key) => (
            <EditableItem key={key} value={key}>
              {(controls) => nodeFor(key, { dragControls: controls })}
            </EditableItem>
          ))}
        </Reorder.Group>
      ) : (
        <LayoutGroup>
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((key, i) => (
              <motion.div
                key={key}
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
                style={{ marginTop: i === 0 ? 0 : 26, marginLeft: -8 }}
              >
                {nodeFor(key)}
              </motion.div>
            ))}
          </AnimatePresence>
        </LayoutGroup>
      )}

      {/* Foot: add-back rows in edit mode, then the mode control. Hidden
          while a section is expanded so the expanded view ends cleanly. */}
      {reminders && !expanded && (
        <motion.div
          layout={reduce ? false : 'position'}
          initial={false}
          style={{ marginTop: editing ? 10 : 14, marginLeft: -8 }}
        >
          <AnimatePresence initial={false}>
            {editing && hidden.length > 0 && (
              <motion.div
                key="add"
                initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                style={{ marginBottom: 6 }}
              >
                <div style={{ ...GLANCE_LABEL_STYLE, padding: '6px 8px 3px' }}>Add</div>
                {hidden.map((key) => (
                  <FootButton key={key} onClick={() => add(key)} icon={<Plus size={12} strokeWidth={2.5} />} tone="secondary">
                    {GLANCE_LABELS[key]}
                  </FootButton>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          {layout.order.length === 0 && !editing ? (
            <FootButton onClick={() => setEditing(true)} icon={<Plus size={12} strokeWidth={2.5} />}>
              Add widgets
            </FootButton>
          ) : (
            <FootButton
              onClick={() => setEditing((v) => !v)}
              icon={editing ? <Check size={12} strokeWidth={2.5} /> : <SlidersHorizontal size={12} strokeWidth={2.2} />}
              tone={editing ? 'primary' : 'ghost'}
            >
              {editing ? 'Done' : 'Edit widgets'}
            </FootButton>
          )}
        </motion.div>
      )}
    </div>
  );
}

/** One reorderable row. Drag starts only from the handle in the header
 *  (dragListener off), so clicking a header does not move anything. */
function EditableItem({
  value, children,
}: {
  value: GlanceKey;
  children: (controls: ReturnType<typeof useDragControls>) => ReactNode;
}) {
  const controls = useDragControls();
  const reduce = useReducedMotion() ?? false;
  return (
    <Reorder.Item
      value={value}
      as="div"
      dragListener={false}
      dragControls={controls}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
      whileDrag={{ scale: 1.02, zIndex: 2 }}
      style={{ marginLeft: -8, marginBottom: 6, borderRadius: 8, position: 'relative' }}
    >
      {children(controls)}
    </Reorder.Item>
  );
}

function FootButton({
  children, onClick, icon, tone = 'ghost',
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  tone?: 'ghost' | 'secondary' | 'primary';
}) {
  const color = tone === 'primary' ? 'var(--text-primary)' : tone === 'secondary' ? 'var(--text-secondary)' : 'var(--text-ghost)';
  return (
    <button
      type="button"
      data-sheet-trigger
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '4px 8px 5px', borderRadius: 8,
        background: 'transparent', border: 'none',
        fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500,
        color, cursor: 'pointer',
        textShadow: 'var(--text-shadow-floating)',
        transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color; }}
    >
      {icon && <span aria-hidden style={{ display: 'inline-flex', opacity: 0.85 }}>{icon}</span>}
      {children}
    </button>
  );
}

export { ALL_GLANCES };
