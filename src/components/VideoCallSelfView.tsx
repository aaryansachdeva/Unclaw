// Self-view for video call mode. A small mirrored tile of the user's camera,
// bottom-right of the stage, so they can see what she sees. Same frosted
// slate material as the rest of the chrome, corner radius from the token
// scale, no label: the ember dot on the input-bar button already says "live".
//
// The <video> element is the one useCameraFeed decodes into, so it must stay
// mounted while the mode is on; framer's exit animation keeps it around for
// the fade-out and then unmounts it.

import { motion, AnimatePresence } from 'framer-motion';
import type { RefObject } from 'react';

interface Props {
  active: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Bottom offset so the tile clears the input bar and the framing toggle. */
  bottom?: number;
}

export function VideoCallSelfView({ active, videoRef, bottom = 132 }: Props) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="self-view"
          initial={{ opacity: 0, scale: 0.94, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 4 }}
          transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
          style={{
            position: 'absolute',
            right: 16,
            bottom,
            width: 148,
            aspectRatio: '4 / 3',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            background: 'var(--glass-bg-panel)',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 14px rgba(0,0,0,0.30)',
            zIndex: 33,
            pointerEvents: 'none',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              // Mirrored like every self-view; the frame she receives is not.
              transform: 'scaleX(-1)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
