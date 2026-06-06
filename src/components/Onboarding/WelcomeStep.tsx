// Welcome screen — shown only on first run, before the form steps.
// Reuses the sign-in screen's logo + typewriter title so the wizard
// reads as a continuation of the same visual language rather than a
// separate moment. The streamed MetaHuman speaks the welcome line in
// parallel (driven by /onboarding/welcome from soul); this surface is
// just the visual anchor for that voice.

import { BrandLogo } from './BrandLogo';
import { TypewriterTitle } from '../Auth/TypewriterTitle';

export function WelcomeStep() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 36,
        // Nudge the whole row (logo + title block) a little right so it
        // sits more centered in the panel rather than hugging the edge.
        padding: '14px 0 10px 52px',
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
      </div>
    </div>
  );
}
