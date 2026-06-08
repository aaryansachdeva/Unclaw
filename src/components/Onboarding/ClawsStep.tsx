// Onboarding step that introduces Claws — the in-app currency. Earned by
// interacting (1 per message), spent to unlock characters (and, later,
// accessories + more). New accounts start with 1000 claws. Informational only.
//
// Layout mirrors the WelcomeStep / sign-in screen: a large Claws mark on the
// left with a soft accent halo, content (title + balance + rows) on the right,
// so the wizard reads as one continuous visual language.

import { motion } from 'framer-motion';
import { MessageCircle, Sparkles, ShoppingBag } from 'lucide-react';
import { ClawsIcon } from '../ClawsBalance';
import { STARTING_CLAWS, CHARACTER_CLAW_COST } from '../../services/claws';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

function Row({ icon, title, body, delay }: { icon: React.ReactNode; title: string; body: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay }}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}
    >
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          width: 32,
          height: 32,
          borderRadius: 9,
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(196, 68, 68, 0.14)',
          color: 'var(--accent, #c44444)',
        }}
      >
        {icon}
      </span>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 1 }}>{body}</div>
      </div>
    </motion.div>
  );
}

export function ClawsStep() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 34,
        padding: '6px 0 6px 24px',
      }}
    >
      {/* Left: the big Claws mark with a soft accent halo + breathing glow,
          mirroring BrandLogo on the welcome / sign-in screen. */}
      <motion.div
        initial={{ scale: 0.82, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 22 }}
        style={{
          position: 'relative',
          width: 156,
          height: 156,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: -8,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(196, 68, 68, 0.22) 0%, rgba(196, 68, 68, 0.06) 50%, transparent 75%)',
            filter: 'blur(10px)',
            pointerEvents: 'none',
          }}
        />
        <ClawsIcon size={128} animated style={{ position: 'relative', zIndex: 1 }} />
      </motion.div>

      {/* Right: title + starting balance + the three rows. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Meet Claws
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>
            Your in-app currency. You start with{' '}
            <b style={{ color: 'var(--text-primary)' }}>{STARTING_CLAWS}</b>
            <ClawsIcon size={13} style={{ display: 'inline-block', verticalAlign: '-2px', margin: '0 1px 0 3px' }} />.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Row
            delay={0.05}
            icon={<MessageCircle size={16} strokeWidth={2.2} />}
            title="Earn by talking"
            body="1 claw per message you send."
          />
          <Row
            delay={0.12}
            icon={<ShoppingBag size={16} strokeWidth={2.2} />}
            title="Unlock characters"
            body={`${CHARACTER_CLAW_COST} claws adds a new character. No purchase needed.`}
          />
          <Row
            delay={0.19}
            icon={<Sparkles size={16} strokeWidth={2.2} />}
            title="More to come"
            body="Outfits, accessories, and extras, soon."
          />
        </div>
      </div>
    </div>
  );
}
