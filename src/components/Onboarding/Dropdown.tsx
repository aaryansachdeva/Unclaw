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
  /** Optional accent-tinted chip rendered between label and hint (e.g.
   *  "Optimized"). Used to mark options we've validated end-to-end so
   *  the user can pick with confidence. Legacy single-badge slot — use
   *  `badges` for multi-chip rendering. */
  badge?: string;
  /** Optional multi-chip slot for surfaces that need to show several
   *  capabilities at once (e.g. "Optimized" + "Vision"). Rendered in
   *  order, separated by a small gap. When set, supersedes `badge`. */
  badges?: ReadonlyArray<string>;
}


const BADGE_STYLE: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(196, 68, 68, 0.18)',
  color: 'var(--accent)',
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  flexShrink: 0,
};


function BadgeChips({ badges, marginLeft = 0 }: {
  badges: ReadonlyArray<string>;
  marginLeft?: number;
}) {
  return (
    <span style={{
      display: 'inline-flex',
      gap: 4,
      alignItems: 'center',
      flexShrink: 0,
      marginLeft,
    }}>
      {badges.map((b) => (
        <span key={b} style={BADGE_STYLE}>{b}</span>
      ))}
    </span>
  );
}


/** Resolve the effective chip list. `badges` wins; falls back to `badge`. */
function effectiveBadges(opt: DropdownOption): ReadonlyArray<string> {
  if (opt.badges && opt.badges.length > 0) return opt.badges;
  if (opt.badge) return [opt.badge];
  return [];
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Wider menu max-height when the catalogue is long (timezones). */
  menuMaxHeight?: number;
  /** Show a search input at the top of the menu that filters options
   *  by case-insensitive substring against label + id. Useful when the
   *  option list is long (e.g. live LLM model lists with 100+ entries).
   *  Disabled by default to preserve existing single-purpose dropdowns. */
  searchable?: boolean;
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
  searchable = false,
}: Props) {
  const [open, setOpen] = useState(false);
  // Search query — only used when `searchable` is true. Cleared every
  // time the menu opens so the user starts with the full list visible.
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Filtered subset of options. When not searchable OR query empty, the
  // full options array passes through. Keeps the active-index math + the
  // rendered rows on a single derived list, so the rest of the component
  // doesn't need to know whether search is on.
  const filteredOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q),
    );
  }, [options, searchable, query]);
  const [active, setActive] = useState<number>(() => {
    const idx = options.findIndex((o) => o.id === value);
    return idx >= 0 ? idx : 0;
  });
  // Cumulative type-ahead buffer; cleared 750 ms after the last keystroke.
  // Only active when searchable=false (otherwise the visible search input
  // takes that role and type-ahead in the trigger would be redundant).
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
  // so keyboard nav starts at "where you are" rather than the top. Reset
  // the search query so the user always sees the full list on (re)open.
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const idx = filteredOptions.findIndex((o) => o.id === value);
    setActive(idx >= 0 ? idx : 0);
  }, [open, value, filteredOptions]);

  // Auto-focus the search input on open so the user can start typing
  // immediately. Doesn't fire when searchable=false.
  useEffect(() => {
    if (!open || !searchable) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, searchable]);

  // Filter changes can move the active row past the end of the filtered
  // list. Clamp so highlighted row stays valid.
  useEffect(() => {
    if (filteredOptions.length === 0) {
      setActive(0);
      return;
    }
    setActive((i) => Math.min(i, filteredOptions.length - 1));
  }, [filteredOptions]);

  const commit = (idx: number) => {
    const opt = filteredOptions[idx];
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
      setActive((i) => Math.min(filteredOptions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(filteredOptions.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(active);
    } else if (!searchable && e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead jump (only when no visible search bar). Each successive
      // printable key extends the buffer; 750 ms of inactivity resets it.
      // Match is case-insensitive against the start of the option label.
      typeBufferRef.current = (typeBufferRef.current + e.key).toLowerCase();
      if (typeTimerRef.current !== null) window.clearTimeout(typeTimerRef.current);
      typeTimerRef.current = window.setTimeout(() => {
        typeBufferRef.current = '';
        typeTimerRef.current = null;
      }, 750);
      const idx = filteredOptions.findIndex((o) =>
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
            <>
              <span>{selected.label}</span>
              {effectiveBadges(selected).length > 0 && (
                <BadgeChips badges={effectiveBadges(selected)} marginLeft={8} />
              )}
              {selected.hint && (
                <span style={{ color: 'var(--text-ghost)', marginLeft: 8 }}>
                  {selected.hint}
                </span>
              )}
            </>
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
              {searchable && (
                <div
                  style={{
                    position: 'sticky',
                    top: -6,
                    margin: '-6px -6px 4px -6px',
                    padding: '8px 10px',
                    background: 'var(--glass-bg-panel)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    zIndex: 1,
                  }}
                >
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Forward nav keys to the same handler so the
                      // arrow / enter behavior matches the trigger.
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp'
                        || e.key === 'Enter' || e.key === 'Home'
                        || e.key === 'End' || e.key === 'Escape') {
                        // Reuse the trigger handler by casting target —
                        // simpler than duplicating the switch here.
                        onTriggerKey(e as unknown as KeyboardEvent<HTMLButtonElement>);
                      }
                    }}
                    placeholder="Search models…"
                    aria-label="Search options"
                    style={{
                      width: '100%',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: 12.5,
                      padding: '6px 10px',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
              {filteredOptions.length === 0 && (
                <div style={{
                  padding: '14px 12px',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                }}>
                  No matches
                </div>
              )}
              {filteredOptions.map((opt, idx) => {
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
                    {effectiveBadges(opt).length > 0 && (
                      <BadgeChips badges={effectiveBadges(opt)} />
                    )}
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
