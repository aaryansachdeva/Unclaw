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
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--glass-bg, rgba(40,48,65,0.32))',
        border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
        backdropFilter: 'var(--glass-blur, blur(32px) saturate(1.6))',
        WebkitBackdropFilter: 'var(--glass-blur, blur(32px) saturate(1.6))',
        boxShadow: '0 4px 14px -6px rgba(0,0,0,0.5)',
        color: 'var(--text-secondary, #d4cec7)',
        cursor: 'pointer',
      } as React.CSSProperties}
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
          <Icon size={16} strokeWidth={1.9} />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
