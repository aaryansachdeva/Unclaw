// Reminders glance: the next two open reminders, each with a check square
// that completes in place, the title, and its date and time stacked under
// the title so the column stays narrow. Expanded, it is the same language
// with the whole list, a delete on hover, and a bare inline composer
// (title, optional time) instead of a form.

import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Plus, Check, X } from 'lucide-react';

import { createReminder, deleteReminder, type Reminder } from '../../services/reminders';
import { GlanceSection, GLANCE_META_STYLE, GLANCE_ROW_STYLE } from './GlanceSection';

const ROWS = 2;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  reminders: Reminder[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onComplete: (id: string) => void;
  /** A reminder was added or deleted here; the owner refetches. */
  onChanged: () => void;
  now: Date;
  panel?: ReactNode;
  onLayout?: () => void;
}

export const RemindersGlance = forwardRef<HTMLDivElement, Props>(function RemindersGlance(
  { reminders, open, onOpen, onClose, onComplete, onChanged, now },
  ref,
) {
  const list = sortForGlance(reminders);
  const [composing, setComposing] = useState(false);
  // Opening the section from the header + goes straight to composing.
  const openToCompose = () => { onOpen(); setComposing(true); };
  useEffect(() => { if (!open) setComposing(false); }, [open]);

  const rows = (items: Reminder[], deletable: boolean) => items.map((r) => (
    <ReminderRow
      key={r.id}
      reminder={r}
      when={glanceWhen(r.when_iso, now)}
      onOpen={open ? undefined : onOpen}
      onComplete={onComplete}
      onDelete={deletable ? async () => { if (await deleteReminder(r.id)) onChanged(); } : undefined}
    />
  ));

  const expanded = (
    <div>
      {list.length === 0 && !composing && (
        <Ghost>Nothing pending</Ghost>
      )}
      {rows(list, true)}
      {composing ? (
        <Composer
          onCancel={() => setComposing(false)}
          onSubmit={async (title, whenLocal) => {
            const made = await createReminder({ title, when_iso: whenLocal });
            if (made) { setComposing(false); onChanged(); }
            return !!made;
          }}
        />
      ) : (
        <GhostButton onClick={() => setComposing(true)} icon={<Plus size={12} strokeWidth={2.5} />}>
          Add a reminder
        </GhostButton>
      )}
    </div>
  );

  return (
    <GlanceSection
      ref={ref}
      label="Reminders"
      note={list.length > 0 ? String(list.length) : null}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      panel={expanded}
      action={(
        <button
          type="button"
          data-sheet-trigger
          onClick={open ? () => setComposing(true) : openToCompose}
          aria-label="Add a reminder"
          title="Add a reminder"
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
      )}
    >
      {list.length === 0 ? (
        <Ghost>Nothing pending</Ghost>
      ) : (
        <>
          {rows(list.slice(0, ROWS), false)}
          {list.length > ROWS && (
            <GhostButton onClick={onOpen}>{list.length - ROWS} more</GhostButton>
          )}
        </>
      )}
    </GlanceSection>
  );
});

function Ghost({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '3px 8px 6px', fontSize: 12.5, fontWeight: 500, color: 'var(--text-ghost)', textShadow: 'var(--text-shadow-floating)' }}>
      {children}
    </div>
  );
}

function GhostButton({ children, onClick, icon }: { children: ReactNode; onClick: () => void; icon?: ReactNode }) {
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
        color: 'var(--text-ghost)', cursor: 'pointer',
        textShadow: 'var(--text-shadow-floating)',
        transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-bg-hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-ghost)'; }}
    >
      {icon && <span aria-hidden style={{ display: 'inline-flex', opacity: 0.8 }}>{icon}</span>}
      {children}
    </button>
  );
}

/** Bare inline composer: a title line and an optional time, no field
 *  chrome beyond a hairline under the title. Enter adds, Escape cancels. */
