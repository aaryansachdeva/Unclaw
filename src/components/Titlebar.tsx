import { useState } from 'react';
import { motion } from 'framer-motion';
import { Pin, PinOff } from 'lucide-react';

export function Titlebar() {
  const [pinned, setPinned] = useState(true);

  const handlePin = () => {
    const next = !pinned;
    setPinned(next);
    window.electronAPI?.togglePin(next);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      className="absolute top-0 left-0 right-0 z-50"
      style={{
        WebkitAppRegion: 'drag',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
        padding: '10px 14px 24px 14px',
      } as React.CSSProperties}
    >
      <div className="flex items-center justify-between">
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.15em',
            color: 'rgba(255,255,255,0.4)',
          }}
        >
          UNCLAW
        </span>

        <div
          className="flex items-center"
          style={{ WebkitAppRegion: 'no-drag', gap: '4px' } as React.CSSProperties}
        >
          {([
            { action: handlePin, label: pinned ? 'Unpin from top' : 'Pin to top', icon: 'pin' },
            { action: () => window.electronAPI?.minimize(), label: 'Minimize', icon: 'min' },
            { action: () => window.electronAPI?.close(), label: 'Close', icon: 'close' },
          ] as const).map(({ action, label, icon }) => (
            <motion.button
              key={icon}
              whileTap={{ scale: 0.88 }}
              onClick={action}
              aria-label={label}
              title={label}
              className="glass-btn"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.08)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = icon === 'close'
                  ? 'rgba(200,122,122,0.15)'
                  : 'rgba(255,255,255,0.14)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              }}
            >
              {icon === 'pin' && (pinned
                ? <Pin size={11} color="var(--accent)" strokeWidth={2.5} />
                : <PinOff size={11} color="rgba(255,255,255,0.4)" strokeWidth={2} />
              )}
              {icon === 'min' && (
                <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
                  <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              )}
              {icon === 'close' && (
                <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
                  <line x1="1" y1="1" x2="8" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="8" y1="1" x2="1" y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              )}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
