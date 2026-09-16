// Popover for a value blank in the input bar's reminder template: a date
// (Today, Tomorrow, or a day on a small month grid; past days are off) or
// a time (a list in 30-minute steps, opened on the current value). It is
// rendered through a portal so the input bar's moving dock layer cannot
// offset it, anchored just above the clicked block. Picking hands back the
// new label; a mousedown outside closes it, and Escape is the input bar's.
// The panel never takes focus, so typing and Tab keep working in the box.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { dateLabel, parseDateLabel, parseTimeLabel, timeLabel } from '../services/reminderTemplate';
import { dayKey, monthGrid } from '../services/reminderSchedule';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  kind: 'date' | 'time';
  value: string;
  /** The clicked block's box, in viewport coordinates. */
  anchor: DOMRect;
  onPick: (label: string) => void;
  onClose: () => void;
  /** A mousedown here does not count as outside (the textarea). */
  ignore?: HTMLElement | null;
}

export function TemplateFieldPicker({ kind, value, anchor, onPick, onClose, ignore }: Props) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || ignore?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [ignore]);

  const width = kind === 'date' ? 248 : 132;
  const left = Math.max(8, Math.min(anchor.left - 8, window.innerWidth - width - 8));
  const bottom = window.innerHeight - anchor.top + 10;

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={kind === 'date' ? 'Choose a date' : 'Choose a time'}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT_EXPO }}
      // Keep the caret in the textarea: clicks here never move focus.
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left,
        bottom,
        width,
        zIndex: 1000,
        padding: 8,
        borderRadius: 14,
        background: 'rgba(40, 48, 65, 0.84)',
        backdropFilter: 'blur(32px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(32px) saturate(1.6)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 14px 36px -10px rgba(0, 0, 0, 0.55)',
        transformOrigin: 'bottom left',
        color: 'var(--text-primary)',
      }}
    >
      {kind === 'date' ? <DateChoices value={value} onPick={onPick} /> : <TimeChoices value={value} onPick={onPick} />}
    </motion.div>
  );
}

function DateChoices({ value, onPick }: { value: string; onPick: (label: string) => void }) {
  const now = new Date();
  const selected = parseDateLabel(value, now);
  const [month, setMonth] = useState(() => {
    const d = selected ?? now;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const todayKey = dayKey(now);
  const selectedKey = selected ? dayKey(selected) : null;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const days = monthGrid(month);
  const pick = (d: Date) => onPick(dateLabel(d, now));
  const monthName = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <Chip active={selectedKey === todayKey} onClick={() => pick(now)}>Today</Chip>
        <Chip active={selectedKey === dayKey(tomorrow)} onClick={() => pick(tomorrow)}>Tomorrow</Chip>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 0 4px 6px' }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {monthName}
        </span>
        <NavButton label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft size={14} strokeWidth={2.2} />
        </NavButton>
        <NavButton label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight size={14} strokeWidth={2.2} />
        </NavButton>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
        {days.slice(0, 7).map((d, i) => (
          <span key={`w${i}`} aria-hidden style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--text-ghost)', padding: '0 0 2px' }}>
            {d.toLocaleDateString(undefined, { weekday: 'narrow' })}
          </span>
        ))}
        {days.map((d) => {
          const key = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const past = key < todayKey;
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              disabled={past}
              onClick={() => pick(d)}
              aria-pressed={isSelected}
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              style={{
                height: 28,
                padding: 0,
                border: 'none',
                borderRadius: 8,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: isSelected || isToday ? 600 : 500,
                fontVariantNumeric: 'tabular-nums',
                cursor: past ? 'default' : 'pointer',
                color: isSelected || isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
                opacity: past ? 0.28 : inMonth ? 1 : 0.5,
                background: isSelected ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
                boxShadow: isToday && !isSelected ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.28)' : 'none',
                transition: 'background 0.15s var(--ease-out-quart)',
              }}
              onMouseEnter={(e) => { if (!past && !isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeChoices({ value, onPick }: { value: string; onPick: (label: string) => void }) {
  const selected = parseTimeLabel(value);
  const slots = useMemo(() => Array.from({ length: 48 }, (_, i) => i * 30), []);
  const listRef = useRef<HTMLDivElement>(null);

  // Open on the current value (or the nearest half hour), centred.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const target = selected == null ? 9 * 60 : Math.round(selected / 30) * 30;
    const row = list.querySelector<HTMLElement>(`[data-minutes="${target}"]`);
    if (row) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
  }, []);

  return (
    <div ref={listRef} className="no-scrollbar" style={{ position: 'relative', maxHeight: 220, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      {slots.map((minutes) => {
        const label = timeLabel(minutes);
        const active = selected === minutes;
        return (
          <button
            key={minutes}
            type="button"
            data-minutes={minutes}
            onClick={() => onPick(label)}
            aria-pressed={active}
            style={{
              display: 'block',
              width: '100%',
              padding: '5px 10px',
              border: 'none',
              borderRadius: 8,
              textAlign: 'left',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              fontVariantNumeric: 'tabular-nums',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: active ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
              cursor: 'pointer',
              transition: 'background 0.12s var(--ease-out-quart), color 0.12s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
            onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '5px 11px',
        border: 'none',
        borderRadius: 8,
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: 500,
        color: 'var(--text-primary)',
        background: active ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.07)',
        cursor: 'pointer',
        transition: 'background 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'; }}
    >
      {children}
    </button>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 24, height: 24, borderRadius: 6, padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none',
        color: 'var(--text-secondary)', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}
