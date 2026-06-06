// Step 1 — required: name. Optional: city. Timezone is a real <select>
// pre-filled with the runtime's detected zone. Pronouns dropped per
// product direction.

import { useMemo, KeyboardEvent } from 'react';
import { StepHeader } from './StepHeader';
import { Dropdown } from './Dropdown';

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
  /** Hide the name field — set when the name already came from sign-in, so we
   *  don't ask for it twice. The value is still carried in `values.name`. */
  hideName?: boolean;
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

/** Curated timezone catalog mirroring Kintone's public list — the labels
 *  group nearby cities under one entry instead of surfacing every IANA
 *  id, which keeps the dropdown navigable. Stored value is the IANA id;
 *  display string is the static "(UTC±HH:MM) Region" label as Kintone
 *  publishes it. The label's offset is the standard-time offset, not
 *  the live DST-adjusted value — that matches Kintone's catalog and
 *  avoids labels that drift twice a year. */
export const TZ_CATALOG: Array<{ id: string; label: string }> = [
  { id: 'Etc/GMT+12',                  label: '(UTC-12:00) International Date Line West' },
  { id: 'Etc/GMT+11',                  label: '(UTC-11:00) Coordinated Universal Time-11' },
  { id: 'Pacific/Honolulu',            label: '(UTC-10:00) Hawaii' },
  { id: 'America/Anchorage',           label: '(UTC-09:00) Alaska' },
  { id: 'America/Santa_Isabel',        label: '(UTC-08:00) Baja California' },
  { id: 'America/Los_Angeles',         label: '(UTC-08:00) Pacific Time (US and Canada)' },
  { id: 'America/Phoenix',             label: '(UTC-07:00) Arizona' },
  { id: 'America/Chihuahua',           label: '(UTC-07:00) Chihuahua, La Paz, Mazatlan' },
  { id: 'America/Denver',              label: '(UTC-07:00) Mountain Time (US and Canada)' },
  { id: 'America/Guatemala',           label: '(UTC-06:00) Central America' },
  { id: 'America/Chicago',             label: '(UTC-06:00) Central Time (US and Canada)' },
  { id: 'America/Mexico_City',         label: '(UTC-06:00) Guadalajara, Mexico City, Monterey' },
  { id: 'America/Regina',              label: '(UTC-06:00) Saskatchewan' },
  { id: 'America/Bogota',              label: '(UTC-05:00) Bogota, Lima, Quito' },
  { id: 'America/New_York',            label: '(UTC-05:00) Eastern Time (US and Canada)' },
  { id: 'America/Indiana/Indianapolis', label: '(UTC-05:00) Indiana (East)' },
  { id: 'America/Caracas',             label: '(UTC-04:30) Caracas' },
  { id: 'America/Asuncion',            label: '(UTC-04:00) Asuncion' },
  { id: 'America/Halifax',             label: '(UTC-04:00) Atlantic Time (Canada)' },
  { id: 'America/Cuiaba',              label: '(UTC-04:00) Cuiaba' },
  { id: 'America/La_Paz',              label: '(UTC-04:00) Georgetown, La Paz, Manaus, San Juan' },
  { id: 'America/Santiago',            label: '(UTC-04:00) Santiago' },
  { id: 'America/St_Johns',            label: '(UTC-03:30) Newfoundland' },
  { id: 'America/Sao_Paulo',           label: '(UTC-03:00) Brasilia' },
  { id: 'America/Argentina/Buenos_Aires', label: '(UTC-03:00) Buenos Aires' },
  { id: 'America/Cayenne',             label: '(UTC-03:00) Cayenne, Fortaleza' },
  { id: 'America/Godthab',             label: '(UTC-03:00) Greenland' },
  { id: 'America/Montevideo',          label: '(UTC-03:00) Montevideo' },
  { id: 'Etc/GMT+2',                   label: '(UTC-02:00) Coordinated Universal Time-2' },
  { id: 'Atlantic/Azores',             label: '(UTC-01:00) Azores' },
  { id: 'Atlantic/Cape_Verde',         label: '(UTC-01:00) Cape Verde' },
  { id: 'Africa/Casablanca',           label: '(UTC+00:00) Casablanca' },
  { id: 'Etc/GMT',                     label: '(UTC+00:00) Coordinated Universal Time' },
  { id: 'Europe/London',               label: '(UTC+00:00) Dublin, Edinburgh, Lisbon, London' },
  { id: 'Atlantic/Reykjavik',          label: '(UTC+00:00) Monrovia, Reykjavik' },
  { id: 'Europe/Berlin',               label: '(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna' },
  { id: 'Europe/Budapest',             label: '(UTC+01:00) Belgrade, Bratislava, Budapest, Ljubljana, Prague' },
  { id: 'Europe/Paris',                label: '(UTC+01:00) Brussels, Copenhagen, Madrid, Paris' },
  { id: 'Europe/Warsaw',               label: '(UTC+01:00) Sarajevo, Skopje, Warsaw, Zagreb' },
  { id: 'Africa/Lagos',                label: '(UTC+01:00) West Central Africa' },
  { id: 'Africa/Windhoek',             label: '(UTC+01:00) Windhoek' },
  { id: 'Asia/Amman',                  label: '(UTC+02:00) Amman' },
  { id: 'Europe/Istanbul',             label: '(UTC+02:00) Athens, Bucharest, Istanbul' },
  { id: 'Asia/Beirut',                 label: '(UTC+02:00) Beirut' },
  { id: 'Africa/Cairo',                label: '(UTC+02:00) Cairo' },
  { id: 'Asia/Damascus',               label: '(UTC+02:00) Damascus' },
  { id: 'Africa/Johannesburg',         label: '(UTC+02:00) Harare, Pretoria' },
  { id: 'Europe/Kiev',                 label: '(UTC+02:00) Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius' },
  { id: 'Asia/Jerusalem',              label: '(UTC+02:00) Jerusalem' },
  { id: 'Asia/Baghdad',                label: '(UTC+03:00) Baghdad' },
  { id: 'Asia/Riyadh',                 label: '(UTC+03:00) Kuwait, Riyadh' },
  { id: 'Europe/Minsk',                label: '(UTC+03:00) Minsk' },
  { id: 'Africa/Nairobi',              label: '(UTC+03:00) Nairobi' },
  { id: 'Asia/Tehran',                 label: '(UTC+03:30) Tehran' },
  { id: 'Asia/Dubai',                  label: '(UTC+04:00) Abu Dhabi, Muscat' },
  { id: 'Asia/Baku',                   label: '(UTC+04:00) Baku' },
  { id: 'Europe/Moscow',               label: '(UTC+04:00) Moscow, St. Petersburg, Volgograd' },
  { id: 'Indian/Mauritius',            label: '(UTC+04:00) Port Louis' },
  { id: 'Asia/Tbilisi',                label: '(UTC+04:00) Tbilisi' },
  { id: 'Asia/Yerevan',                label: '(UTC+04:00) Yerevan' },
  { id: 'Asia/Kabul',                  label: '(UTC+04:30) Kabul' },
  { id: 'Asia/Karachi',                label: '(UTC+05:00) Islamabad, Karachi' },
  { id: 'Asia/Tashkent',               label: '(UTC+05:00) Tashkent' },
  { id: 'Asia/Kolkata',                label: '(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi' },
  { id: 'Asia/Colombo',                label: '(UTC+05:30) Sri Jayewardenepura Kotte' },
  { id: 'Asia/Kathmandu',              label: '(UTC+05:45) Kathmandu' },
  { id: 'Asia/Almaty',                 label: '(UTC+06:00) Astana' },
  { id: 'Asia/Dhaka',                  label: '(UTC+06:00) Dhaka' },
  { id: 'Asia/Yekaterinburg',          label: '(UTC+06:00) Yekaterinburg' },
  { id: 'Asia/Yangon',                 label: '(UTC+06:30) Yangon' },
  { id: 'Asia/Bangkok',                label: '(UTC+07:00) Bangkok, Hanoi, Jakarta' },
  { id: 'Asia/Novosibirsk',            label: '(UTC+07:00) Novosibirsk' },
  { id: 'Asia/Shanghai',               label: '(UTC+08:00) Beijing, Chongqing, Hong Kong, Urumqi' },
  { id: 'Asia/Krasnoyarsk',            label: '(UTC+08:00) Krasnoyarsk' },
  { id: 'Asia/Singapore',              label: '(UTC+08:00) Kuala Lumpur, Singapore' },
  { id: 'Australia/Perth',             label: '(UTC+08:00) Perth' },
  { id: 'Asia/Taipei',                 label: '(UTC+08:00) Taipei' },
  { id: 'Asia/Ulaanbaatar',            label: '(UTC+08:00) Ulaanbaatar' },
  { id: 'Asia/Irkutsk',                label: '(UTC+09:00) Irkutsk' },
  { id: 'Asia/Tokyo',                  label: '(UTC+09:00) Osaka, Sapporo, Tokyo' },
  { id: 'Asia/Seoul',                  label: '(UTC+09:00) Seoul' },
  { id: 'Australia/Adelaide',          label: '(UTC+09:30) Adelaide' },
  { id: 'Australia/Darwin',            label: '(UTC+09:30) Darwin' },
  { id: 'Australia/Brisbane',          label: '(UTC+10:00) Brisbane' },
  { id: 'Australia/Sydney',            label: '(UTC+10:00) Canberra, Melbourne, Sydney' },
  { id: 'Pacific/Port_Moresby',        label: '(UTC+10:00) Guam, Port Moresby' },
  { id: 'Australia/Hobart',            label: '(UTC+10:00) Hobart' },
  { id: 'Asia/Yakutsk',                label: '(UTC+10:00) Yakutsk' },
  { id: 'Pacific/Guadalcanal',         label: '(UTC+11:00) Solomon Islands, New Caledonia' },
  { id: 'Asia/Vladivostok',            label: '(UTC+11:00) Vladivostok' },
  { id: 'Pacific/Auckland',            label: '(UTC+12:00) Auckland, Wellington' },
  { id: 'Etc/GMT-12',                  label: '(UTC+12:00) Coordinated Universal Time+12' },
  { id: 'Pacific/Fiji',                label: '(UTC+12:00) Fiji, Marshall Islands' },
  { id: 'Asia/Magadan',                label: '(UTC+12:00) Magadan' },
  { id: 'Pacific/Tongatapu',           label: "(UTC+13:00) Nuku'alofa" },
  { id: 'Pacific/Apia',                label: '(UTC+13:00) Samoa' },
];

