// The UnClaw mark with its soft accent halo + slow breathing glow.
// Shared by the wizard's welcome ("Get started") and auth (sign-in)
// steps so both columns read as the same brand moment. Size is a prop
// so the auth step can run it a touch smaller than the welcome screen.

import { motion } from 'framer-motion';
import logoUrl from '../../assets/logo_lg.png';

export function BrandLogo({ size = 168 }: { size?: number }) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Soft accent halo behind the logo. */}
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
          width: size,
          height: size,
          objectFit: 'contain',
          position: 'relative',
          zIndex: 1,
        }}
      />
    </div>
  );
}
