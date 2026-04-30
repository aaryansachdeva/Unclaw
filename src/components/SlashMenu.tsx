// Floating slash-command palette. Anchored above the input zone,
// rendered when the input value starts with `/`. Pure presentation —
// keyboard nav, filtering, and action dispatch live in
// `useSlashCommands`.

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

import { SlashAPI, SlashItem } from '../hooks/useSlashCommands';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface SlashMenuProps {
  api: SlashAPI;
  /** Click-select handler. The dock owns the textarea so it needs to
   *  clear input + refocus after a selection runs. */
  onSelect: (item: SlashItem) => void;
  /** Hover-driven highlight update so mouse and keyboard agree. */
  onHover: (index: number) => void;
}

export function SlashMenu({ api, onSelect, onHover }: SlashMenuProps) {
  const reduce = useReducedMotion() ?? false;
  const visible = api.active && api.items.length > 0;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="slash-menu"
          role="listbox"
          aria-label="Slash commands"
          initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 14,
            width: 320,
            maxWidth: 'calc(100vw - 28px)',
            padding: 6,
            borderRadius: 14,
            background: 'var(--glass-bg-panel)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border-focus)',
            boxShadow: [
              '0 1px 0 rgba(255,255,255,0.06) inset',
              '0 12px 28px -8px rgba(0,0,0,0.45)',
            ].join(', '),
            zIndex: 40,
          }}
        >
          {api.items.map((item, i) => {
            const Icon = item.icon;
            const highlighted = i === api.highlightedIndex;
            return (
              <motion.button
                key={item.command}
                role="option"
                type="button"
                aria-selected={highlighted}
                initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.18,
                  delay: reduce ? 0 : i * 0.03,
                  ease: EASE_OUT_EXPO,
                }}
                onClick={() => onSelect(item)}
                onMouseEnter={() => onHover(i)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: highlighted
                    ? 'var(--accent-dim)'
                    : 'transparent',
                  color: highlighted
                    ? 'var(--text-primary)'
                    : 'var(--text-primary)',
                  transform: highlighted ? 'scale(1.02)' : 'scale(1)',
                  transformOrigin: 'left center',
                  transition:
                    'background 120ms var(--ease-out-quart), transform 120ms var(--ease-out-quart)',
                }}
              >
                <Icon
                  size={14}
                  strokeWidth={2}
                  color={highlighted ? 'var(--accent)' : 'var(--text-secondary)'}
                  aria-hidden
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: 'ui-monospace, "SFMono-Regular", "Menlo", monospace',
                    color: highlighted ? 'var(--accent)' : 'var(--text-primary)',
                  }}
                >
                  {item.command}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 400,
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.description}
                </span>
              </motion.button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
