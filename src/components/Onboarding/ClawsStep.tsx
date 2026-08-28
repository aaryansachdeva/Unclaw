// Onboarding step that introduces Claws — the in-app currency. Earned by
// interacting (1 per message), spent to unlock characters (and, later,
// accessories + more). New accounts start with 1000 claws. Informational only.
//
// Band layout, like every other step: header across the top with the Claws
// mark as a decorative anchor at its right, then the three rows full width
// underneath. Single content column, one visual language across the wizard.

import { motion } from 'framer-motion';
import { MessageCircle, Sparkles, ShoppingBag } from 'lucide-react';
import { ClawsIcon } from '../ClawsBalance';
import { StepHeader } from './StepHeader';
import { STARTING_CLAWS } from '../../services/claws';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 760, maxWidth: '100%' }}>
      {/* Header band. The mark rides at its right as decoration, filling
          the band's natural height rather than opening a second column. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 28 }}>
        <StepHeader
          title="Meet Claws"
          subtitle={`Your in-app currency. You start with ${STARTING_CLAWS}.`}
          wide
        />
        <motion.div
          initial={{ scale: 0.82, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          style={{
            position: 'relative',
            width: 116,
            height: 116,
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
          <ClawsIcon size={104} animated style={{ position: 'relative', zIndex: 1 }} />
        </motion.div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Row
          delay={0.05}
          icon={<MessageCircle size={16} strokeWidth={2.2} />}
          title="Earn by talking"
          body="Earn a claw every time you message."
        />
        <Row
          delay={0.12}
          icon={<ShoppingBag size={16} strokeWidth={2.2} />}
          title="Unlock characters"
          body="Use them to unlock new characters. No purchase needed."
        />
        <Row
          delay={0.19}
          icon={<Sparkles size={16} strokeWidth={2.2} />}
          title="More to come"
          body="Outfits, accessories, and extras, soon."
        />
      </div>
    </div>
  );
}
