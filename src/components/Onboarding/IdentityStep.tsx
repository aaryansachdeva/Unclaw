// Step 1 — required: name. Optional: city. Timezone is a real <select>
// pre-filled with the runtime's detected zone. Pronouns dropped per
// product direction.

import { useMemo, KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { StepHeader } from './StepHeader';

export interface IdentityValues {
  name: string;
  /** Reserved on the type for backwards compat with stored profiles
   *  that already include pronouns; the wizard no longer collects it. */
  pronouns: string;
  city: string;
  timezone: string;
}

interface Props {
  values: IdentityValues;
  onChange: (next: IdentityValues) => void;
  onAdvance: () => void;
}

const FIELD_BASE: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  width: '100%',
  letterSpacing: '-0.005em',
  transition: 'border-color 0.16s var(--ease-out-quart), box-shadow 0.16s var(--ease-out-quart), background 0.16s var(--ease-out-quart)',
};

function applyFocus(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border-focus)';
  el.style.background = 'rgba(255, 255, 255, 0.06)';
  el.style.boxShadow = '0 0 0 3px rgba(196, 68, 68, 0.10)';
}
function applyBlur(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border)';
  el.style.background = 'rgba(255, 255, 255, 0.04)';
  el.style.boxShadow = 'none';
}

/** Curated fallback if `Intl.supportedValuesOf` isn't available on the
 *  runtime. Covers the common timezones; any saved value not in the
 *  list still works (we splice it in below). */
const TZ_FALLBACK = [
  'UTC',
  'Pacific/Auckland', 'Australia/Sydney', 'Australia/Melbourne',
  'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Hong_Kong',
  'Asia/Singapore', 'Asia/Bangkok', 'Asia/Kolkata', 'Asia/Dubai',
  'Europe/Athens', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
  'Europe/Paris', 'Europe/Amsterdam', 'Europe/London', 'Europe/Lisbon',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'America/New_York', 'America/Toronto', 'America/Chicago',
  'America/Mexico_City', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Vancouver', 'America/Anchorage',
  'Pacific/Honolulu',
];

function getAllTimezones(): string[] {
  try {
    const intl = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] });
    if (typeof intl.supportedValuesOf === 'function') {
      return intl.supportedValuesOf('timeZone');
    }
  } catch {
    // ignore
  }
  return TZ_FALLBACK;
}

/** Read the current GMT offset (in minutes) for an IANA timezone using
 *  Intl.DateTimeFormat. Returns 0 on parse failure so we degrade
 *  gracefully rather than crash. */
function getOffsetMinutes(tz: string, now: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    });
    const parts = fmt.formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (!tzPart) return 0;
    // Values like "GMT-08:00", "GMT+05:30", or just "GMT" for UTC.
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(tzPart.value);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    const h = parseInt(m[2], 10);
    const min = parseInt(m[3], 10);
    return sign * (h * 60 + min);
  } catch {
    return 0;
  }
}

function formatOffset(mins: number): string {
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Pull the human-friendly city out of an IANA id. "America/Los_Angeles"
 *  -> "Los Angeles". Multi-segment ids ("America/Argentina/Buenos_Aires")
 *  use the LAST segment plus the SECOND-to-last as a region hint. */
function formatTzCity(tz: string): string {
  if (tz === 'UTC' || tz === 'GMT') return tz;
  const segs = tz.split('/');
  if (segs.length === 1) return segs[0].replace(/_/g, ' ');
  const city = segs[segs.length - 1].replace(/_/g, ' ');
  // For nested zones like America/Argentina/Buenos_Aires, surface
  // the parent so users can disambiguate from siblings.
  if (segs.length >= 3) {
    const parent = segs[segs.length - 2].replace(/_/g, ' ');
    return `${city}, ${parent}`;
  }
  return city;
}

interface TzOption {
  tz: string;
  label: string;
  offsetMinutes: number;
}

export function IdentityStep({ values, onChange, onAdvance }: Props) {
  const tzOptions: TzOption[] = useMemo(() => {
    const list = getAllTimezones().slice();
    // Splice in any saved value that isn't in the list (legacy profiles).
    if (values.timezone && !list.includes(values.timezone)) {
      list.unshift(values.timezone);
    }
    const now = new Date();
    return list
      .map<TzOption>((tz) => {
        const offsetMinutes = getOffsetMinutes(tz, now);
        return {
          tz,
          offsetMinutes,
          label: `(${formatOffset(offsetMinutes)}) ${formatTzCity(tz)}`,
        };
      })
      .sort((a, b) => {
        // Primary sort by offset, secondary by label so cities at the
        // same offset come out alphabetically.
        if (a.offsetMinutes !== b.offsetMinutes) {
          return a.offsetMinutes - b.offsetMinutes;
        }
        return a.label.localeCompare(b.label);
      });
  }, [values.timezone]);

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && values.name.trim()) {
      e.preventDefault();
      onAdvance();
    }
  };

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      <div style={{ width: 180, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader
          title="Let's start with you."
          subtitle="A name, a city, and your local time."
        />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <FieldLabel text="What should I call you?">
          <input
            type="text"
            autoFocus
            value={values.name}
            onChange={(e) => onChange({ ...values, name: e.target.value })}
            onKeyDown={onNameKey}
            placeholder="Your name"
            style={FIELD_BASE}
            onFocus={(e) => applyFocus(e.target)}
            onBlur={(e) => applyBlur(e.target)}
          />
        </FieldLabel>

        <div style={{ display: 'flex', gap: 12 }}>
          <FieldLabel text="City (optional)" style={{ flex: 1 }}>
            <input
              type="text"
              value={values.city}
              onChange={(e) => onChange({ ...values, city: e.target.value })}
              placeholder="San Francisco"
              style={FIELD_BASE}
              onFocus={(e) => applyFocus(e.target)}
              onBlur={(e) => applyBlur(e.target)}
            />
          </FieldLabel>

          <FieldLabel text="Timezone" style={{ flex: 1.4 }}>
            <div style={{ position: 'relative' }}>
              <select
                value={values.timezone}
                onChange={(e) => onChange({ ...values, timezone: e.target.value })}
                onFocus={(e) => applyFocus(e.target)}
                onBlur={(e) => applyBlur(e.target)}
                style={{
                  ...FIELD_BASE,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  paddingRight: 32,
                  cursor: 'pointer',
                }}
              >
                {tzOptions.map(({ tz, label }) => (
                  <option key={tz} value={tz} style={{ background: 'var(--bg-elevated)' }}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                strokeWidth={1.8}
                aria-hidden
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: 12,
                  transform: 'translateY(-50%)',
                  color: 'var(--text-ghost)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          </FieldLabel>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({
  text,
  children,
  style,
}: {
  text: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        minWidth: 0,
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-ghost)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {text}
      </span>
      {children}
    </label>
  );
}
