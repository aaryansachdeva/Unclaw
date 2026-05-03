// Glass-aesthetic range slider built for the onboarding wizard's vibe step.
// No existing slider in the codebase to reuse, so this component owns its
// look. Pointer-driven (no native <input type="range"> because we need
// pixel control over the track and thumb to match the frosted-slate vibe).

import {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from 'react';
import { motion } from 'framer-motion';

interface SliderProps {
  /** 0..100 */
  value: number;
  onChange: (next: number) => void;
  /** Label at value=0. */
  leftLabel: string;
  /** Label at value=100. */
  rightLabel: string;
  /** Currently-selected bracket word, shown above the track. */
  word?: string | null;
  /** Caption under the track that names what's being tuned ("Formality"). */
  caption?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 18;
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function Slider({
  value,
  onChange,
  leftLabel,
  rightLabel,
  word,
  caption,
  ariaLabel,
  style,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const node = trackRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      const clamped = Math.max(0, Math.min(1, ratio));
      onChange(Math.round(clamped * 100));
    },
    [onChange],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setActive(true);
    setFromClientX(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setFromClientX(e.clientX);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    setActive(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  // Keyboard: arrow keys move by 1, shift+arrow by 10. Home/End jump.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next -= step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next += step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 100;
    else return;
    e.preventDefault();
    onChange(Math.max(0, Math.min(100, next)));
  };

  const lit = active || hovered || focused;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {/* Header row: caption (left) + current word (right) */}
      {(caption || word) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: 13,
          }}
        >
          {caption && (
            <span
              style={{
                color: 'var(--text-secondary)',
                letterSpacing: '0.02em',
                fontSize: 12.5,
              }}
            >
              {caption}
            </span>
          )}
          {word && (
            <motion.span
              key={word}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
              style={{
                color: 'var(--text-primary)',
                fontWeight: 500,
                letterSpacing: '0.005em',
                fontSize: 13,
                fontVariant: 'small-caps',
              }}
            >
              {word}
            </motion.span>
          )}
        </div>
      )}

      {/* Track */}
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={ariaLabel ?? caption ?? 'slider'}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          position: 'relative',
          height: THUMB_SIZE + 4,
          display: 'flex',
          alignItems: 'center',
          cursor: active ? 'grabbing' : 'pointer',
          touchAction: 'none',
          outline: 'none',
        }}
      >
        {/* Inactive track */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: TRACK_HEIGHT,
            background: 'rgba(255, 255, 255, 0.07)',
            borderRadius: TRACK_HEIGHT,
            boxShadow: '0 1px 0 rgba(255, 255, 255, 0.04) inset',
          }}
        />
        {/* Active track — gradient toward the thumb */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${value}%`,
            height: TRACK_HEIGHT,
            background:
              'linear-gradient(90deg, var(--accent-strong), var(--accent))',
            borderRadius: TRACK_HEIGHT,
            transition: 'width 0.06s linear',
          }}
        />
        {/* Halo — soft glow behind the thumb when lit */}
        <motion.div
          aria-hidden="true"
          animate={{
            opacity: lit ? 1 : 0,
            scale: active ? 1.1 : 1,
          }}
          transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
          style={{
            position: 'absolute',
            left: `calc(${value}% - 14px)`,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(196, 68, 68, 0.30), transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        {/* Thumb */}
        <motion.div
          aria-hidden="true"
          animate={{
            scale: active ? 1.08 : 1,
          }}
          transition={{ duration: 0.14, ease: EASE_OUT_EXPO }}
          style={{
            position: 'absolute',
            left: `calc(${value}% - ${THUMB_SIZE / 2}px)`,
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            borderRadius: '50%',
            background: 'var(--text-primary)',
            border: focused
              ? '2px solid var(--accent)'
              : '1px solid rgba(0, 0, 0, 0.30)',
            boxShadow: [
              '0 1px 0 rgba(255, 255, 255, 0.6) inset',
              active
                ? '0 4px 14px rgba(0, 0, 0, 0.55), 0 0 0 4px rgba(196, 68, 68, 0.16)'
                : '0 2px 6px rgba(0, 0, 0, 0.45)',
            ].join(', '),
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* End labels */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10.5,
          color: 'var(--text-secondary)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
