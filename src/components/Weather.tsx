// Weather widget shaped after the same mobile-tab pattern as Reminders:
//
//   collapsed     [cloud] Weather  72°                    (small pill)
//   click ↓
//   expanded     ┌──────────────────────────────────┐
//                │ [pin] Los Angeles                │
//                │  72°C  Partly cloudy             │
//                │  ── hourly strip ──              │
//                │  3pm 4pm 5pm 6pm 7pm ...         │
//                │  ── daily ──                     │
//                │  Tue  73° / 60°  Cloudy          │
//                │  ...                             │
//                └──────────────────────────────────┘
//                [cloud] Weather                   [×]
//
// Grows UPWARD (absolute, bottom: 100% + 8px) from the pill so the bottom
// row never reflows. The renderer hides the whole widget when soul returns
// 404 on /weather (older deploys), matching the Reminders fallback.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cloud, Sun, CloudRain, Snowflake, Zap, CloudFog,
  MapPin, Wind, X,
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import {
  getWeather,
  WeatherIcon,
  WeatherPayload,
} from '../services/weather';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface WeatherProps {
  /** Bumping this number forces a refetch (chat round side effects). */
  refreshKey?: number;
  /** Controlled open/close. App.tsx lifts this so only one widget panel
   *  can be expanded at a time. */
  isOpen?: boolean;
  onToggle?: () => void;
}

export function Weather({ refreshKey = 0, isOpen, onToggle }: WeatherProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = onToggle ?? (() => setInternalOpen(o => !o));
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    const res = await getWeather();
    if (myReq !== reqIdRef.current) return;
    setAvailable(res.available);
    setData(res.available && res.data ? res.data : null);
  }, []);

  // Initial fetch + on-mount poll. Soul caches upstream for 5 min so this
  // is cheap. Refresh every 10 min while mounted.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Refetch when the host signals an external mutation (currently unused;
  // wired for symmetry with Reminders).
  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  if (available === false) return null;
  if (available === null) return null;
  if (!data) return null;

  return (
    <div style={{ position: 'relative' }}>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 0,
              width: 360,
              maxHeight: '60vh',
              overflowY: 'auto',
              padding: 16,
              borderRadius: 16,
              background: 'var(--glass-bg-panel)',
              backdropFilter: 'var(--glass-blur)',
              WebkitBackdropFilter: 'var(--glass-blur)',
              border: '1px solid var(--glass-border-focus)',
              boxShadow: [
                '0 1px 0 rgba(255, 255, 255, 0.06) inset',
                '0 16px 36px -10px rgba(0, 0, 0, 0.45)',
              ].join(', '),
              pointerEvents: 'auto',
            }}
          >
            <ExpandedPanel data={data} />
          </motion.div>
        )}
      </AnimatePresence>

      <Pill
        open={open}
        tempC={data.current.temp_c}
        icon={data.current.icon}
        onToggle={setOpen}
      />
    </div>
  );
}

// ---------- pill ------------------------------------------------------

function Pill({
  open, tempC, icon, onToggle,
}: {
  open: boolean;
  tempC: number;
  icon: WeatherIcon;
  onToggle: () => void;
}) {
  const Icon = iconFor(icon);
  const [hover, setHover] = useState(false);
  const surfaceOn = hover || open;
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-expanded={open}
      aria-label={open ? 'Close weather' : 'Open weather'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        height: 40,
        borderRadius: 14,
        background: surfaceOn
          ? (open ? 'var(--glass-bg-hover)' : 'var(--glass-bg)')
          : 'transparent',
        backdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
        WebkitBackdropFilter: surfaceOn ? 'var(--glass-blur)' : 'none',
        border: `1px solid ${
          surfaceOn ? (open ? 'var(--glass-border-focus)' : 'var(--glass-border)') : 'transparent'
        }`,
        boxShadow: surfaceOn
          ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 12px rgba(0,0,0,0.25)'
          : 'none',
        cursor: 'pointer',
        transition:
          'background 0.2s var(--ease-out-quart), border-color 0.2s var(--ease-out-quart), box-shadow 0.2s var(--ease-out-quart)',
      }}
    >
      <Icon
        size={14}
        strokeWidth={2}
        color="var(--text-primary)"
        aria-hidden
        style={{
          filter: surfaceOn ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--text-primary)',
          textShadow: surfaceOn ? 'none' : '0 1px 2px rgba(0,0,0,0.55)',
        }}
      >
        Weather
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          minWidth: 26,
          textAlign: 'right',
          textShadow: surfaceOn ? 'none' : '0 1px 2px rgba(0,0,0,0.55)',
        }}
      >
        {Math.round(tempC)}°
      </span>
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          marginLeft: 2,
          color: 'var(--text-ghost)',
        }}
      >
        {open ? <X size={11} strokeWidth={2.4} /> : null}
      </span>
    </motion.button>
  );
}

