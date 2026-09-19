// Shared pieces for editing a glance's own list in place (weather places,
// stock tickers): the inline search field, the "Add a ..." ghost row, the
// header + and the hover x. Same bare language as the reminders composer:
// no field chrome beyond a hairline, matches listed as ordinary glance
// rows that wake to glass under the pointer.
//
// The search debounces 250 ms and aborts the request it replaces. Enter
// takes the highlighted match (or `onRaw` when the typed text is valid on
// its own), the arrows move through matches, Escape closes without
// collapsing the section.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Plus, X, type LucideIcon } from 'lucide-react';

import { GLANCE_META_STYLE, GLANCE_ROW_STYLE } from './GlanceSection';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface GlanceSearchItem {
  key: string;
  primary: ReactNode;
  secondary?: string;
  icon?: LucideIcon;
}

interface SearchProps<T> {
  placeholder: string;
  ariaLabel: string;
  /** Resolves null when search is unreachable, [] for no matches. Keep the
   *  identity stable (a module-level function) so typing does not refire. */
  search: (q: string, signal: AbortSignal) => Promise<T[] | null>;
  toItem: (m: T) => GlanceSearchItem;
  onPick: (m: T) => void;
  /** Enter with no settled match: take the typed text itself. True = taken. */
  onRaw?: (text: string) => boolean;
  onCancel: () => void;
  /** Offered before anything is typed (e.g. "Use my location"). */
  idleItems?: T[];
  emptyHint?: string;
}

export function GlanceSearch<T>({
  placeholder, ariaLabel, search, toItem, onPick, onRaw, onCancel, idleItems, emptyHint = 'No matches',
}: SearchProps<T>) {
  const reduce = useReducedMotion() ?? false;
  const [text, setText] = useState('');
  const [matches, setMatches] = useState<T[]>([]);
  const [phase, setPhase] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const q = text.trim();
    if (!q) { setMatches([]); setPhase('idle'); setCursor(0); return undefined; }
    const ctl = new AbortController();
    setPhase('searching');
    const t = window.setTimeout(() => {
      void search(q, ctl.signal).then((rows) => {
        if (ctl.signal.aborted) return;
        setMatches(rows ?? []);
        setCursor(0);
        setPhase(rows == null ? 'error' : 'done');
      });
    }, 250);
    return () => { window.clearTimeout(t); ctl.abort(); };
  }, [text, search]);

  const typed = text.trim();
  const shown = typed ? matches : (idleItems ?? []);

  const take = () => {
    const pick = shown[cursor];
    if (pick !== undefined && (!typed || phase === 'done')) { onPick(pick); return; }
    if (typed) onRaw?.(typed);
  };

  return (
    <motion.div
      data-sheet-trigger
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT_EXPO }}
      style={{ padding: '0 0 6px' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        else if (e.key === 'Enter') { e.preventDefault(); take(); }
        else if (e.key === 'ArrowDown' && shown.length > 0) { e.preventDefault(); setCursor((c) => (c + 1) % shown.length); }
        else if (e.key === 'ArrowUp' && shown.length > 0) { e.preventDefault(); setCursor((c) => (c - 1 + shown.length) % shown.length); }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', outline: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.18)',
            padding: '0 0 3px',
            fontFamily: 'inherit', fontSize: 'calc(13px * var(--glance-text, 1))', fontWeight: 500,
            color: 'var(--text-primary)',
            textShadow: 'var(--text-shadow-floating)',
          }}
        />
        <button
          type="button"
          onClick={onCancel}
          style={{ ...GLANCE_META_STYLE, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-ghost)' }}
        >
          Cancel
        </button>
      </div>
      {typed && phase === 'searching' && matches.length === 0 && <Hint>Searching…</Hint>}
      {phase === 'error' && <Hint>Search is unavailable right now</Hint>}
      {phase === 'done' && matches.length === 0 && <Hint>{emptyHint}</Hint>}
      {shown.map((m, i) => {
        const it = toItem(m);
        const Icon = it.icon;
        const active = i === cursor;
        return (
          <button
            key={it.key}
            type="button"
            onMouseEnter={() => setCursor(i)}
            onClick={() => onPick(m)}
            style={{
              ...GLANCE_ROW_STYLE,
              width: '100%', textAlign: 'left', border: 'none',
              fontFamily: 'inherit', color: 'var(--text-primary)', cursor: 'pointer',
              background: active ? 'var(--glass-bg-hover)' : 'transparent',
            }}
          >
            {Icon && <Icon size={14} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.85 }} aria-hidden />}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 'calc(13px * var(--glance-text, 1))', fontWeight: 500, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.primary}
              </span>
              {it.secondary && (
                <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 196 }}>
                  {it.secondary}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </motion.div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '3px 8px 4px', fontSize: 'calc(12.5px * var(--glance-text, 1))', fontWeight: 500, color: 'var(--text-ghost)', textShadow: 'var(--text-shadow-floating)' }}>
      {children}
    </div>
  );
}

/** The "+ Add a ..." ghost row at the foot of an expanded list. */
export function GlanceAddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      data-sheet-trigger
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '4px 8px 5px', borderRadius: 8,
        background: 'transparent', border: 'none',
        fontFamily: 'inherit', fontSize: 'calc(12.5px * var(--glance-text, 1))', fontWeight: 500,
        color: 'var(--text-ghost)', cursor: 'pointer',
        textShadow: 'var(--text-shadow-floating)',
        transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-ghost)'; }}
    >
      <span aria-hidden style={{ display: 'inline-flex', opacity: 0.8 }}><Plus size={12} strokeWidth={2.5} /></span>
      {children}
    </button>
  );
}

/** The + beside a section label (the reminders header has the same one). */
export function GlanceHeaderAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-sheet-trigger
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 20, height: 20, borderRadius: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none',
        color: 'var(--text-secondary)', cursor: 'pointer',
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
        transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
    >
      <Plus size={13} strokeWidth={2.5} />
    </button>
  );
}

/** The x that appears on a hovered (or focused) row. */
export function GlanceRemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onClick={onClick}
      aria-label={`Remove ${label}`}
      title="Remove"
      style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', padding: 0,
        color: 'var(--text-ghost)', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-ghost)'; }}
    >
      <X size={12} strokeWidth={2.5} />
    </motion.button>
  );
}
