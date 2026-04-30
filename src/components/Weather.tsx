// Weather panel content. Wrapped by SheetPanel; auto-refreshes every
// 10 min on mount (soul caches upstream for 5 min).

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Cloud, Sun, CloudRain, Snowflake, Zap, CloudFog,
  MapPin, Wind,
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';
import {
  getWeather,
  WeatherIcon,
  WeatherPayload,
} from '../services/weather';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface WeatherPanelProps {
  refreshKey?: number;
}

export function WeatherPanel({ refreshKey = 0 }: WeatherPanelProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [data, setData] = useState<WeatherPayload | null>(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    const res = await getWeather();
    if (myReq !== reqIdRef.current) return;
    setAvailable(res.available);
    setData(res.available && res.data ? res.data : null);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refreshKey, refresh]);

  if (available === false) {
    return (
      <div style={unavailableStyle}>
        Weather isn't available on this build of soul.
      </div>
    );
  }
  if (available === null) return null;
  if (!data) return null;

  const CurIcon = iconFor(data.current.icon);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <MapPin size={13} strokeWidth={2.2} color="var(--text-secondary)" />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-secondary)',
          }}
        >
          {data.location}
        </span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.04, ease: EASE_OUT_EXPO }}
        style={{ display: 'flex', alignItems: 'center', gap: 14 }}
      >
        <CurIcon size={44} strokeWidth={1.6} color="var(--text-primary)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.05,
              letterSpacing: '-0.01em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {/* Larger temperature than the type scale technically allows
                — but the spec calls out display-size temperatures as
                an explicit exception, so this 22 ladder still falls
                inside the allowed scale (11/12/13/13.5/14/16/22). */}
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
              fontVariantNumeric: 'tabular-nums',
            }}
            title="Wind speed"
          >
            <Wind size={13} strokeWidth={2.2} />
            <span>{Math.round(data.current.wind_kph)} kph</span>
          </div>
        )}
      </motion.div>

      {data.hourly.length > 0 && (
        <div>
          <SectionLabel>Hourly</SectionLabel>
          <div
            className="sheet-scroll"
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              paddingBottom: 4,
            }}
          >
            {data.hourly.map((h, i) => (
              <HourlyCell key={h.ts} hour={h} staggerDelay={Math.min(0.03 * i, 0.24)} />
            ))}
          </div>
        </div>
      )}

      {data.daily.length > 0 && (
        <div>
          <SectionLabel>Forecast</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.daily.map((d, i) => (
              <DailyRow
                key={d.date}
                day={d}
                isToday={i === 0}
                staggerDelay={Math.min(0.04 * i, 0.32)}
              />
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

function HourlyCell({
  hour, staggerDelay,
}: {
  hour: WeatherPayload['hourly'][number];
  staggerDelay: number;
}) {
  const Icon = iconFor(hour.icon);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: staggerDelay, ease: EASE_OUT_EXPO }}
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
          fontVariantNumeric: 'tabular-nums',
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
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {hour.temp_c == null ? '-' : `${Math.round(hour.temp_c)}°`}
      </span>
    </motion.div>
  );
}

function DailyRow({
  day, isToday, staggerDelay,
}: {
  day: WeatherPayload['daily'][number];
  isToday: boolean;
  staggerDelay: number;
}) {
  const Icon = iconFor(day.icon);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: staggerDelay, ease: EASE_OUT_EXPO }}
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
          color: isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {formatDayLabel(day.date, isToday)}
      </span>
      <Icon size={18} strokeWidth={1.8} color="var(--text-secondary)" />
      <span
        style={{
          flex: 1,
          fontSize: 12,
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
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {day.hi_c == null ? '-' : `${Math.round(day.hi_c)}°`}
        <span style={{ color: 'var(--text-secondary)', marginLeft: 5, fontWeight: 500 }}>
          / {day.lo_c == null ? '-' : `${Math.round(day.lo_c)}°`}
        </span>
      </span>
    </motion.div>
  );
}

const unavailableStyle: React.CSSProperties = {
  padding: '14px 4px',
  fontSize: 13,
  color: 'var(--text-secondary)',
};

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
