// Welcome screen — shown only on first run, before the form steps.
// Reuses the sign-in screen's logo + typewriter title so the wizard
// reads as a continuation of the same visual language rather than a
// separate moment. The streamed MetaHuman speaks the welcome line in
// parallel (driven by /onboarding/welcome from soul); this surface is
// just the visual anchor for that voice.

import { BrandLogo } from './BrandLogo';
import { TypewriterTitle } from '../Auth/TypewriterTitle';
import { STEP_WIDTH } from './onboardingKit';

// The Get started / Sign in fork lives in the wizard's footer action bar
// (the welcome step hides the progress dots, so the two buttons have that
// row to themselves and nothing gets pushed off-centre).
export function WelcomeStep() {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: STEP_WIDTH,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 32,
        padding: '10px 0 6px',
      }}
    >
      <BrandLogo size={140} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Typewriter brand mark, shared with the sign-in screen so the
            two surfaces read as one continuous moment. Re-mounts with
            this step so the typing animation replays each time. */}
        <TypewriterTitle />
        <p
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            margin: 0,
            letterSpacing: '0.005em',
            lineHeight: 1.55,
          }}
        >
          A quick minute of setup so I can sound a little more like
          someone you&apos;d actually want to talk to.
        </p>
      </div>
    </div>
  );
}
