// Reminders panel content. Wrapped by SheetPanel; no longer owns
// open/close state or its own surface — everything that was inside
// the old expanded glass card lives here, and the dock's widget icon
// is the trigger.
//
// Talks to soul.exe `/reminders*`. The `available` flag silently
// hides the body when the soul build doesn't expose those endpoints.

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Check, ChevronRight } from 'lucide-react';
import {
  Reminder,
  createReminder,
  deleteReminder as apiDeleteReminder,
  completeReminder as apiCompleteReminder,
  listReminders,
} from '../services/reminders';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface RemindersPanelProps {
  /** Bumping this number forces a refetch (e.g. after a chat round
   *  that may have created or modified reminders via tool calls). */
  refreshKey?: number;
  /** Called whenever the reminder count changes — lets the dock
   *  badge stay in sync without re-querying the service itself. */
  onCountChange?: (count: number) => void;
}

export function RemindersPanel({
  refreshKey = 0,
  onCountChange,
}: RemindersPanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    const result = await listReminders();
    if (myReq !== reqIdRef.current) return;
    setAvailable(result.available);
    setReminders(result.available
      ? result.reminders.filter(r => !r.completed_at)
      : []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  // Bubble count up so the dock badge can show it.
  useEffect(() => {
    onCountChange?.(reminders.length);
  }, [reminders.length, onCountChange]);

  const handleCreate = useCallback(async (input: {
    title: string; when_iso: string; location: string; notes: string;
  }) => {
    const created = await createReminder(input);
    if (created) setReminders(prev => [...prev, created]);
    setComposeOpen(false);
  }, []);

  const markPending = useCallback((id: string, on: boolean) => {
    setPending(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const handleComplete = useCallback(async (id: string) => {
    markPending(id, true);
    setReminders(prev => prev.map(r => r.id === id
      ? { ...r, completed_at: new Date().toISOString() }
      : r,
    ));
    const ok = await apiCompleteReminder(id);
    if (ok) {
      window.setTimeout(() => {
        setReminders(prev => prev.filter(r => r.id !== id));
        markPending(id, false);
      }, 600);
    } else {
      setReminders(prev => prev.map(r => r.id === id
        ? { ...r, completed_at: null }
        : r,
      ));
      markPending(id, false);
    }
  }, [markPending]);

  const handleDelete = useCallback(async (id: string) => {
    markPending(id, true);
    const ok = await apiDeleteReminder(id);
    if (ok) setReminders(prev => prev.filter(r => r.id !== id));
    markPending(id, false);
  }, [markPending]);

  const toggleDay = useCallback((dayKey: string) => {
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }, []);

  const groups = useMemo(() => groupByDay(reminders), [reminders]);

  if (available === false) return <UnavailableState />;
  if (available === null) return null;

  const count = reminders.length;

  return (
    <div>
      {/* Header row — the SheetPanel already shows the title, so we
          just need the inline "+ new" affordance here. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          {count > 0 ? `${count} active` : 'No reminders'}
        </span>
        <motion.button
          type="button"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setComposeOpen(o => !o)}
          aria-label={composeOpen ? 'Cancel new reminder' : 'New reminder'}
          className="glass-btn"
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: composeOpen
              ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
              : 'rgba(255,255,255,0.08)',
            color: composeOpen ? 'var(--accent)' : 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.12)',
            transition: 'background 0.2s var(--ease-out-quart)',
          }}
        >
          <Plus
            size={12}
            strokeWidth={2.4}
            style={{
              transform: composeOpen ? 'rotate(45deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s var(--ease-out-quart)',
            }}
          />
        </motion.button>
      </div>

      <AnimatePresence initial={false}>
        {composeOpen && (
          <ComposeForm
            key="compose"
            onSubmit={handleCreate}
            onCancel={() => setComposeOpen(false)}
          />
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {count === 0 && !composeOpen ? (
          <EmptyState />
        ) : (
          groups.map((g, gi) => (
            <DayGroup
              key={g.key}
              label={g.label}
              items={g.items}
              collapsed={collapsedDays.has(g.key)}
              onToggle={() => toggleDay(g.key)}
              pending={pending}
              onComplete={handleComplete}
              onDelete={handleDelete}
              groupIndex={gi}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------- day groups ------------------------------------------------

interface DayGroupProps {
  label: string;
  items: Reminder[];
  collapsed: boolean;
  onToggle: () => void;
  pending: Set<string>;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  groupIndex: number;
}

function DayGroup({
  label, items, collapsed, onToggle,
  pending, onComplete, onDelete, groupIndex,
}: DayGroupProps) {
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 0 4px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        <motion.span
          aria-hidden
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={{ duration: 0.15 }}
          style={{ display: 'inline-flex', color: 'var(--text-secondary)' }}
        >
          <ChevronRight size={12} strokeWidth={2.2} />
        </motion.span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          {label}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.map((r, i) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  isPending={pending.has(r.id)}
                  onComplete={() => onComplete(r.id)}
                  onDelete={() => onDelete(r.id)}
                  // Stagger entrance only for the first 8 across the
                  // whole panel — beyond that it stops feeling
                  // intentional and starts feeling slow.
                  staggerDelay={Math.min(0.04 * (groupIndex * 4 + i), 0.32)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- row -------------------------------------------------------

function ReminderRow({
  reminder, isPending, onComplete, onDelete, staggerDelay,
}: {
  reminder: Reminder;
  isPending: boolean;
  onComplete: () => void;
  onDelete: () => void;
  staggerDelay: number;
}) {
  const [hover, setHover] = useState(false);
  const isComplete = !!reminder.completed_at;
  const overdue = isOverdue(reminder.when_iso);
  const subtitle = formatRowSubtitle(reminder);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: isComplete ? 0.45 : 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
      transition={{ duration: 0.22, delay: staggerDelay, ease: EASE_OUT_EXPO }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 13px',
        borderRadius: 10,
        background: hover ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)',
        border: `1px solid ${hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
        transition:
          'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
      }}
    >
      <motion.button
        type="button"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.92 }}
        disabled={isPending}
        onClick={onComplete}
        aria-label={`Mark "${reminder.title}" complete`}
        className="glass-btn"
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          borderRadius: 5,
          background: isComplete
            ? 'color-mix(in srgb, var(--live) 35%, transparent)'
            : 'transparent',
          border: `1.5px solid ${isComplete ? 'var(--live)' : 'rgba(255,255,255,0.35)'}`,
          color: 'var(--live)',
          padding: 0,
        }}
      >
        {isComplete && <Check size={11} strokeWidth={3} />}
      </motion.button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: 'var(--text-primary)',
            textDecoration: isComplete ? 'line-through' : 'none',
            opacity: isComplete ? 0.6 : 1,
            lineHeight: 1.35,
            wordBreak: 'break-word',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            letterSpacing: '-0.01em',
          }}
        >
          {reminder.title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              fontWeight: 500,
              color: overdue && !isComplete ? 'var(--danger)' : 'var(--text-secondary)',
              opacity: isComplete ? 0.5 : 1,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>

      <AnimatePresence>
        {hover && !isComplete && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.12 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            disabled={isPending}
            onClick={onDelete}
            aria-label={`Delete "${reminder.title}"`}
            className="glass-btn"
            style={{
              flexShrink: 0,
              width: 18,
              height: 18,
              borderRadius: 5,
              background: 'transparent',
              color: 'var(--text-ghost)',
              padding: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--danger)';
              e.currentTarget.style.background =
                'color-mix(in srgb, var(--danger) 14%, transparent)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--text-ghost)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <X size={11} strokeWidth={2.4} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------- empty / unavailable --------------------------------------

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        padding: '14px 4px 6px 4px',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
      }}
    >
      Ask the agent to add a reminder, or press the{' '}
      <Plus size={11} style={{ display: 'inline', verticalAlign: 'baseline' }} />{' '}
      to add one yourself.
    </motion.div>
  );
}

function UnavailableState() {
  return (
    <div
      style={{
        padding: '14px 4px',
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}
    >
      Reminders aren't available on this build of soul.
    </div>
  );
}

// ---------- compose form ---------------------------------------------

interface ComposeFormProps {
  onSubmit: (input: { title: string; when_iso: string;
                       location: string; notes: string }) => void;
  onCancel: () => void;
}

function ComposeForm({ onSubmit, onCancel }: ComposeFormProps) {
  const [title, setTitle] = useState('');
  const [whenLocal, setWhenLocal] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    onSubmit({
      title: t,
      when_iso: whenLocal,
      location: location.trim(),
      notes: notes.trim(),
    });
  }, [title, whenLocal, location, notes, onSubmit]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
      style={{ overflow: 'hidden', marginBottom: 8 }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 10,
          borderRadius: 10,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--glass-border)',
        }}
      >
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          placeholder="Reminder title"
          style={inputStyle}
        />
        <input
          type="datetime-local"
          value={whenLocal}
          onChange={e => setWhenLocal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          style={{ ...inputStyle, colorScheme: 'dark' }}
        />
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          placeholder="Location (optional)"
          style={inputStyle}
        />
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          placeholder="Notes (optional)"
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            className="glass-btn"
            style={{
              padding: '5px 10px',
              borderRadius: 7,
              background: 'transparent',
              color: 'var(--text-ghost)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim()}
            className="glass-btn"
            style={{
              padding: '5px 12px',
              borderRadius: 7,
              background: title.trim()
                ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
                : 'rgba(255,255,255,0.04)',
              color: title.trim() ? 'var(--accent)' : 'var(--text-ghost)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              opacity: title.trim() ? 1 : 0.45,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </motion.div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 7,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--glass-border)',
  color: 'var(--text-primary)',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};

// ---------- helpers --------------------------------------------------

interface DayBucket {
  key: string;
  label: string;
  items: Reminder[];
}

function groupByDay(rs: Reminder[]): DayBucket[] {
  const withTime = rs.filter(r => !!r.when_iso).slice().sort(
    (a, b) => a.when_iso.localeCompare(b.when_iso),
  );
  const noTime = rs.filter(r => !r.when_iso).slice().sort(
    (a, b) => a.created_at.localeCompare(b.created_at),
  );

  const buckets = new Map<string, DayBucket>();
  for (const r of withTime) {
    const d = parseLocal(r.when_iso);
    if (!d) {
      addToBucket(buckets, 'no-date', 'Someday', r);
      continue;
    }
    const k = dayKey(d);
    addToBucket(buckets, k, dayLabel(d), r);
  }
  for (const r of noTime) {
    addToBucket(buckets, 'no-date', 'Someday', r);
  }
  return Array.from(buckets.values());
}

function addToBucket(
  m: Map<string, DayBucket>, key: string, label: string, r: Reminder,
): void {
  const b = m.get(key);
  if (b) b.items.push(r);
  else m.set(key, { key, label, items: [r] });
}

function parseLocal(whenIso: string): Date | null {
  if (!whenIso) return null;
  const d = new Date(whenIso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);

  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === tomorrow.getTime()) return 'Tomorrow';

  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays > 0 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  if (diffDays < 0 && diffDays > -7) {
    return d.toLocaleDateString(undefined, { weekday: 'long' }) + ' (past)';
  }

  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatRowSubtitle(r: Reminder): string {
  // Subtitle stacks meta info in a compact line: time, then location
  // (prefixed with "@"), then notes. Each piece is optional, separators
  // appear only between non-empty pieces. Examples:
  //   "9am @ Dr. Lim's office - bring insurance card"
  //   "@ Zoom"
  //   "3pm - call back"
  const time = formatClockOnly(r.when_iso);
  const location = (r.location ?? '').trim();
  const notes = (r.notes ?? '').trim();
  const head = location ? (time ? `${time} @ ${location}` : `@ ${location}`)
                          : time;
  if (head && notes) return `${head} - ${notes}`;
  return head || notes;
}

function formatClockOnly(whenIso: string): string {
  const d = parseLocal(whenIso);
  if (!d) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (m === 0) return `${h12}${ampm}`;
  return `${h12}:${m.toString().padStart(2, '0')}${ampm}`;
}

function isOverdue(whenIso: string): boolean {
  const d = parseLocal(whenIso);
  if (!d) return false;
  return d.getTime() < Date.now();
}
