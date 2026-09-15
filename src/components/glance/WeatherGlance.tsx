// Weather glance: the current conditions on one line and today's range
// under it. With more than one place the line cycles through them the way
// stocks cycles its quotes, each named in the meta line. Expanded: the
// places (pick one to read its forecast, x on hover drops it), then the
// same bare-text detail with the next hours and the five-day outlook, and
// a place search to add more. Data from soul's free MET Norway path
// (services/weather), refreshed every 10 minutes; the places follow the
// account in user settings (glance.places). The detected place is always
// labelled "Current location", with the city soul resolved as its detail.

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type DragControls } from 'framer-motion';
import { Cloud, Sun, CloudRain, Snowflake, Zap, CloudFog, LocateFixed, type LucideIcon } from 'lucide-react';

import { getWeather, searchPlaces, type PlaceMatch, type WeatherIcon, type WeatherPayload } from '../../services/weather';
import type { AutoPlace, WeatherPlace } from '../../services/userSettings';
import { GlanceSection, GlanceRow, GLANCE_META_STYLE, GLANCE_LABEL_STYLE, GLANCE_ROW_STYLE } from './GlanceSection';
import { GlanceSearch, GlanceAddButton, GlanceHeaderAdd, GlanceRemoveButton } from './GlanceSearch';
import { useCycle } from './useCycle';

const CYCLE_MS = 6000;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
const MAX_PLACES = 8;
const HERE: AutoPlace = { id: 'here', auto: true };

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panel?: ReactNode;
  refreshKey: number;
  /** The user's places in cycle order; null or empty = the automatic one. */
  places?: WeatherPlace[] | null;
  /** Absent = the list is read-only here. */
  onPlacesChange?: (next: WeatherPlace[]) => void;
  /** Edit mode (GlanceColumn): header only, drag handle and remove. */
  editing?: boolean;
  dragControls?: DragControls;
  onRemove?: () => void;
  onLayout?: () => void;
}

type Slot = WeatherPayload | 'off';
type PlacePick = { kind: 'here' } | { kind: 'match'; m: PlaceMatch };
const HERE_PICKS: PlacePick[] = [{ kind: 'here' }];

const isAuto = (p: WeatherPlace): p is AutoPlace => 'auto' in p;

async function searchPicks(q: string, signal: AbortSignal): Promise<PlacePick[] | null> {
  const rows = await searchPlaces(q, signal);
  return rows ? rows.map((m) => ({ kind: 'match' as const, m })) : null;
}

function iconFor(family: WeatherIcon | undefined): LucideIcon {
  switch (family) {
    case 'sun': return Sun;
    case 'rain': return CloudRain;
    case 'snow': return Snowflake;
    case 'storm': return Zap;
    case 'fog': return CloudFog;
    default: return Cloud;
  }
}

const deg = (c: number | null | undefined) => (c == null ? '–' : `${Math.round(c)}°`);

