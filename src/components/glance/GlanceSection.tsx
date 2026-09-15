// One section of the glance column (reminders, weather, stocks, news):
// a caps header with an optional trailing note and an expand control, then
// either the section's bare-text glance rows or, when open, the full panel
// inline. No surface of its own: everything floats over the stream with
// the floating text-shadow, and only rows wake to glass under the pointer.
//
// Open and closed share the same header element, so when the column
// collapses the other sections the header of this one simply slides up
// (layout animation in GlanceColumn) while its body cross-fades from the
// glance rows to the panel: 120 ms out, 280 ms in, ease-out-expo. Exits
// are faster than entrances on purpose.

import { forwardRef, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion, type DragControls } from 'framer-motion';
import { Maximize2, Minimize2, GripVertical, X } from 'lucide-react';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const GLANCE_ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '3px 8px',
  borderRadius: 8,
  background: 'transparent',
  textShadow: 'var(--text-shadow-floating)',
  transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
} as const;

export const GLANCE_LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text-ghost)',
  textShadow: 'var(--text-shadow-floating)',
} as const;

/** Small caps meta text used under or beside a primary line. */
export const GLANCE_META_STYLE = {
  fontSize: 10.5,
  fontWeight: 600,
  lineHeight: 1.3,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text-secondary)',
  opacity: 0.8,
} as const;

interface Props {
  label: string;
  /** Trailing note after the label, e.g. "· 2" or "· Inglewood". */
  note?: string | null;
  /** Opens the full panel in place of the glance rows. */
  onOpen?: () => void;
  /** Collapses back to the glance rows. */
  onClose?: () => void;
  /** Extra control rendered right after the label (e.g. reminders' +). */
  action?: ReactNode;
  /** True while this section is the expanded one. */
  open?: boolean;
  /** The full panel body, rendered inline while open. */
  panel?: ReactNode;
  /** Edit mode (GlanceColumn): only the header shows, with a drag handle
   *  for reordering and a remove control; the body is collapsed. */
  editing?: boolean;
  dragControls?: DragControls;
  onRemove?: () => void;
  children: ReactNode;
}

export const GlanceSection = forwardRef<HTMLDivElement, Props>(function GlanceSection(
  { label, note, onOpen, onClose, action, open = false, panel, editing = false, dragControls, onRemove, children },
  ref,
) {
  const reduce = useReducedMotion() ?? false;
  const toggle = editing ? undefined : (open ? onClose : onOpen);
  const Icon = open ? Minimize2 : Maximize2;
  return (
    <div ref={ref}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: editing ? '4px 4px 4px 4px' : '0 4px 3px 8px' }}>
        {editing && (
          /* Drag handle: the only thing that starts a reorder, so the rest
             of the header stays a plain header. */
          <span
            role="button"
            aria-label={`Drag to reorder ${label.toLowerCase()}`}
            title="Drag to reorder"
            onPointerDown={(e) => { dragControls?.start(e); }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, marginRight: 2,
              color: 'var(--text-ghost)', cursor: 'grab', touchAction: 'none',
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
            }}
          >
            <GripVertical size={13} strokeWidth={2.2} />
          </span>
        )}
        <span style={{ ...GLANCE_LABEL_STYLE, ...(editing ? { color: 'var(--text-secondary)', fontSize: 11 } : {}) }}>
          {label}{!editing && note ? ` · ${note}` : ''}
        </span>
        {!editing && action}
        {editing && onRemove && (
          <>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${label.toLowerCase()}`}
              title="Remove"
              style={{
                width: 20, height: 20, borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none',
                color: 'var(--text-ghost)', cursor: 'pointer',
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
                transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--danger)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-ghost)'; }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </>
        )}
        {toggle && (
          <motion.button
            type="button"
            data-sheet-trigger
            onClick={toggle}
            whileTap={reduce ? undefined : { scale: 0.9 }}
            aria-label={open ? `Collapse ${label.toLowerCase()}` : `Open ${label.toLowerCase()}`}
            aria-expanded={open}
            title={open ? 'Collapse' : `Open ${label.toLowerCase()}`}
            style={{
              width: 20, height: 20, borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: open ? 'var(--glass-bg-hover)' : 'transparent', border: 'none',
              color: open ? 'var(--text-primary)' : 'var(--text-ghost)', cursor: 'pointer',
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
              transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { if (open) return; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-ghost)'; }}
          >
            <Icon size={11} strokeWidth={2.5} />
          </motion.button>
        )}
      </div>

      {/* Body: glance rows or the inline panel. `mode="wait"` so the rows
          are gone before the panel lands; the panel rises 8px into place. */}
      <AnimatePresence mode="wait" initial={false}>
        {editing ? null : open && panel ? (
          <motion.div
            key="panel"
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, transition: { duration: 0.12, ease: EASE_OUT_EXPO } }}
            transition={reduce ? { duration: 0 } : { duration: 0.26, ease: EASE_OUT_EXPO }}
            style={{ padding: '2px 0 0' }}
          >
            {panel}
          </motion.div>
        ) : (
          <motion.div
            key="rows"
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT_EXPO }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/** A hover-wake row wrapper. `onClick` makes the whole row a button. */
export function GlanceRow({
  children,
  onClick,
  ariaLabel,
  align = 'center',
}: {
  children: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  align?: 'center' | 'flex-start' | 'baseline';
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      data-sheet-trigger
      style={{
        ...GLANCE_ROW_STYLE,
        alignItems: align,
        width: '100%',
        textAlign: 'left',
        border: 'none',
        fontFamily: 'inherit',
        color: 'var(--text-primary)',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--glass-bg-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {children}
    </Tag>
  );
}
