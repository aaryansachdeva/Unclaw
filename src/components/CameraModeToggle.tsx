// Camera framing toggle — ONE button that cycles through the three shots now
// that the renderer drives the camera (updateCameraFromLocation): Default (the
// character's resting position) → Waist (medium, halfway out) → Full (the whole
// figure, same zoom-out customization uses) → back to Default.
//
// The button shows the shot it'll switch you TO (the NEXT mode), not the one
// you're on — so in Default you see the Waist icon, in Waist you see Full, in
// Full you see Default. The icon crossfades as you flip. Frosted-slate to match
// the rest of the chrome.

import { motion, AnimatePresence } from 'framer-motion';
import { User, Contact, PersonStanding, type LucideIcon } from 'lucide-react';
import { CAMERA_MODES, type CameraMode } from '../wardrobe/camera';

const MODE_META: Record<CameraMode, { icon: LucideIcon; label: string }> = {
  default: { icon: User,           label: 'Default' }, // head & shoulders
  waist:   { icon: Contact,        label: 'Waist' },   // upper body
  full:    { icon: PersonStanding, label: 'Full' },    // whole figure
};

export function CameraModeToggle({ mode, onChange }: {
  mode: CameraMode;
  onChange: (m: CameraMode) => void;
}) {
  const next = CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length];
  const { icon: Icon, label } = MODE_META[next];

  return (
    <motion.button
      type="button"
      onClick={() => onChange(next)}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      title={`Switch to ${label} shot`}
      aria-label={`Switch camera to ${label} framing`}
      className="glass-btn"
      // Ambient control (2026-09-15): invisible at rest like the wardrobe
      // button beside it, glass on hover. It used to be the one always-lit
      // 44 px disc floating over the character's shoulder.
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: '1px solid transparent',
        color: 'var(--text-primary)',
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
        cursor: 'pointer',
        transition: 'background 0.2s var(--ease-out-quart), border-color 0.2s var(--ease-out-quart), filter 0.2s var(--ease-out-quart)',
      } as React.CSSProperties}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--glass-bg-hover)';
        e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
        e.currentTarget.style.filter = 'none';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))';
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={next}
          initial={{ opacity: 0, scale: 0.6, y: 3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, y: -3 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          style={{ display: 'inline-flex' }}
        >
          <Icon size={17} strokeWidth={2} />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