export const WeatherGlance = forwardRef<HTMLDivElement, Props>(function WeatherGlance(
  { open, onOpen, onClose, refreshKey, onLayout, editing, dragControls, onRemove, places, onPlacesChange },
  ref,
) {
  const list = useMemo<WeatherPlace[]>(() => (places && places.length > 0 ? places : [HERE]), [places]);
  const listRef = useRef(list);
  listRef.current = list;
  const listKey = list.map((p) => (isAuto(p) ? p.id : `${p.id}@${p.lat},${p.lon}`)).join('|');

  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [hover, setHover] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++reqRef.current;
    const targets = listRef.current;
    // Every place at once: soul answers the ones it fetched in the last
    // 30 minutes from its cache, so only a newly added place costs a
    // real request.
    const results = await Promise.all(targets.map((p, i) => (isAuto(p)
      ? getWeather(undefined, { primary: i === 0 })
      : getWeather({ lat: p.lat, lon: p.lon }, { name: p.name, primary: i === 0 }))));
    if (my !== reqRef.current) return;
    setSlots((prev) => {
      const next: Record<string, Slot> = {};
      targets.forEach((p, i) => {
        const r = results[i];
        const last = prev[p.id];
        // A failed refresh keeps the last good forecast on screen.
        next[p.id] = r.available && r.data ? r.data : last && last !== 'off' ? last : 'off';
      });
      return next;
    });
  }, []);

  useEffect(() => { void refresh(); }, [listKey, refresh]);
  useEffect(() => {
    const id = window.setInterval(() => { void refresh(); }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => { if (refreshKey > 0) void refresh(); }, [refreshKey, refresh]);
  useEffect(() => { onLayout?.(); }, [slots, adding, onLayout]);
  useEffect(() => { if (!open) { setAdding(false); setSelectedId(null); } }, [open]);

  const dataOf = (p: WeatherPlace | undefined): WeatherPayload | null => {
    const s = p ? slots[p.id] : undefined;
    return s && s !== 'off' && s.current ? s : null;
  };
  const ready = list.filter((p) => dataOf(p) != null);
  const idx = useCycle(ready.length, CYCLE_MS, hover || open);
  const shown: WeatherPlace | undefined = ready[idx];
  const shownData = dataOf(shown);
  // Expanded opens on whichever place the line was showing.
  const selected = (open ? list.find((p) => p.id === selectedId) : undefined) ?? shown ?? list[0];
  const selData = dataOf(selected);
  const settled = list.every((p) => slots[p.id] !== undefined);
  const multi = list.length > 1;
  const canAdd = !!onPlacesChange && list.length < MAX_PLACES;
  const nameOf = (p: WeatherPlace) => (isAuto(p) ? 'Current location' : p.name);
  const subOf = (p: WeatherPlace) => (isAuto(p) ? dataOf(p)?.location : p.region);

  const addPick = (pick: PlacePick) => {
    setAdding(false);
    if (!onPlacesChange) return;
    if (pick.kind === 'here') {
      if (!list.some(isAuto)) onPlacesChange([HERE, ...list].slice(0, MAX_PLACES));
      setSelectedId(HERE.id);
      return;
    }
    const { m } = pick;
    const dup = list.find((p) => !isAuto(p) && Math.abs(p.lat - m.lat) < 0.05 && Math.abs(p.lon - m.lon) < 0.05);
    if (dup) { setSelectedId(dup.id); return; }
    const place: WeatherPlace = { id: `geo-${m.id}`, name: m.name, lat: m.lat, lon: m.lon, ...(m.region ? { region: m.region } : {}) };
    onPlacesChange([...list, place]);
    setSelectedId(place.id);
  };

  const removePlace = (id: string) => {
    if (!onPlacesChange || list.length <= 1) return;
    onPlacesChange(list.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const ghost = (text: string) => (
    <div style={{ padding: '3px 8px 6px', fontSize: 12.5, fontWeight: 500, color: 'var(--text-ghost)', textShadow: 'var(--text-shadow-floating)' }}>
      {text}
    </div>
  );

  const currentRow = (d: WeatherPayload, opts: { place?: string; clickable: boolean; detail: boolean }) => {
    const cur = d.current;
    const Icon = iconFor(cur.icon);
    const today = d.daily?.[0];
    const meta = [
      opts.place,
      today ? `H ${deg(today.hi_c)} L ${deg(today.lo_c)}` : null,
      opts.detail && cur.wind_kph ? `wind ${Math.round(cur.wind_kph)} km/h` : null,
    ].filter(Boolean).join(' · ');
    return (
      <GlanceRow onClick={opts.clickable ? onOpen : undefined} ariaLabel={opts.place ? `Open weather (${opts.place})` : 'Open weather'} align="flex-start">
        <Icon size={22} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))' }} aria-hidden />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{deg(cur.temp_c)}</span>
            {' '}{cur.condition}
            {Math.round(cur.feels_like_c) !== Math.round(cur.temp_c) && (
              <span style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>, feels {deg(cur.feels_like_c)}</span>
            )}
          </span>
          {meta && (
            /* The cycling line names its place, so it truncates; the
               expanded detail wraps instead (wind can be long). */
            <span style={!opts.detail ? { ...GLANCE_META_STYLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 } : GLANCE_META_STYLE}>
              {meta}
            </span>
          )}
        </span>
      </GlanceRow>
    );
  };

  const detail = (d: WeatherPayload, place?: string) => (
    <>
      {currentRow(d, { place, clickable: false, detail: true })}
      {(d.hourly?.length ?? 0) > 1 && (
        <>
          <div style={{ ...GLANCE_LABEL_STYLE, padding: '10px 8px 3px' }}>Next hours</div>
          {d.hourly.slice(1, 9).map((h) => {
            const HI = iconFor(h.icon);
            return (
              <GlanceRow key={h.ts}>
                <span style={{ ...GLANCE_META_STYLE, minWidth: 34 }}>{hourLabel(h.ts)}</span>
                <HI size={14} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.85 }} aria-hidden />
                <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>{deg(h.temp_c)}</span>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.condition}</span>
              </GlanceRow>
            );
          })}
        </>
      )}
      {(d.daily?.length ?? 0) > 1 && (
        <>
          <div style={{ ...GLANCE_LABEL_STYLE, padding: '10px 8px 3px' }}>Next days</div>
          {d.daily.slice(1, 6).map((day) => {
            const DI = iconFor(day.icon);
            return (
              <GlanceRow key={day.date}>
                <span style={{ ...GLANCE_META_STYLE, minWidth: 34 }}>{dayLabel(day.date)}</span>
                <DI size={14} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.85 }} aria-hidden />
                <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {deg(day.hi_c)} <span style={{ color: 'var(--text-secondary)' }}>{deg(day.lo_c)}</span>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{day.condition}</span>
              </GlanceRow>
            );
          })}
        </>
      )}
    </>
  );

  const expanded = (
    <div>
      {adding && (
        <GlanceSearch<PlacePick>
          placeholder="City or town"
          ariaLabel="Search for a place"
          search={searchPicks}
          idleItems={list.some(isAuto) ? undefined : HERE_PICKS}
          toItem={(pick) => (pick.kind === 'here'
            ? { key: 'here', primary: 'Use my location', secondary: 'Your profile city or network', icon: LocateFixed }
            : { key: pick.m.id, primary: pick.m.name, secondary: pick.m.region || undefined })}
          onPick={addPick}
          onCancel={() => setAdding(false)}
          emptyHint="No places by that name"
        />
      )}
      {multi && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ ...GLANCE_LABEL_STYLE, padding: '2px 8px 3px' }}>Places</div>
          {list.map((p) => (
            <PlaceRow
              key={p.id}
              name={nameOf(p)}
              sub={subOf(p)}
              data={dataOf(p)}
              off={slots[p.id] === 'off'}
              selected={p.id === selected.id}
              onSelect={() => setSelectedId(p.id)}
              onRemove={onPlacesChange ? () => removePlace(p.id) : undefined}
            />
          ))}
          <div style={{ ...GLANCE_LABEL_STYLE, padding: '10px 8px 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[nameOf(selected), isAuto(selected) ? subOf(selected) : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}
      {selData ? detail(selData, !multi && isAuto(selected) ? nameOf(selected) : undefined) : ghost(slots[selected.id] === 'off' ? 'Weather unavailable' : 'Checking the sky…')}
      {canAdd && !adding && (
        <div style={{ marginTop: 6 }}>
          <GlanceAddButton onClick={() => setAdding(true)}>Add a place</GlanceAddButton>
        </div>
      )}
    </div>
  );

  return (
    <GlanceSection
      ref={ref}
      label="Weather"
      note={multi ? null : shownData?.location ?? null}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      panel={expanded}
      editing={editing}
      dragControls={dragControls}
      onRemove={onRemove}
      action={canAdd ? (
        <GlanceHeaderAdd label="Add a place" onClick={() => { if (!open) onOpen(); setAdding(true); }} />
      ) : undefined}
    >
      {!shownData && !settled && ghost('Checking the sky…')}
      {!shownData && settled && ghost('Weather unavailable')}
      {shown && shownData && (
        /* One place at a time, cross-fading every few seconds; pauses under
           the pointer so it can be read. A single place never animates. */
        <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={shown.id}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            >
              {currentRow(shownData, { place: multi || isAuto(shown) ? nameOf(shown) : undefined, clickable: true, detail: false })}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </GlanceSection>
  );
});

/** One place in the expanded list: icon, temperature, name with its city or
 *  region under it. Selecting it
 *  swaps the detail below; the x appears on hover or keyboard focus. */
function PlaceRow({
  name, sub, data, off, selected, onSelect, onRemove,
}: {
  name: string;
  sub?: string;
  data: WeatherPayload | null;
  off: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const Icon = iconFor(data?.current?.icon);
  return (
    <div
      data-sheet-trigger
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(false); }}
      style={{ ...GLANCE_ROW_STYLE, padding: '3px 6px 3px 8px', background: hover ? 'var(--glass-bg-hover)' : 'transparent' }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Show the weather for ${name}`}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: 0, background: 'transparent', border: 'none',
          fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
          color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
          opacity: selected ? 1 : 0.62,
          transition: 'color 0.15s var(--ease-out-quart), opacity 0.15s var(--ease-out-quart)',
        }}
      >
        <Icon size={14} strokeWidth={2} style={{ flexShrink: 0, opacity: data ? 0.9 : 0.4 }} aria-hidden />
        <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>
          {data ? deg(data.current.temp_c) : off ? deg(null) : '…'}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: selected ? 600 : 500, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          {sub && (
            <span style={{ ...GLANCE_META_STYLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
          )}
        </span>
      </button>
      <AnimatePresence>
        {onRemove && hover && <GlanceRemoveButton key="remove" label={name} onClick={onRemove} />}
      </AnimatePresence>
    </div>
  );
}

function hourLabel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h >= 12 ? 'PM' : 'AM'}`;
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}
