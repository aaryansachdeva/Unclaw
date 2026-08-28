// Shared onboarding primitives so every step speaks one visual language:
// the same field surface, the same quiet eyebrow labels, the same focus
// ring. Consistency screen-to-screen is the product-register virtue; this
// is where it's centralized. Styling tracks DESIGN.md (frosted-slate field
// tints, ember focus ring, Plus Jakarta Sans, no em dashes).

import type { CSSProperties, ReactNode } from 'react';

import { StepHeader } from './StepHeader';

/** The one content measure. Every step renders inside a column of this
 *  width, CENTRED in the wizard panel.
 *
 *  The panel itself spans the window (left:16 / right:16), so any step
 *  that set its own width sat against the panel's left edge with a void
 *  beside it, and every step measured differently. One centred measure
 *  fixes the alignment, the voids, and the panel resizing between steps,
 *  in one place. 560 is a comfortable form measure: wide enough for a
 *  two-up slider grid, narrow enough that a single line of copy does not
 *  outrun the eye. */
export const STEP_WIDTH = 560;

/** The shared text-input / textarea surface. */
export const FIELD_BASE: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border)',
  borderRadius: 11,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '11px 13px',
  outline: 'none',
  width: '100%',
  resize: 'none',
  letterSpacing: '-0.005em',
  transition:
    'border-color 0.16s var(--ease-out-quart), box-shadow 0.16s var(--ease-out-quart), background 0.16s var(--ease-out-quart)',
};

export function applyFocus(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border-focus)';
  el.style.background = 'rgba(255, 255, 255, 0.06)';
  el.style.boxShadow = '0 0 0 3px rgba(196, 68, 68, 0.10)';
}
export function applyBlur(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border)';
  el.style.background = 'rgba(255, 255, 255, 0.04)';
  el.style.boxShadow = 'none';
}

/** A quiet uppercase eyebrow over a field. Labels stay faint so the field
 *  content is the bold thing on the row. `count` right-aligns a char tally
 *  (used by the notes field near its limit). */
export function FieldLabel({
  text,
  children,
  count,
  style,
}: {
  text: string;
  children: ReactNode;
  count?: number;
  style?: CSSProperties;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span
          style={{
            // 11/700 uppercase: bolder weight gives the eyebrow real
            // presence (the old 11/500 disappeared into the frosted panel)
            // while staying smaller + cleaner than a 12/500 label, so the
            // field content stays the loudest thing on the row.
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-secondary)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {text}
        </span>
        {count !== undefined && (
          <span
            style={{
              fontSize: 10.5,
              color: count < 0 ? 'var(--danger)' : 'var(--text-secondary)',
              letterSpacing: '0.04em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </label>
  );
}


/** Every step's outer frame: the centred measure, the title block, and a
 *  consistent rhythm between the header and the content. Steps supply
 *  their fields; nothing below has to think about width or alignment
 *  again.
 *
 *  `aside` is for a step that wants one decorative element riding at the
 *  right of the header band (the Claws mark). It is deliberately not a
 *  second content column. */
export function StepShell({
  title,
  subtitle,
  aside,
  children,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: STEP_WIDTH,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      {aside ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <StepHeader title={title} subtitle={subtitle} />
          {aside}
        </div>
      ) : (
        <StepHeader title={title} subtitle={subtitle} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {children}
      </div>
    </div>
  );
}
