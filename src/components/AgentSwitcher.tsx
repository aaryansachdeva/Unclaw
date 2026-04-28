import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Agent } from '../types';

interface AgentSwitcherProps {
  agents: Agent[];
  currentIndex: number;
  onSwitch: (index: number) => void;
  disabled?: boolean;
}

export function AgentSwitcher({ agents, currentIndex, onSwitch, disabled = false }: AgentSwitcherProps) {
  const prev = () => {
    if (disabled) return;
    onSwitch(currentIndex === 0 ? agents.length - 1 : currentIndex - 1);
  };
  const next = () => {
    if (disabled) return;
    onSwitch(currentIndex === agents.length - 1 ? 0 : currentIndex + 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
        borderRadius: '14px',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)',
        opacity: disabled ? 0.3 : 1,
        transition: 'opacity 0.25s var(--ease-out-quart)',
      }}
    >
      <motion.button
        whileHover={disabled ? {} : { scale: 1.1 }}
        whileTap={disabled ? {} : { scale: 0.88 }}
        onClick={prev}
        disabled={disabled}
        aria-label="Previous agent"
        className="glass-btn"
        style={{
          width: '24px', height: '24px', borderRadius: '7px',
          background: 'rgba(255,255,255,0.04)',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      >
        <ChevronLeft size={13} color="rgba(255,255,255,0.45)" strokeWidth={2} />
      </motion.button>

      <div style={{ minWidth: '60px', textAlign: 'center', overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          <motion.span
            key={currentIndex}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            style={{
              display: 'block',
              fontSize: '12.5px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            {agents[currentIndex]?.name}
          </motion.span>
        </AnimatePresence>
      </div>

      <motion.button
        whileHover={disabled ? {} : { scale: 1.1 }}
        whileTap={disabled ? {} : { scale: 0.88 }}
        onClick={next}
        disabled={disabled}
        aria-label="Next agent"
        className="glass-btn"
        style={{
          width: '24px', height: '24px', borderRadius: '7px',
          background: 'rgba(255,255,255,0.04)',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      >
        <ChevronRight size={13} color="rgba(255,255,255,0.45)" strokeWidth={2} />
      </motion.button>
    </motion.div>
  );
}
