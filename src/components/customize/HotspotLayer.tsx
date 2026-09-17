// The overview: a spot on each part of her you can change, a hairline out to
// the side, and the part's name with what she is wearing there. No panels. The
// labels share a layoutId with the inspector title, so tapping one flies the
// name across into the panel that opens.

import { useState } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO } from './kit';
import { REGION_LABEL, REGION_SIDE, type Point, type RegionId } from './regions';

export interface Spot {
  id: RegionId;
  point: Point;
  /** What is on her there right now ("Layered", "Default"). */
  detail: string;
}

const COLUMN = 150;      // label column width from the window edge
const GAP = 10;          // leader stops this far from the label
const HEADER_CLEAR = 122; // labels stay below the name and Save

export function HotspotLayer({ spots, light, width, onOpen }: {
  spots: Spot[];
  light: (Point & { behind: boolean; hex: string; detail: string }) | null;
  width: number;
  onOpen: (id: RegionId) => void;
}) {
  const [hot, setHot] = useState<RegionId | null>(null);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {spots.map((s, i) => {
        const side = REGION_SIDE[s.id];
        const labelX = side === 'right' ? width - COLUMN : COLUMN;
        // The crown sits under the header in the full-figure shot, so the label
        // drops into a clear band and the leader slopes up to the spot.
        const labelY = Math.max(s.point.y, HEADER_CLEAR);
        const lineFrom = side === 'right' ? s.point.x + 12 : labelX + GAP;
        const lineTo = side === 'right' ? labelX - GAP : s.point.x - 12;
        const dx = lineTo - lineFrom;
        const dy = labelY - s.point.y;
        const on = hot === s.id;
        const delay = 0.08 + i * 0.06;
        return (
          <div key={s.id}>
            {dx > 8 && (
              <motion.span
                aria-hidden
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: on ? 0.9 : 0.42 }}
                transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay }}
                style={{
                  position: 'absolute', left: lineFrom, top: s.point.y,
                  width: Math.hypot(dx, dy), height: 1,
                  background: 'var(--cz-bone, #fafafa)',
                  transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
                  transformOrigin: side === 'right' ? 'left center' : 'right center',
                  boxShadow: '0 0 6px rgba(0,0,0,0.5)',
                }}
              />
            )}
            <SpotButton point={s.point} label={REGION_LABEL[s.id]} on={on} delay={delay}
              onHover={(v) => setHot(v ? s.id : null)} onOpen={() => onOpen(s.id)} />
            <motion.button
              type="button"
              onClick={() => onOpen(s.id)}
              onMouseEnter={() => setHot(s.id)}
              onMouseLeave={() => setHot(null)}
              className="cz-focus cz-label"
              initial={{ opacity: 0, x: side === 'right' ? -8 : 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay: delay + 0.12 }}
              style={{
                position: 'absolute', top: labelY - 17, pointerEvents: 'auto',
                ...(side === 'right' ? { left: labelX, textAlign: 'left' } : { right: width - labelX, textAlign: 'right' }),
                maxWidth: COLUMN - 16, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: side === 'right' ? 'flex-start' : 'flex-end',
                fontFamily: 'inherit', textShadow: '0 1px 2px rgba(0,0,0,0.7), 0 0 16px rgba(0,0,0,0.45)',
              }}
            >
              <motion.span
                layoutId={`cz-region-${s.id}`}
                style={{ fontSize: 15, lineHeight: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary, #fafafa)', whiteSpace: 'nowrap' }}
              >
                {REGION_LABEL[s.id]}
              </motion.span>
              <span style={{
                fontSize: 12, lineHeight: '16px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                color: on ? 'var(--text-primary, #fafafa)' : 'var(--text-secondary, #d4cec7)', transition: 'color 160ms var(--ease-out-quart)',
              }}>
                {s.detail}
              </span>
            </motion.button>
          </div>
        );
      })}

      {light && (
        <motion.button
          type="button"
          onClick={() => onOpen('scene')}
          aria-label={`Light, ${light.detail}`}
          className="cz-focus"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: light.behind ? 0.62 : 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: 0.1 }}
          whileHover={{ scale: 1.08 }}
          style={{
            position: 'absolute', left: light.x - 36, top: light.y - 22, width: 72, pointerEvents: 'auto',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
          }}
        >
          <span style={{
            width: 20, height: 20, borderRadius: '50%',
            background: `radial-gradient(circle at 38% 34%, #fffaf2 0%, ${light.hex} 42%, ${light.hex} 100%)`,
            boxShadow: `0 0 0 1.5px rgba(250,250,250,0.85), 0 0 22px 6px ${light.hex}88, 0 0 60px 12px ${light.hex}33`,
          }} />
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textShadow: '0 1px 2px rgba(0,0,0,0.7), 0 0 16px rgba(0,0,0,0.45)' }}>
            <motion.span layoutId="cz-region-scene" style={{ fontSize: 14, lineHeight: '17px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary, #fafafa)' }}>
              Light
            </motion.span>
            <span style={{ fontSize: 11.5, lineHeight: '15px', color: 'var(--text-secondary, #d4cec7)', whiteSpace: 'nowrap' }}>{light.detail}</span>
          </span>
        </motion.button>
      )}
    </div>
  );
}

/** A bone core with a slow breathing ring. The ring is the only idle motion on
 *  the surface, and it stops under reduced motion. */
function SpotButton({ point, label, on, delay, onHover, onOpen }: {
  point: Point;
  label: string;
  on: boolean;
  delay: number;
  onHover: (v: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <span style={{
      position: 'absolute', left: 0, top: 0, width: 40, height: 40, pointerEvents: 'none',
      transform: `translate(${point.x - 20}px, ${point.y - 20}px)`, transition: 'transform 140ms linear',
    }}>
    <motion.button
      type="button"
      aria-label={label}
      onClick={onOpen}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="cz-focus"
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay }}
      style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'none', border: 'none', padding: 0, cursor: 'pointer', pointerEvents: 'auto',
      }}
    >
      <span className="cz-spot-ring" style={{ animationDelay: `${delay}s` }} />
      <span style={{
        position: 'absolute', left: '50%', top: '50%', width: 10, height: 10, margin: -5, borderRadius: '50%',
        background: 'var(--cz-bone, #fafafa)',
        boxShadow: on
          ? '0 0 0 4px rgba(250,250,250,0.22), 0 0 18px 3px rgba(255,233,214,0.75)'
          : '0 0 0 3px rgba(7,8,11,0.35), 0 0 14px 2px rgba(255,233,214,0.5)',
        transform: on ? 'scale(1.25)' : 'scale(1)',
        transition: 'transform 220ms var(--ease-out-quart), box-shadow 220ms var(--ease-out-quart)',
      }} />
    </motion.button>
    </span>
  );
}
