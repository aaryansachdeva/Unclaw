// Weather glance: the current conditions on one line and today's range
// under it. Expanded, the same bare-text language continues with the next
// hours and the five-day outlook as rows. Data from soul's free MET Norway
// path (services/weather), refreshed every 10 minutes.

import type { DragControls } from 'framer-motion';
import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Cloud, Sun, CloudRain, Snowflake, Zap, CloudFog, type LucideIcon } from 'lucide-react';

import { getWeather, type WeatherIcon, type WeatherPayload } from '../../services/weather';
import { GlanceSection, GlanceRow, GLANCE_META_STYLE, GLANCE_LABEL_STYLE } from './GlanceSection';

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  panel?: ReactNode;
  refreshKey: number;
  /** Edit mode (GlanceColumn): header only, drag handle and remove. */
  editing?: boolean;
  dragControls?: DragControls;
  onRemove?: () => void;
  onLayout?: () => void;
}

function iconFor(family: WeatherIcon): LucideIcon {
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
  { open, onOpen, onClose, refreshKey, onLayout, editing, dragControls, onRemove },
  ref,
) {
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'off'>('loading');
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++reqRef.current;
    const res = await getWeather();
    if (my !== reqRef.current) return;
    if (res.available && res.data) { setData(res.data); setState('ok'); }
    else { setState('off'); }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => { if (refreshKey > 0) void refresh(); }, [refreshKey, refresh]);
  useEffect(() => { onLayout?.(); }, [data, state, onLayout]);

  const cur = data?.current;
  const Icon = iconFor(cur?.icon ?? 'cloud');
  const today = data?.daily?.[0];

  const ghost = (text: string) => (
    <div style={{ padding: '3px 8px 6px', fontSize: 12.5, fontWeight: 500, color: 'var(--text-ghost)', textShadow: 'var(--text-shadow-floating)' }}>
      {text}
    </div>
  );

  const current = cur && (
    <GlanceRow onClick={open ? undefined : onOpen} ariaLabel="Open weather" align="flex-start">
      <Icon size={22} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))' }} aria-hidden />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{deg(cur.temp_c)}</span>
          {' '}{cur.condition}
          {Math.round(cur.feels_like_c) !== Math.round(cur.temp_c) && (
            <span style={{ color: 'var(--text-secondary)', opacity: 0.85 }}>, feels {deg(cur.feels_like_c)}</span>
          )}
        </span>
        {today && (
          <span style={GLANCE_META_STYLE}>
            H {deg(today.hi_c)} L {deg(today.lo_c)}{open && cur.wind_kph ? ` · wind ${Math.round(cur.wind_kph)} km/h` : ''}
          </span>
        )}
      </span>
    </GlanceRow>
  );

  const expanded = data && (
    <div>
      {current}
      {data.hourly.length > 1 && (
        <>
          <div style={{ ...GLANCE_LABEL_STYLE, padding: '10px 8px 3px' }}>Next hours</div>
          {data.hourly.slice(1, 9).map((h) => {
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
      {data.daily.length > 1 && (
        <>
          <div style={{ ...GLANCE_LABEL_STYLE, padding: '10px 8px 3px' }}>Next days</div>
          {data.daily.slice(1, 6).map((d) => {
            const DI = iconFor(d.icon);
            return (
              <GlanceRow key={d.date}>
                <span style={{ ...GLANCE_META_STYLE, minWidth: 34 }}>{dayLabel(d.date)}</span>
                <DI size={14} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.85 }} aria-hidden />
                <span style={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {deg(d.hi_c)} <span style={{ color: 'var(--text-secondary)' }}>{deg(d.lo_c)}</span>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.condition}</span>
              </GlanceRow>
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <GlanceSection ref={ref} label="Weather" note={data?.location ?? null} open={open} onOpen={onOpen} onClose={onClose} panel={expanded ?? undefined} editing={editing} dragControls={dragControls} onRemove={onRemove}>
      {state === 'loading' && !data && ghost('Checking the sky…')}
      {state === 'off' && !data && ghost('Weather unavailable')}
      {current}
    </GlanceSection>
  );
});

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
