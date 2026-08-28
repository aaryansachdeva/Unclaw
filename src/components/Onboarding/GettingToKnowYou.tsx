// Combined onboarding step: the personal facts Grace uses to sound like
// she knows you. Name, then the optional texture: hobbies and a free-text
// note. Everything past the name is optional, said once in the subtitle so
// the fields stay clean.
//
// City and timezone left the UI 2026-08-27: the timezone is auto-detected
// from the system (the wizard seeds it via detectTimezone()) and asking a
// human to confirm what the OS already knows was noise. Sleep schedule
// left with them. The profile fields survive for anyone who set them.
//
// Styling tracks DESIGN.md via the shared onboarding kit: frosted-slate
// field tints, quiet eyebrow labels, ember only on the selected state, a
// subtle press spring (motion conveys state), no em dashes.

import { useState, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import {
  Code2, Music, Trophy, Palette, Gamepad2, BookOpen,
  Dumbbell, PenTool, ChefHat, Plane, Plus, Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { StepHeader } from './StepHeader';
import { FIELD_BASE, applyFocus, applyBlur, FieldLabel } from './onboardingKit';
import { type IdentityValues } from './IdentityStep';
import type { InterestsValues } from './InterestsStep';

interface Props {
  identity: IdentityValues;
  onIdentityChange: (next: IdentityValues) => void;
  interests: InterestsValues;
  onInterestsChange: (next: InterestsValues) => void;
  onAdvance: () => void;
  /** Hide the name field when it already came from sign-in. */
  hideName?: boolean;
}

// Preset hobbies, each with a quiet stroke icon so the chips read as a
// set rather than a bag of words. Custom tags (added below) get Sparkles.
const HOBBIES: Array<{ tag: string; Icon: LucideIcon }> = [
  { tag: 'code',    Icon: Code2 },
  { tag: 'music',   Icon: Music },
  { tag: 'sports',  Icon: Trophy },
  { tag: 'art',     Icon: Palette },
  { tag: 'gaming',  Icon: Gamepad2 },
  { tag: 'reading', Icon: BookOpen },
  { tag: 'fitness', Icon: Dumbbell },
  { tag: 'design',  Icon: PenTool },
  { tag: 'cooking', Icon: ChefHat },
  { tag: 'travel',  Icon: Plane },
];
const PRESET_TAGS = new Set(HOBBIES.map((h) => h.tag));

const NOTES_LIMIT = 500;
const CUSTOM_TAG_LIMIT = 24;

export function GettingToKnowYou({
  identity,
  onIdentityChange,
  interests,
  onInterestsChange,
  onAdvance,
  hideName,
}: Props) {
  const [addingHobby, setAddingHobby] = useState(false);
  const [hobbyDraft, setHobbyDraft] = useState('');

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

  const commitHobbyDraft = () => {
    const tag = hobbyDraft.trim().slice(0, CUSTOM_TAG_LIMIT);
    setHobbyDraft('');
    setAddingHobby(false);
    if (!tag || interests.interests.includes(tag)) return;
    onInterestsChange({ ...interests, interests: [...interests.interests, tag] });
  };

  const setNotes = (next: string) =>
    onInterestsChange({ ...interests, notes: next.slice(0, NOTES_LIMIT) });

  const charsLeft = NOTES_LIMIT - interests.notes.length;
  const showCount = interests.notes.length > NOTES_LIMIT - 60;

  // Custom tags the user typed themselves; rendered after the presets and
  // removed entirely when toggled off (they only exist because chosen).
  const customTags = interests.interests.filter((t) => !PRESET_TAGS.has(t));

  const subtitle = hideName && identity.name
    ? `A few optional details, ${identity.name}, so I sound like I know you.`
    : 'A few optional details so I sound like I know you.';

  const chipBase = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 13px',
    borderRadius: 999,
    border: `1px solid ${active ? 'rgba(196, 68, 68, 0.55)' : 'var(--glass-border)'}`,
    background: active ? 'var(--accent-dim)' : 'rgba(255, 255, 255, 0.04)',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: active ? 600 : 470,
    fontFamily: 'inherit',
    cursor: 'pointer',
    letterSpacing: '-0.005em',
    boxShadow: active ? '0 0 0 3px rgba(196, 68, 68, 0.08)' : 'none',
    transition: 'background 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
  });

  const chipHover = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.currentTarget.dataset.active === '1') return;
      e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
      e.currentTarget.style.color = 'var(--text-primary)';
      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.currentTarget.dataset.active === '1') return;
      e.currentTarget.style.borderColor = 'var(--glass-border)';
      e.currentTarget.style.color = 'var(--text-secondary)';
      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
    },
  };

  const renderChip = (tag: string, Icon: LucideIcon, active: boolean) => (
    <motion.button
      key={tag}
      type="button"
      data-active={active ? '1' : '0'}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      onClick={() => toggleHobby(tag)}
      style={chipBase(active)}
      {...chipHover}
    >
      <Icon
        size={13}
        strokeWidth={1.8}
        color={active ? 'var(--accent, #c44444)' : 'currentColor'}
        style={{ opacity: active ? 1 : 0.75, flexShrink: 0 }}
      />
      <span>{tag}</span>
    </motion.button>
  );

  // Layout (2026-08-27): this step got short enough that the shared
  // side-header pattern left a void where taller steps put their fields.
  // Header runs as a band across the top, the one REQUIRED field (name)
  // sits alone under it at a deliberate width, and the two optional
  // texture fields share a row: content fills the panel instead of
  // huddling in the right half.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 760, maxWidth: '100%' }}>
      <StepHeader title="Getting to know you" subtitle={subtitle} wide />

      {!hideName && (
        <FieldLabel text="What should I call you?" style={{ width: 420, maxWidth: '100%' }}>
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

      <div style={{ display: 'flex', gap: 26, alignItems: 'flex-start' }}>
        <FieldLabel text="Hobbies" style={{ flex: 1.25, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            {HOBBIES.map(({ tag, Icon }) =>
              renderChip(tag, Icon, interests.interests.includes(tag)))}
            {customTags.map((tag) => renderChip(tag, Sparkles, true))}
            {addingHobby ? (
              <input
                type="text"
                autoFocus
                value={hobbyDraft}
                maxLength={CUSTOM_TAG_LIMIT}
                onChange={(e) => setHobbyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitHobbyDraft(); }
                  if (e.key === 'Escape') { setHobbyDraft(''); setAddingHobby(false); }
                }}
                onBlur={commitHobbyDraft}
                placeholder="your thing"
                style={{
                  width: 110,
                  padding: '7px 13px',
                  borderRadius: 999,
                  border: '1px solid var(--glass-border-focus)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  letterSpacing: '-0.005em',
                  outline: 'none',
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingHobby(true)}
                style={{
                  ...chipBase(false),
                  background: 'transparent',
                  color: 'var(--text-ghost)',
                }}
                {...chipHover}
              >
                <Plus size={13} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                <span>add your own</span>
              </button>
            )}
          </div>
        </FieldLabel>

        <FieldLabel
          text="Anything else"
          count={showCount ? charsLeft : undefined}
          style={{ flex: 1, minWidth: 0 }}
        >
          <textarea
            rows={5}
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