function Composer({
  onSubmit, onCancel,
}: {
  onSubmit: (title: string, whenLocal: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const ok = await onSubmit(t, when);
    setBusy(false);
    if (ok) { setTitle(''); setWhen(''); }
  };
  const field = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    color: 'var(--text-primary)',
    textShadow: 'var(--text-shadow-floating)',
    padding: 0,
  } as const;
  return (
    <motion.div
      data-sheet-trigger
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
      style={{ padding: '4px 8px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        if (e.key === 'Enter') { e.preventDefault(); void submit(); }
      }}
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What should I remind you about?"
        aria-label="Reminder title"
        style={{
          ...field,
          fontSize: 13, fontWeight: 500,
          borderBottom: '1px solid rgba(255,255,255,0.18)',
          paddingBottom: 3,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="When"
          style={{ ...field, ...GLANCE_META_STYLE, textTransform: 'none', width: 'auto', colorScheme: 'dark', opacity: when ? 1 : 0.6 }}
        />
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onCancel} style={{ ...GLANCE_META_STYLE, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-ghost)' }}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { void submit(); }}
          disabled={!title.trim() || busy}
          style={{ ...GLANCE_META_STYLE, background: 'transparent', border: 'none', cursor: title.trim() ? 'pointer' : 'default', fontFamily: 'inherit', color: title.trim() ? 'var(--text-primary)' : 'var(--text-ghost)', opacity: 1 }}
        >
          Add
        </button>
      </div>
    </motion.div>
  );
}

function ReminderRow({
  reminder, when, onOpen, onComplete, onDelete,
}: {
  reminder: Reminder;
  when: { text: string; overdue: boolean };
  onOpen?: () => void;
  onComplete: (id: string) => void;
  onDelete?: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <div
      data-sheet-trigger
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...GLANCE_ROW_STYLE,
        alignItems: 'flex-start',
        padding: '4px 6px 4px 8px',
        background: hover ? 'var(--glass-bg-hover)' : 'transparent',
        opacity: checked ? 0.45 : 1,
      }}
    >
      <button
        type="button"
        aria-label={checked ? 'Completed' : `Complete ${reminder.title}`}
        aria-pressed={checked}
        onClick={() => { if (!checked) { setChecked(true); onComplete(reminder.id); } }}
        style={{
          width: 16, height: 16, borderRadius: 4.5, flexShrink: 0, marginTop: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: checked ? 'var(--live)' : 'transparent',
          border: `1.5px solid ${checked ? 'var(--live)' : hover ? 'var(--glass-border-focus)' : 'rgba(255,255,255,0.26)'}`,
          color: '#101214', cursor: checked ? 'default' : 'pointer', padding: 0,
          transition: 'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
        }}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-label={onOpen ? `Open reminders (${reminder.title})` : reminder.title}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
          textAlign: 'left', padding: 0,
          background: 'transparent', border: 'none',
          fontFamily: 'inherit', cursor: onOpen ? 'pointer' : 'default',
          color: 'var(--text-primary)',
          textDecoration: checked ? 'line-through' : 'none',
        }}
      >
        <span style={{ maxWidth: 196, fontSize: 13, fontWeight: 500, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {reminder.title}
        </span>
        <span style={{ ...GLANCE_META_STYLE, color: when.overdue ? 'var(--danger)' : 'var(--text-secondary)', opacity: when.overdue ? 1 : 0.8 }}>
          {when.text}
        </span>
      </button>
      <AnimatePresence>
        {onDelete && hover && (
          <motion.button
            type="button"
            key="delete"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={onDelete}
            aria-label={`Delete ${reminder.title}`}
            title="Delete"
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
        )}
      </AnimatePresence>
    </div>
  );
}

/** Soonest first; undated ("someday") reminders sink to the end. */
function sortForGlance(rs: Reminder[]): Reminder[] {
  const key = (r: Reminder) => {
    const t = r.when_iso ? new Date(r.when_iso).getTime() : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return [...rs].sort((a, b) => key(a) - key(b));
}

/** Compact "when": today shows the clock only, the next six days the
 *  weekday, later dates the month + day; undated is "someday". A timed
 *  reminder in the past is overdue. */
export function glanceWhen(iso: string, now: Date): { text: string; overdue: boolean } {
  if (!iso) return { text: 'Someday', overdue: false };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: 'Someday', overdue: false };
  const dateOnly = iso.length <= 10;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const clock = dateOnly ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const overdue = dateOnly ? dayDiff < 0 : d.getTime() < now.getTime();
  let day: string;
  if (dayDiff === 0) day = '';
  else if (dayDiff === 1) day = 'Tomorrow';
  else if (dayDiff > 1 && dayDiff < 7) day = d.toLocaleDateString(undefined, { weekday: 'short' });
  else day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (dayDiff === 0 && !clock) day = 'Today';
  return { text: [day, clock].filter(Boolean).join(', '), overdue };
}
