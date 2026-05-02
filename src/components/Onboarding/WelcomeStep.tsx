// Welcome screen — shown only on first run, before the form steps.
// The logo gets the same breathing aura treatment used in StreamView's
// loading screen so the wizard reads as part of the same visual world.

import { motion } from 'framer-motion';
import logoUrl from '../../assets/logo.png';

export function WelcomeStep() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 32,
        padding: '14px 0 10px',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 160,
          height: 160,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Soft accent halo behind the logo — matches the loading-
            screen aesthetic without overwhelming the panel. */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: -16,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(196, 68, 68, 0.20) 0%, rgba(196, 68, 68, 0.05) 50%, transparent 70%)',
            filter: 'blur(6px)',
            pointerEvents: 'none',
          }}
        />
        <motion.img
          src={logoUrl}
          alt="UnClaw"
          animate={{
            filter: [
              'drop-shadow(0 0 16px rgba(196, 68, 68, 0.22))',
              'drop-shadow(0 0 28px rgba(196, 68, 68, 0.40))',
              'drop-shadow(0 0 16px rgba(196, 68, 68, 0.22))',
            ],
          }}
          transition={{
            duration: 3.2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            width: 160,
            height: 160,
            objectFit: 'contain',
            position: 'relative',
            zIndex: 1,
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.022em',
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          Welcome to UnClaw.
        </h2>
        <p
          style={{
            fontSize: 13.5,
            color: 'var(--text-secondary)',
            margin: 0,
            letterSpacing: '0.005em',
            lineHeight: 1.5,
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
