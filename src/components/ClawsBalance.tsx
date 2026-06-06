// Claws currency UI: the icon + the balance pill that sits next to the profile.
// Claws are the in-app currency (earn by interacting, spend to unlock
// characters). See services/claws.ts for the server-authoritative balance.

import { motion } from 'framer-motion';
import clawsIconUrl from '../assets/claws.svg';

// 4-point star clip path for the twinkle sparkles.
const STAR = 'polygon(50% 0%, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0% 50%, 39% 39%)';

// Sparkle positions (as % of the icon box) + stagger so they twinkle out of
// phase, like light catching the facets of a coin. Big + lively.
const SPARKLES = [
  { top: '-12%', left: '64%', s: 0.42, delay: 0.0 },
  { top: '58%', left: '-14%', s: 0.34, delay: 1.1 },
  { top: '78%', left: '70%', s: 0.30, delay: 1.9 },
  { top: '4%', left: '8%', s: 0.26, delay: 2.7 },
];

function Sparkle({ size, top, left, s, delay }: { size: number; top: string; left: string; s: number; delay: number }) {
  const sp = Math.max(4, size * s);
  return (
    <motion.span
      aria-hidden
      initial={{ scale: 0, opacity: 0, rotate: 0 }}
      animate={{ scale: [0, 1, 0], opacity: [0, 1, 0], rotate: [0, 90, 140] }}
      transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2.6, delay, ease: 'easeInOut' }}
      style={{
        position: 'absolute',
        top,
        left,
        width: sp,
        height: sp,
        marginTop: -sp / 2,
        marginLeft: -sp / 2,
        background: 'radial-gradient(circle, #fff 0%, #ffe6cc 55%, transparent 75%)',
        clipPath: STAR,
        pointerEvents: 'none',
        willChange: 'transform, opacity',
      }}
    />
  );
}

/** The Claws mark. `size` in px. Animated by default (glint sweep + soft glow +
 *  twinkling sparkles) everywhere it appears; pass `animated={false}` for a flat
 *  static version. */
export function ClawsIcon({
  size = 16,
  animated = true,
  style,
}: {
  size?: number;
  animated?: boolean;
  style?: React.CSSProperties;
}) {
  if (!animated) {
    return (
      <img
        src={clawsIconUrl}
        alt="Claws"
        draggable={false}
        style={{ width: size, height: size, objectFit: 'contain', display: 'block', ...style }}
      />
    );
  }
  const maskStyle: React.CSSProperties = {
    maskImage: `url(${clawsIconUrl})`,
    WebkitMaskImage: `url(${clawsIconUrl})`,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  };
  return (
    <span
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-block',
        flex: '0 0 auto',
        ...style,
      }}
    >
      {/* The mark, with a rich warm glow for presence — static (no flashing),
          layered so it reads as a real ambient halo, not a thin outline. */}
      <img
        src={clawsIconUrl}
        alt="Claws"
        draggable={false}
        style={{
          position: 'relative',
          width: size,
          height: size,
          objectFit: 'contain',
          display: 'block',
          filter:
            'drop-shadow(0 0 4px rgba(255,160,120,0.6)) drop-shadow(0 0 10px rgba(255,120,90,0.4))',
        }}
      />
      {/* Specular glint — a thin band of light that sweeps across the claw
          silhouette (masked to the actual shape), like light catching a
          polished surface. Frequent + bright. */}
      <motion.span
        aria-hidden
        animate={{ backgroundPosition: ['180% 0%', '-80% 0%'] }}
        transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1.1, ease: [0.4, 0, 0.2, 1] }}
        style={{
          position: 'absolute',
          inset: 0,
          ...maskStyle,
          background:
            'linear-gradient(108deg, transparent 38%, rgba(255,244,228,0.0) 44%, rgba(255,248,235,0.92) 50%, rgba(255,244,228,0.0) 56%, transparent 62%)',
          backgroundSize: '260% 100%',
          mixBlendMode: 'screen',
          pointerEvents: 'none',
          willChange: 'background-position',
        }}
      />
      {SPARKLES.map((p, i) => <Sparkle key={i} size={size} {...p} />)}
    </span>
  );
}

/** Balance pill for the top chrome: icon + count. `null` balance renders a
 *  quiet placeholder (loading / signed-out). */
export function ClawsBalance({ balance }: { balance: number | null }) {
  return (
    <div
      title={balance == null ? 'Claws' : `${balance} claws`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 30,
        padding: '0 13px 0 10px',
        borderRadius: 999,
        background: 'var(--glass-bg, rgba(40, 48, 65, 0.5))',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        color: 'var(--text-primary)',
        fontSize: 13.5,
        fontWeight: 700,
        letterSpacing: '0.01em',
        userSelect: 'none',
      }}
    >
      <ClawsIcon size={18} animated />
      <span>{balance == null ? '—' : balance.toLocaleString()}</span>
    </div>
  );
}

/** Inline price chip (icon + amount) for store cards — e.g. "200 🦞". */
export function ClawsPrice({ amount, size = 11 }: { amount: number; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {amount}
      <ClawsIcon size={size} />
    </span>
  );
}