// ---------- expanded panel -------------------------------------------

function ExpandedPanel({ data }: { data: WeatherPayload }) {
  const CurIcon = iconFor(data.current.icon);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Location + current temp summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <MapPin size={13} strokeWidth={2.2} color="var(--text-secondary)" />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            letterSpacing: '0.01em',
          }}
        >
          {data.location}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <CurIcon size={44} strokeWidth={1.6} color="var(--text-primary)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 34,
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
            }}
          >
            {Math.round(data.current.temp_c)}°
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {data.current.condition}
          </div>
        </div>
        {typeof data.current.wind_kph === 'number' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 500,
            }}
            title="Wind speed"
          >
            <Wind size={13} strokeWidth={2.2} />
            <span>{Math.round(data.current.wind_kph)} kph</span>
          </div>
        )}
      </div>

      {/* Hourly strip */}
      {data.hourly.length > 0 && (
        <div>
          <SectionLabel>Hourly</SectionLabel>
          <div
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              paddingBottom: 4,
            }}
          >
            {data.hourly.map(h => (
              <HourlyCell key={h.ts} hour={h} />
            ))}
          </div>
        </div>
      )}

      {/* Daily list */}
      {data.daily.length > 0 && (
        <div>
          <SectionLabel>Forecast</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.daily.map((d, i) => (
              <DailyRow key={d.date} day={d} isToday={i === 0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 8,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </div>
  );
}

function HourlyCell({ hour }: { hour: WeatherPayload['hourly'][number] }) {
  const Icon = iconFor(hour.icon);
  return (
    <div
      style={{
        flex: '0 0 auto',
        width: 56,
        padding: '9px 6px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          letterSpacing: '0.02em',
        }}
      >
        {formatHour(hour.ts)}
      </span>
      <Icon size={18} strokeWidth={1.8} color="var(--text-primary)" />
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        {hour.temp_c == null ? '—' : `${Math.round(hour.temp_c)}°`}
      </span>
    </div>
  );
}

function DailyRow({
  day, isToday,
}: {
  day: WeatherPayload['daily'][number];
  isToday: boolean;
}) {
  const Icon = iconFor(day.icon);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)',
      }}
    >
      <span
        style={{
          width: 52,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {formatDayLabel(day.date, isToday)}
      </span>
      <Icon size={18} strokeWidth={1.8} color="var(--text-secondary)" />
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {day.condition}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
        }}
      >
        {day.hi_c == null ? '—' : `${Math.round(day.hi_c)}°`}
        <span style={{ color: 'var(--text-secondary)', marginLeft: 5, fontWeight: 500 }}>
          / {day.lo_c == null ? '—' : `${Math.round(day.lo_c)}°`}
        </span>
      </span>
    </div>
  );
}

// ---------- helpers --------------------------------------------------

function iconFor(family: WeatherIcon): LucideIcon {
  switch (family) {
    case 'sun':   return Sun;
    case 'cloud': return Cloud;
    case 'rain':  return CloudRain;
    case 'snow':  return Snowflake;
    case 'storm': return Zap;
    case 'fog':   return CloudFog;
    default:      return Cloud;
  }
}

function formatHour(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 13) + 'h';
  const h = d.getHours();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

function formatDayLabel(dateStr: string, isToday: boolean): string {
  if (isToday) return 'Today';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}
