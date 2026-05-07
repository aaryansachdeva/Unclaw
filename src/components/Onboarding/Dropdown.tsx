// Custom dropdown — replaces native <select> for the wizard fields.
//
// The native control's open menu is owned by the OS (Windows in our case)
// and renders as a flat white panel with system fonts. That looks jarring
// against UnClaw's frosted-slate chrome and breaks the design intent —
// especially in ConnectionsStep where users see three dropdowns in a row.
//
// This is a portal-rendered, keyboard-navigable, theme-matched
// replacement. Same prop surface as the old select wrapper:
//   value, onChange, options, placeholder, disabled.
//
// Behaviour:
//   * Click trigger / Space / Enter / ArrowDown -> open
//   * ArrowUp/Down navigate; Enter or click selects; Esc closes
//   * Click-outside closes
//   * Type-ahead: typing letters jumps to the first matching option
//   * Selected option shows a check mark; current keyboard target is
//     highlighted with the accent
//
// Rendered through a portal at document.body so the menu is never
// clipped by parent overflow:hidden / z-index stacking. Position is
// recomputed on scroll/resize.
import {
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface DropdownOption {
  /** Stable wire id stored in `value`. */
  id: string;
  /** What the user sees in the row. */
  label: string;
  /** Optional secondary metadata rendered to the right of the label
   *  (e.g. "fast", "4.0 GB"). Greys out so the label still leads. */
  hint?: string;
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Wider menu max-height when the catalogue is long (timezones). */
  menuMaxHeight?: number;
}

/** Trigger style mirrors the wizard's other input fields so the dropdown
 *  reads as a sibling control, not a one-off pill. */
const TRIGGER_BASE: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '10px 36px 10px 12px',
  outline: 'none',
  width: '100%',
  letterSpacing: '-0.005em',
  transition:
    'border-color 0.16s var(--ease-out-quart), box-shadow 0.16s var(--ease-out-quart), background 0.16s var(--ease-out-quart)',
  textAlign: 'left',
  display: 'flex',
  alignItems: 'center',
};

export function Dropdown({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  disabled,
  menuMaxHeight = 280,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number>(() => {
    const idx = options.findIndex((o) => o.id === value);
    return idx >= 0 ? idx : 0;
  });
  // Cumulative type-ahead buffer; cleared 750 ms after the last keystroke.
  const typeBufferRef = useRef('');
  const typeTimerRef = useRef<number | null>(null);

  // Anchor for the menu positioning. Re-measured on open + on
  // window scroll/resize so the menu tracks if the wizard scrolls.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
    placeAbove: boolean;
  } | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [value, options],
  );

  /** Recompute trigger-anchor coords for the floating menu. */
  const measure = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const margin = 8;
    const desiredHeight = Math.min(menuMaxHeight, options.length * 36 + 12);
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const placeAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const top = placeAbove ? r.top - desiredHeight - 6 : r.bottom + 6;
    setMenuRect({
      top,
      left: r.left,
      width: r.width,
      placeAbove,
    });
  }, [menuMaxHeight, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  // Re-measure on viewport changes while the menu is open.
  useEffect(() => {
    if (!open) return;
    const handler = () => measure();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, measure]);

  // Click-outside / Esc to close.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: globalThis.MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // When opening, snap the active row to whatever's currently selected
  // so keyboard nav starts at "where you are" rather than the top.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.id === value);
    setActive(idx >= 0 ? idx : 0);
  }, [open, value, options]);

  const commit = (idx: number) => {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(active);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead jump. Each successive printable key extends the
      // buffer; 750 ms of inactivity resets it. Match is case-insensitive
      // against the start of the option label.
      typeBufferRef.current = (typeBufferRef.current + e.key).toLowerCase();
      if (typeTimerRef.current !== null) window.clearTimeout(typeTimerRef.current);
      typeTimerRef.current = window.setTimeout(() => {
        typeBufferRef.current = '';
        typeTimerRef.current = null;
      }, 750);
      const idx = options.findIndex((o) =>
        o.label.toLowerCase().startsWith(typeBufferRef.current),
      );
      if (idx >= 0) setActive(idx);
    }
  };

  const onRowMouseDown = (e: MouseEvent<HTMLButtonElement>, idx: number) => {
    // Prevent the trigger from losing focus on row click before we
    // commit (the click-outside listener would otherwise fire first).
    e.preventDefault();
    commit(idx);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        onFocus={(e) => {
          if (disabled) return;
          e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(196, 68, 68, 0.10)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--glass-border)';
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        style={{
          ...TRIGGER_BASE,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          color: selected ? 'var(--text-primary)' : 'var(--text-ghost)',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selected ? (
            selected.hint ? (
              <>
                <span>{selected.label}</span>
                <span style={{ color: 'var(--text-ghost)', marginLeft: 8 }}>
                  {selected.hint}
                </span>
              </>
            ) : (
              selected.label
            )
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            right: 12,
            transform: open
              ? 'translateY(-50%) rotate(180deg)'
              : 'translateY(-50%) rotate(0deg)',
            color: 'var(--text-ghost)',
            pointerEvents: 'none',
            transition: 'transform 0.18s var(--ease-out-quart)',
            opacity: disabled ? 0.4 : 1,
          }}
        />
      </button>

      {/* Portal — escape parent overflow / stacking. */}
      {createPortal(
        <AnimatePresence>
          {open && menuRect && (
            <motion.div
              ref={menuRef}
              role="listbox"
              initial={{
                opacity: 0,
                y: menuRect.placeAbove ? 6 : -6,
                scale: 0.97,
              }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{
                opacity: 0,
                y: menuRect.placeAbove ? 6 : -6,
                scale: 0.97,
              }}
              transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
              style={{
                position: 'fixed',
                top: menuRect.top,
                left: menuRect.left,
                width: menuRect.width,
                maxHeight: menuMaxHeight,
                overflowY: 'auto',
                background: 'var(--glass-bg-panel)',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
                border: '1px solid var(--glass-border-focus)',
                borderRadius: 12,
                padding: 6,
                boxShadow: [
                  '0 1px 0 rgba(255, 255, 255, 0.06) inset',
                  '0 16px 36px -10px rgba(0, 0, 0, 0.55)',
                  '0 6px 18px -6px rgba(0, 0, 0, 0.40)',
                ].join(', '),
                zIndex: 1000,
                transformOrigin: menuRect.placeAbove
                  ? 'bottom left'
                  : 'top left',
              }}
            >
              {options.map((opt, idx) => {
                const isSelected = opt.id === value;
                const isActive = idx === active;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(e) => onRowMouseDown(e, idx)}
                    onMouseEnter={() => setActive(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: isActive
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: 13.5,
                      cursor: 'pointer',
                      textAlign: 'left',
                      letterSpacing: '-0.005em',
                      transition: 'background 100ms var(--ease-out-quart)',
                    }}
                  >
                    <Check
                      size={12}
                      strokeWidth={2.4}
                      aria-hidden
                      style={{
                        flexShrink: 0,
                        color: 'var(--accent)',
                        opacity: isSelected ? 1 : 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          flexShrink: 0,
                          letterSpacing: '0.01em',
                        }}
                      >
                        {opt.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
