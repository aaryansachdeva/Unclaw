// Welcome screen — shown only on first run, before the form steps.
// Reuses the sign-in screen's logo + typewriter title so the wizard
// reads as a continuation of the same visual language rather than a
// separate moment. The streamed MetaHuman speaks the welcome line in
// parallel (driven by /onboarding/welcome from soul); this surface is
// just the visual anchor for that voice.

import { motion } from 'framer-motion';
import logoUrl from '../../assets/logo_lg.png';
import { TypewriterTitle } from '../Auth/TypewriterTitle';

export function WelcomeStep() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 36,
        padding: '14px 0 10px',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 168,
          height: 168,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Soft accent halo behind the logo — same recipe as the
            sign-in screen's logo, dialed slightly smaller to fit the
            wizard panel without crowding the typewriter title. */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: -18,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(196, 68, 68, 0.22) 0%, rgba(196, 68, 68, 0.06) 50%, transparent 75%)',
            filter: 'blur(10px)',
            pointerEvents: 'none',
          }}
        />
        <motion.img
          src={logoUrl}
          alt="UnClaw"
          animate={{
            filter: [
              'drop-shadow(0 0 16px rgba(196, 68, 68, 0.26))',
              'drop-shadow(0 0 30px rgba(196, 68, 68, 0.46))',
              'drop-shadow(0 0 16px rgba(196, 68, 68, 0.26))',
            ],
          }}
          transition={{
            duration: 3.2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            width: 168,
            height: 168,
            objectFit: 'contain',
            position: 'relative',
            zIndex: 1,
          }}
        />
      </div>

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