/** Fallback label for any IANA id we don't have in the catalog (e.g. a
 *  legacy saved value). Best-effort — uses the last city segment with
 *  underscores replaced. */
function fallbackLabel(tz: string): string {
  const segs = tz.split('/');
  return segs[segs.length - 1].replace(/_/g, ' ') || tz;
}

interface TzOption {
  tz: string;
  label: string;
}

export function IdentityStep({ values, onChange, onAdvance, hideName }: Props) {
  const tzOptions: TzOption[] = useMemo(() => {
    const opts: TzOption[] = TZ_CATALOG.map((entry) => ({
      tz: entry.id,
      label: entry.label,
    }));
    // Legacy compat: surface any saved value that isn't in the catalog
    // at the top so the user can still see what they had selected.
    if (values.timezone && !TZ_CATALOG.some((e) => e.id === values.timezone)) {
      opts.unshift({ tz: values.timezone, label: fallbackLabel(values.timezone) });
    }
    return opts;
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
          title={hideName ? `Nice to meet you${values.name ? `, ${values.name}` : ''}.` : "Let's start with you."}
          subtitle={hideName ? 'A city and your local time.' : 'A name, a city, and your local time.'}
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
        {!hideName && (
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
        )}

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
            <Dropdown
              value={values.timezone}
              onChange={(v) => onChange({ ...values, timezone: v })}
              options={tzOptions.map(({ tz, label }) => ({ id: tz, label }))}
              menuMaxHeight={320}
            />
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
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {text}
      </span>
      {children}
    </label>
  );
}
