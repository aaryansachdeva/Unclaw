// Welcome screen — shown only on first run, before the form steps.
// Reuses the sign-in screen's logo + typewriter title so the wizard
// reads as a continuation of the same visual language rather than a
// separate moment. The streamed MetaHuman speaks the welcome line in
// parallel (driven by /onboarding/welcome from soul); this surface is
// just the visual anchor for that voice.

import { BrandLogo } from './BrandLogo';
import { TypewriterTitle } from '../Auth/TypewriterTitle';

interface Props {
  /** Returning-user shortcut: jump straight to sign-in and skip the
   *  setup pages (their profile follows the account). */
  onSignIn?: () => void;
}

export function WelcomeStep({ onSignIn }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        // True centering, not the old fixed-padding nudge: the row now
        // lands centered at any panel width.
        justifyContent: 'center',
        gap: 36,
        padding: '14px 0 10px',
      }}
    >
      <BrandLogo size={168} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        {/* Typewriter brand mark — matches the sign-in screen so the
            transition between the two surfaces feels like a single
            continuous moment. Re-mounts with this step so the typing
            animation replays each time the wizard opens. */}
        <TypewriterTitle />
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            margin: 0,
            letterSpacing: '0.005em',
            lineHeight: 1.55,
            maxWidth: 380,
          }}
        >
          A quick minute of setup so I can sound a little more like
          someone you&apos;d actually want to talk to.
        </p>
        {onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 12.5,
              color: 'var(--text-ghost)',
              cursor: 'pointer',
              letterSpacing: '0.005em',
              textAlign: 'left',
              transition: 'color 0.15s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-ghost)'; }}
          >
            Already have an account? <span style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Sign in</span>
          </button>
        )}
      </div>
    </div>
  );
}
