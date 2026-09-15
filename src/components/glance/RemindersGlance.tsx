// Reminders glance. Compact: what is on today, anything overdue first and
// then today's in time order, each with a check square that completes in
// place; with nothing today, the next thing coming up. Expanded: a month
// calendar with a dot under every day that has something on it (the
// danger tone when that day holds an overdue reminder) and, under it, the
// list: everything upcoming by default, or only the picked day. Picking
// the day again goes back to upcoming. Adding goes through the input bar:
// + drops a fill-in sentence there (services/reminderTemplate), on the
// picked day when there is one, and the chat creates the reminder. Rows
// in the expanded list show the place and details saved with it. Alerts
// and the spoken reminder live in hooks/useReminderAlerts.

import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion, type DragControls } from 'framer-motion';
import { Plus, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';

import { deleteReminder, type Reminder } from '../../services/reminders';
import { dayKey, formatClock, monthGrid, parseWhen, reminderDay } from '../../services/reminderSchedule';
import { GlanceSection, GLANCE_LABEL_STYLE, GLANCE_META_STYLE, GLANCE_ROW_STYLE } from './GlanceSection';

const TODAY_ROWS = 3;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  reminders: Reminder[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onComplete: (id: string) => void;
  /** A reminder was deleted here; the owner refetches. */
  onChanged: () => void;
  /** Start a reminder in the input bar, on `day` ("YYYY-MM-DD") if given. */
  onAdd?: (day?: string) => void;
  now: Date;
  panel?: ReactNode;
  /** Edit mode (GlanceColumn): header only, drag handle and remove. */
  editing?: boolean;
  dragControls?: DragControls;
  onRemove?: () => void;
  onLayout?: () => void;
}

type WhenMode = 'upcoming' | 'day' | 'today';

const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export const RemindersGlance = forwardRef<HTMLDivElement, Props>(function RemindersGlance(
  { reminders, open, onOpen, onClose, onComplete, onChanged, onAdd, now, editing, dragControls, onRemove },
  ref,
) {
  const reduce = useReducedMotion() ?? false;
  const todayKey = dayKey(now);
  const sorted = useMemo(() => sortForGlance(reminders), [reminders]);
  // Today = anything dated today or earlier that is still open.
  const today = sorted.filter((r) => { const k = reminderDay(r); return k != null && k <= todayKey; });
  const nextUp = sorted.find((r) => { const k = reminderDay(r); return k != null && k > todayKey; }) ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(now));
  useEffect(() => {
    if (open) return;
    setSelected(null);
    setViewMonth(firstOfMonth(new Date()));
  }, [open]);

  const byDay = useMemo(() => {
    const m = new Map<string, { count: number; overdue: boolean }>();
    for (const r of reminders) {
      const k = reminderDay(r);
      if (!k) continue;
      const e = m.get(k) ?? { count: 0, overdue: false };
      e.count += 1;
      if (whenFor(r, now, 'upcoming').overdue) e.overdue = true;
      m.set(k, e);
    }
    return m;
  }, [reminders, now]);

  const listed = selected ? sorted.filter((r) => reminderDay(r) === selected) : sorted;

  const pickDay = (key: string, date: Date) => {
    setSelected((cur) => (cur === key ? null : key));
    if (date.getMonth() !== viewMonth.getMonth() || date.getFullYear() !== viewMonth.getFullYear()) {
      setViewMonth(firstOfMonth(date));
    }
  };
  const shiftMonth = (delta: number) => {
    setViewMonth((m) => (delta === 0 ? firstOfMonth(new Date()) : new Date(m.getFullYear(), m.getMonth() + delta, 1)));
  };

  const rows = (items: Reminder[], deletable: boolean, mode: WhenMode) => items.map((r) => (
    <ReminderRow
      key={r.id}
      reminder={r}
      when={whenFor(r, now, mode)}
      onOpen={open ? undefined : onOpen}
      onComplete={onComplete}
      onDelete={deletable ? async () => { if (await deleteReminder(r.id)) onChanged(); } : undefined}
      showDetails={deletable}
    />
  ));

  const expanded = (
    <div>
      <MonthCalendar
        month={viewMonth}
        now={now}
        selected={selected}
        byDay={byDay}
        onPick={pickDay}
        onShift={shiftMonth}
      />
      <div style={{ ...GLANCE_LABEL_STYLE, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 3px' }}>
        <span style={{ flex: 1 }}>{selected ? dayTitle(selected, todayKey) : 'Upcoming'}</span>
        {selected && (
          <button
            type="button"
            onClick={() => setSelected(null)}
            style={{ ...GLANCE_META_STYLE, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-ghost)' }}
          >
            Show all
          </button>
        )}
      </div>
      <motion.div
        key={selected ?? 'upcoming'}
        initial={reduce ? false : { opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
      >
        {listed.length === 0 && (
          <Ghost>{selected ? 'Nothing on this day' : 'Nothing pending'}</Ghost>
        )}
        {rows(listed, true, selected ? 'day' : 'upcoming')}
      </motion.div>
      {onAdd && (
        <GhostButton onClick={() => onAdd(selected ?? undefined)} icon={<Plus size={12} strokeWidth={2.5} />}>
          {selected ? `Add on ${shortDay(selected)}` : 'Add a reminder'}
        </GhostButton>
      )}
    </div>
  );

  return (
    <GlanceSection
      editing={editing}
      dragControls={dragControls}
      onRemove={onRemove}
      ref={ref}
      label="Reminders"
      note={today.length > 0 ? String(today.length) : null}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      panel={expanded}
      action={onAdd && (
        <button
          type="button"
          data-sheet-trigger
          onClick={() => onAdd(open ? selected ?? undefined : undefined)}
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
      {today.length === 0 ? (
        <>
          <Ghost>Nothing today</Ghost>
          {nextUp && (
            <GhostButton onClick={onOpen}>
              Next: {whenFor(nextUp, now, 'upcoming').text}, {nextUp.title}
            </GhostButton>
          )}
        </>
      ) : (
        <>
          {rows(today.slice(0, TODAY_ROWS), false, 'today')}
          {today.length > TODAY_ROWS && (
            <GhostButton onClick={onOpen}>{today.length - TODAY_ROWS} more today</GhostButton>
          )}
        </>
      )}
    </GlanceSection>
  );
});

/** Month grid in the column's bare language: caps month label with
 *  previous and next, narrow weekday initials, then the days. Today has a
 *  hairline ring, the picked day a glass fill, days with reminders a dot. */
function MonthCalendar({
  month, now, selected, byDay, onPick, onShift,
}: {
  month: Date;
  now: Date;
  selected: string | null;
  byDay: Map<string, { count: number; overdue: boolean }>;
  onPick: (key: string, date: Date) => void;
  onShift: (delta: number) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const days = monthGrid(month);
  const todayKey = dayKey(now);
  const isThisMonth = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = days.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: 'narrow' }));
  const navStyle = {
    width: 22, height: 22, borderRadius: 6,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', padding: 0,
    color: 'var(--text-secondary)', cursor: 'pointer',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
  } as const;
  return (
    <div data-sheet-trigger style={{ padding: '0 2px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 0 4px 6px' }}>
        <span style={{ ...GLANCE_LABEL_STYLE, color: 'var(--text-secondary)', flex: 1 }}>{label}</span>
        {!isThisMonth && (
          <button
            type="button"
            onClick={() => onShift(0)}
            style={{ ...GLANCE_META_STYLE, background: 'transparent', border: 'none', padding: '0 6px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-ghost)' }}
          >
            Today
          </button>
        )}
        <button type="button" aria-label="Previous month" onClick={() => onShift(-1)} style={navStyle}>
          <ChevronLeft size={14} strokeWidth={2.2} />
        </button>
        <button type="button" aria-label="Next month" onClick={() => onShift(1)} style={navStyle}>
          <ChevronRight size={14} strokeWidth={2.2} />
        </button>
      </div>
      <motion.div
        key={`${month.getFullYear()}-${month.getMonth()}`}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
        role="grid"
        aria-label={label}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}
      >
        {weekdays.map((w, i) => (
          <span key={`wd${i}`} aria-hidden style={{ ...GLANCE_META_STYLE, textAlign: 'center', opacity: 0.5, padding: '0 0 3px', textShadow: 'var(--text-shadow-floating)' }}>
            {w}
          </span>
        ))}
        {days.map((d) => {
          const key = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const info = byDay.get(key);
          const isToday = key === todayKey;
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key, d)}
              aria-pressed={isSelected}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${info ? `, ${info.count} reminder${info.count === 1 ? '' : 's'}` : ''}`}
              style={{
                position: 'relative',
                height: 28,
                padding: 0,
                border: 'none',
                borderRadius: 8,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: isSelected || isToday ? 600 : 500,
                fontVariantNumeric: 'tabular-nums',
                cursor: 'pointer',
                color: isSelected || isToday ? 'var(--text-primary)' : inMonth ? 'var(--text-secondary)' : 'var(--text-ghost)',
                opacity: inMonth ? 1 : 0.45,
                background: isSelected ? 'var(--glass-bg-hover)' : 'transparent',
                boxShadow: isToday && !isSelected ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.28)' : 'none',
                textShadow: 'var(--text-shadow-floating)',
                transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              {d.getDate()}
              {info && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', left: '50%', bottom: 3,
                    width: 4, height: 4, marginLeft: -2, borderRadius: '50%',
                    background: info.overdue ? 'var(--danger)' : isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                />
              )}
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}

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

function ReminderRow({
  reminder, when, onOpen, onComplete, onDelete, showDetails = false,
}: {
  reminder: Reminder;
  when: { text: string; overdue: boolean };
  onOpen?: () => void;
  onComplete: (id: string) => void;
  onDelete?: () => void;
  /** Expanded list: the place and saved details under the time. */
  showDetails?: boolean;
}) {
  const details = showDetails ? [reminder.location, reminder.notes].filter((x) => x && x.trim()).join(' · ') : '';
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
        {details && (
          <span style={{ ...GLANCE_META_STYLE, textTransform: 'none', letterSpacing: '0.01em', opacity: 0.62, maxWidth: 196, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {details}
          </span>
        )}
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

/** The line under a reminder's title. Upcoming: glanceWhen ("Tomorrow,
 *  3 PM"). A single day: its time, or "All day". Today's compact list:
 *  times for today, the full date for anything overdue from earlier. */
function whenFor(r: Reminder, now: Date, mode: WhenMode): { text: string; overdue: boolean } {
  const w = parseWhen(r.when_iso);
  if (mode === 'upcoming' || !w) return glanceWhen(r.when_iso, now);
  const isToday = dayKey(w.at) === dayKey(now);
  if (mode === 'today' && !isToday) return glanceWhen(r.when_iso, now);
  if (w.dateOnly) return { text: 'All day', overdue: dayKey(w.at) < dayKey(now) };
  return { text: formatClock(w.at), overdue: w.at.getTime() < now.getTime() };
}

function dayTitle(key: string, todayKey: string): string {
  const d = new Date(`${key}T12:00:00`);
  const text = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return key === todayKey ? `Today, ${text}` : text;
}

function shortDay(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
