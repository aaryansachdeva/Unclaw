// Combined onboarding step: the personal facts Grace uses to sound like
// she knows you. City / timezone (the basics) above a hairline, then the
// optional texture: hobbies, sleep schedule, a free-text note. Everything
// past the name is optional, said once in the subtitle so the fields stay
// clean.
//
// Styling tracks DESIGN.md via the shared onboarding kit: frosted-slate
// field tints, quiet eyebrow labels, ember only on the selected state, a
// subtle press spring (motion conveys state), no em dashes.

import { useMemo, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Sunrise, Moon, SunMoon } from 'lucide-react';
import { StepHeader } from './StepHeader';
import { Dropdown } from './Dropdown';
import { FIELD_BASE, applyFocus, applyBlur, FieldLabel, STEP_COL_WIDTH } from './onboardingKit';
import { TZ_CATALOG, type IdentityValues } from './IdentityStep';
import type { InterestsValues } from './InterestsStep';
import type { UserSchedule } from '../../services/userSettings';

interface Props {
  identity: IdentityValues;
  onIdentityChange: (next: IdentityValues) => void;
  interests: InterestsValues;
  onInterestsChange: (next: InterestsValues) => void;
  onAdvance: () => void;
  /** Hide the name field when it already came from sign-in. */
  hideName?: boolean;
}

const HOBBIES = [
  'code', 'music', 'sports', 'art', 'gaming',
  'reading', 'fitness', 'design', 'cooking', 'travel',
];

const SCHEDULE_OPTIONS: Array<{ key: UserSchedule; label: string; Icon: typeof Sunrise }> = [
  { key: 'early_bird', label: 'Early bird', Icon: Sunrise },
  { key: 'night_owl',  label: 'Night owl',  Icon: Moon },
  { key: 'mixed',      label: 'Mixed',      Icon: SunMoon },
];

const NOTES_LIMIT = 500;

function fallbackLabel(tz: string): string {
  const segs = tz.split('/');
  return segs[segs.length - 1].replace(/_/g, ' ') || tz;
}

export function GettingToKnowYou({
  identity,
  onIdentityChange,
  interests,
  onInterestsChange,
  onAdvance,
  hideName,
}: Props) {
  const tzOptions = useMemo(() => {
    const opts = TZ_CATALOG.map((e) => ({ id: e.id, label: e.label }));
    if (identity.timezone && !TZ_CATALOG.some((e) => e.id === identity.timezone)) {
      opts.unshift({ id: identity.timezone, label: fallbackLabel(identity.timezone) });
    }
    return opts;
  }, [identity.timezone]);

  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && identity.name.trim()) {
      e.preventDefault();
      onAdvance();
    }
  };

  const toggleHobby = (tag: string) => {
    const has = interests.interests.includes(tag);
    onInterestsChange({
      ...interests,
      interests: has
        ? interests.interests.filter((t) => t !== tag)
        : [...interests.interests, tag],
    });
  };

  const setNotes = (next: string) =>
    onInterestsChange({ ...interests, notes: next.slice(0, NOTES_LIMIT) });

  const charsLeft = NOTES_LIMIT - interests.notes.length;
  const showCount = interests.notes.length > NOTES_LIMIT - 60;

  const subtitle = hideName && identity.name
    ? `A few optional details, ${identity.name}, so I sound like I know you.`
    : 'A few optional details so I sound like I know you.';

  return (
    <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
      <div style={{ width: STEP_COL_WIDTH, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader title="Getting to know you" subtitle={subtitle} />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {!hideName && (
          <FieldLabel text="What should I call you?">
            <input
              type="text"
              autoFocus
              value={identity.name}
              onChange={(e) => onIdentityChange({ ...identity, name: e.target.value })}
              onKeyDown={onNameKey}
              placeholder="Your name"
              style={FIELD_BASE}
              onFocus={(e) => applyFocus(e.target)}
              onBlur={(e) => applyBlur(e.target)}
            />
          </FieldLabel>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <FieldLabel text="City" style={{ flex: 1 }}>
            <input
              type="text"
              value={identity.city}
              onChange={(e) => onIdentityChange({ ...identity, city: e.target.value })}
              placeholder="San Francisco"
              style={FIELD_BASE}
              onFocus={(e) => applyFocus(e.target)}
              onBlur={(e) => applyBlur(e.target)}
            />
          </FieldLabel>
          <FieldLabel text="Timezone" style={{ flex: 1.4 }}>
            <Dropdown
              value={identity.timezone}
              onChange={(v) => onIdentityChange({ ...identity, timezone: v })}
              options={tzOptions}
              menuMaxHeight={300}
            />
          </FieldLabel>
        </div>

        {/* Hairline groups the basics (who / where) from the optional
            personality texture below. One divider, not a card. */}
        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0 0' }} />

        <FieldLabel text="Hobbies">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            {HOBBIES.map((tag) => {
              const active = interests.interests.includes(tag);
              return (
                <motion.button
                  key={tag}
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 30 }}
                  onClick={() => toggleHobby(tag)}
                  style={{
                    padding: '7px 15px',
                    borderRadius: 999,
                    border: `1px solid ${active ? 'rgba(196, 68, 68, 0.5)' : 'var(--glass-border)'}`,
                    background: active ? 'var(--accent-dim)' : 'rgba(255, 255, 255, 0.03)',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12.5,
                    fontWeight: active ? 600 : 450,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    letterSpacing: '-0.005em',
                    boxShadow: active ? '0 0 0 3px rgba(196, 68, 68, 0.08)' : 'none',
                    transition: 'background 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.borderColor = 'var(--glass-border)';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    }
                  }}
                >
                  {tag}
                </motion.button>
              );
            })}
          </div>
        </FieldLabel>

        <FieldLabel text="Sleep schedule">
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            {SCHEDULE_OPTIONS.map(({ key, label, Icon }) => {
              const active = interests.schedule === key;
              return (
                <motion.button
                  key={key}
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 30 }}
                  onClick={() => onInterestsChange({ ...interests, schedule: active ? '' : key })}
                  style={{
                    flex: 1,
                    padding: '11px 8px',
                    borderRadius: 12,
                    border: `1px solid ${active ? 'rgba(196, 68, 68, 0.5)' : 'var(--glass-border)'}`,
                    background: active ? 'var(--accent-dim)' : 'rgba(255, 255, 255, 0.025)',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12.5,
                    fontWeight: active ? 600 : 450,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 7,
                    boxShadow: active ? '0 0 0 3px rgba(196, 68, 68, 0.08)' : 'none',
                    transition: 'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart), color 0.18s var(--ease-out-quart)',
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
                  <Icon
                    size={18}
                    strokeWidth={1.7}
                    color={active ? 'var(--accent, #c44444)' : 'currentColor'}
                  />
                  <span>{label}</span>
                </motion.button>
              );
            })}
          </div>
        </FieldLabel>

        <FieldLabel text="Anything else" count={showCount ? charsLeft : undefined}>
          <textarea
            rows={2}
            value={interests.notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Favorite shows, current project, allergies, anything."
            style={FIELD_BASE}
            maxLength={NOTES_LIMIT}
            onFocus={(e) => applyFocus(e.target)}
            onBlur={(e) => applyBlur(e.target)}
          />
        </FieldLabel>
      </div>
    </div>
  );
}
