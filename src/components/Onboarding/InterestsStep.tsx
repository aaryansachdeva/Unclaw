// Step 3 — fully optional. Hobbies tag picker, schedule choice,
// free-text "anything else" with a 500-char cap. Work field dropped
// per product direction.

import { Sunrise, Moon, SunMoon } from 'lucide-react';
import { StepHeader } from './StepHeader';
import type { UserSchedule } from '../../services/userSettings';

export interface InterestsValues {
  interests: string[];
  /** Reserved on the type for backwards compat with stored profiles
   *  that already include a work field; the wizard no longer collects it. */
  work: string;
  schedule: UserSchedule | '';
  notes: string;
}

interface Props {
  values: InterestsValues;
  onChange: (next: InterestsValues) => void;
}

const SUGGESTED = [
  'code', 'music', 'sports', 'art', 'gaming',
  'reading', 'fitness', 'design', 'cooking', 'travel',
];

// Schedule options paired with iconography so users can scan visually
// instead of reading three labels. Sunrise/Moon are obvious; SunMoon
// reads as "either/both" for the mixed case.
const SCHEDULE_OPTIONS: Array<{
  key: UserSchedule;
  label: string;
  Icon: typeof Sunrise;
}> = [
  { key: 'early_bird', label: 'Early bird', Icon: Sunrise },
  { key: 'night_owl',  label: 'Night owl',  Icon: Moon },
  { key: 'mixed',      label: 'Mixed',      Icon: SunMoon },
];

const NOTES_LIMIT = 500;

const FIELD_STYLE: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  width: '100%',
  resize: 'none',
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

export function InterestsStep({ values, onChange }: Props) {
  const toggleInterest = (tag: string) => {
    const has = values.interests.includes(tag);
    onChange({
      ...values,
      interests: has
        ? values.interests.filter((t) => t !== tag)
        : [...values.interests, tag],
    });
  };

  const setNotes = (next: string) => {
    onChange({ ...values, notes: next.slice(0, NOTES_LIMIT) });
  };

  const charsLeft = NOTES_LIMIT - values.notes.length;
  const showCount = values.notes.length > NOTES_LIMIT - 60;

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      <div style={{ width: 180, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader
          title="What's on your mind?"
          subtitle="All optional. Anything you share helps me sound more like me."
        />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Hobbies
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUGGESTED.map((tag) => {
            const active = values.interests.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleInterest(tag)}
                style={{
                  padding: '6px 13px',
                  borderRadius: 999,
                  border: active
                    ? '1px solid var(--accent-strong)'
                    : '1px solid var(--glass-border)',
                  background: active ? 'var(--accent-dim)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  letterSpacing: '0.005em',
                  boxShadow: active
                    ? '0 0 10px -4px rgba(196, 68, 68, 0.45)'
                    : 'none',
                  transition: 'all 0.15s var(--ease-out-quart)',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = 'var(--glass-border)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Sleep schedule
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {SCHEDULE_OPTIONS.map(({ key, label, Icon }) => {
            const active = values.schedule === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onChange({ ...values, schedule: active ? '' : key })
                }
                style={{
                  flex: 1,
                  padding: '8px 8px',
                  borderRadius: 10,
                  border: active
                    ? '1px solid var(--accent-strong)'
                    : '1px solid var(--glass-border)',
                  background: active ? 'var(--accent-dim)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.18s var(--ease-out-quart)',
                  boxShadow: active
                    ? '0 0 14px -6px rgba(196, 68, 68, 0.45)'
                    : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = 'var(--glass-border)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                <Icon size={18} strokeWidth={1.6} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Anything else (optional)
          </span>
          {showCount && (
            <span
              style={{
                fontSize: 10.5,
                color: charsLeft < 0 ? 'var(--danger)' : 'var(--text-secondary)',
                letterSpacing: '0.04em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {charsLeft}
            </span>
          )}
        </div>
        <textarea
          rows={2}
          value={values.notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Favorite shows, current project, allergies, anything..."
          style={FIELD_STYLE}
          maxLength={NOTES_LIMIT}
          onFocus={(e) => applyFocus(e.target)}
          onBlur={(e) => applyBlur(e.target)}
        />
      </label>
      </div>
    </div>
  );
}
