// Welcome screen — shown only on first run, before the form steps.
// Reuses the sign-in screen's logo + typewriter title so the wizard
// reads as a continuation of the same visual language rather than a
// separate moment. The streamed MetaHuman speaks the welcome line in
// parallel (driven by /onboarding/welcome from soul); this surface is
// just the visual anchor for that voice.

import { motion } from 'framer-motion';
import { BrandLogo } from './BrandLogo';
import { TypewriterTitle } from '../Auth/TypewriterTitle';

interface Props {
  /** New user: run the full first-run flow. */
  onGetStarted: () => void;
  /** Returning user: jump to login; their profile follows the account. */
  onSignIn: () => void;
}

// The welcome fork lives HERE rather than in the footer action bar: the
// footer's progress dots are centred against its full width, and hanging
// an extra button off one side pushed them off-centre. It also reads
// better, the choice sits with the copy that frames it.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const BTN_BASE: React.CSSProperties = {
  borderRadius: 10,
  fontSize: 13,
  fontFamily: 'inherit',
  fontWeight: 500,
  padding: '9px 16px',
  cursor: 'pointer',
  letterSpacing: '0.005em',
};

export function WelcomeStep({ onGetStarted, onSignIn }: Props) {
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

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <motion.button
            type="button"
            onClick={onGetStarted}
            whileHover={{ y: -1 }}
            whileTap={{ y: 0, scale: 0.98 }}
            transition={{ duration: 0.12, ease: EASE_OUT_EXPO }}
            style={{
              ...BTN_BASE,
              background: '#ffffff',
              color: 'rgba(20, 20, 20, 0.88)',
              border: 'none',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.20)',
            }}
          >
            Get started →
          </motion.button>

          <motion.button
            type="button"
            onClick={onSignIn}
            whileHover={{ y: -1 }}
            whileTap={{ y: 0, scale: 0.98 }}
            transition={{ duration: 0.12, ease: EASE_OUT_EXPO }}
            style={{
              ...BTN_BASE,
              background: 'rgba(255, 255, 255, 0.04)',
              color: 'var(--text-primary)',
              border: '1px solid var(--glass-border)',
              transition: 'background 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
            }}
          >
            Sign in
          </motion.button>
        </div>
      </div>
    </div>
  );
}
