// Onboarding step that introduces Claws — the in-app currency. Earned by
// interacting (1 per message), spent to unlock characters (and, later,
// accessories + more). New accounts start with 250 claws. Informational only.

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0' }}>
      {/* Hero: the mark + the starting balance. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          style={{
            flex: '0 0 auto',
            width: 64,
            height: 64,
            borderRadius: 16,
            display: 'grid',
            placeItems: 'center',
            background: 'radial-gradient(circle at 50% 35%, rgba(196,68,68,0.22), transparent 70%)',
          }}
        >
          <ClawsIcon size={46} animated />
        </motion.div>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Meet Claws
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '3px 0 0', lineHeight: 1.5 }}>
            Your in-app currency. You're starting with{' '}
            <b style={{ color: 'var(--text-primary)' }}>{STARTING_CLAWS}</b>
            <ClawsIcon size={13} style={{ display: 'inline-block', verticalAlign: '-2px', margin: '0 1px 0 3px' }} />.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Row
          delay={0.05}
          icon={<MessageCircle size={16} strokeWidth={2.2} />}
          title="Earn by interacting"
          body="Every message you send earns you 1 claw. The more you talk with your companion, the more you stack up."
        />
        <Row
          delay={0.12}
          icon={<ShoppingBag size={16} strokeWidth={2.2} />}
          title="Unlock characters"
          body={`Spend ${CHARACTER_CLAW_COST} claws to add a new character to your roster — no purchase needed.`}
        />
        <Row
          delay={0.19}
          icon={<Sparkles size={16} strokeWidth={2.2} />}
          title="More to come"
          body="Accessories, outfits, and other extras will be unlockable with claws too."
        />
      </div>
    </div>
  );
}
