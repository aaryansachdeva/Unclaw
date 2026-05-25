// Circular lighting helper for wardrobe mode. A draggable sun glyph
// orbits a stylized character silhouette; dragging streams the angle
// out via `onChange` so UE can update the scene lighting live.
//
// Angle convention matches the on-stage feel: 0° = directly above
// (12 o'clock, like a key spot), 90° = camera-right, 180° = behind
// (rim light), 270° = camera-left. atan2 + the +90 rotation below
// maps screen coordinates to that frame so the sun's screen position
// is always literally where the user expects the light to be coming
// from.
//
// The silhouette gets a subtle directional shadow opposite the sun
// so the UI is responsive *visually* the instant the user drags,
// even before the WebRTC stream catches up.

import { useCallback, useEffect, useRef, useState } from 'react';

interface LightingDialProps {
  /** Current angle in degrees, 0-360. 0 = above, clockwise. */
  value: number;
  /** Fires while the user drags. Throttled by the parent if needed —
   *  we already raf-coalesce here so consecutive pointermove events
   *  in the same frame collapse to a single emit. */
  onChange: (angle: number) => void;
  /** Optional — pixel size of the dial. Defaults to 188 for the
   *  ~268px-wide sheet body with comfortable margins. */
  size?: number;
}

export function LightingDial({ value, onChange, size = 188 }: LightingDialProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);
  // raf coalescing — collapse same-frame pointermove deltas into one
  // emit so we don't post 200 messages/sec to UE during a fast drag.
  const rafRef = useRef<number | null>(null);
  const pendingAngleRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    rafRef.current = null;
    const a = pendingAngleRef.current;
    pendingAngleRef.current = null;
    if (a != null) onChange(a);
  }, [onChange]);

  const queueAngle = useCallback((angle: number) => {
    pendingAngleRef.current = angle;
    if (rafRef.current == null) {
      rafRef.current = window.requestAnimationFrame(flushPending);
    }
  }, [flushPending]);

  const angleFromEvent = useCallback((clientX: number, clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return value;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // atan2 returns angle from +x axis, counter-clockwise. Add 90 to
    // shift origin to +y axis (12 o'clock = 0°), negate to flip to
    // clockwise, wrap to 0-360.
    const rad = Math.atan2(dy, dx);
    const deg = (rad * 180) / Math.PI;
    const norm = (deg + 90 + 360) % 360;
    return Math.round(norm);
  }, [value]);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    queueAngle(angleFromEvent(e.clientX, e.clientY));
  }, [angleFromEvent, queueAngle]);

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    queueAngle(angleFromEvent(e.clientX, e.clientY));
  }, [dragging, angleFromEvent, queueAngle]);

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    setDragging(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // Cancel any in-flight rAF on unmount so we don't emit after the
  // component has been unmounted (e.g. user closes the wardrobe panel
  // mid-drag).
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  // Geometry — everything derives from size so the dial scales cleanly.
  const cx = size / 2;
  const cy = size / 2;
  const ringRadius = size * 0.42;
  const sunRadius = size * 0.072;
  // Center subject — a single small sphere that reads as "the thing
  // being lit". Cleaner than a figure silhouette, and the dynamic
  // highlight on it (positioned at the sun's side via fx/fy on the
  // radial gradient) does the work of communicating direction.
  const sphereR = size * 0.10;

  // Sun position from the current angle.
  const rad = ((value - 90) * Math.PI) / 180;
  const sunX = cx + ringRadius * Math.cos(rad);
  const sunY = cy + ringRadius * Math.sin(rad);

  // Unit vector pointing FROM the sphere center toward the sun.
  // Drives both the sphere's highlight position and the shadow's
  // displacement on the ground beneath it.
  const dirX = Math.cos(rad);
  const dirY = Math.sin(rad);

  // Highlight inside the sphere gradient — at the sun-facing side.
  // 50% is center; ±35% gives a strong directional read without
  // pushing the highlight off the sphere entirely.
  const hlFx = 50 + dirX * 35;
  const hlFy = 50 + dirY * 35;

  // Cast shadow — small ground-shadow ellipse just behind the sphere,
  // biased AWAY from the sun. Reads as "the sphere sits on a surface
  // and the light catches one side" rather than a thrown javelin.
  // Aspect ratio stays close to 1.6:1 (mild ovaling, not extreme),
  // and the offset is small so the shadow stays anchored to the
  // sphere instead of detaching across the dial.
  const shadowLong  = sphereR * 0.75;
  const shadowShort = sphereR * 0.50;
  const shadowOffset = sphereR * 0.55;  // mostly under sphere, slight bias
  const shadowCx = cx + (-dirX) * shadowOffset;
  const shadowCy = cy + (-dirY) * shadowOffset;
  // Rotation in degrees, oriented along the shadow direction. SVG's
  // rotate() takes degrees; atan2 returns radians from +x axis.
  const shadowDeg = Math.atan2(-dirY, -dirX) * 180 / Math.PI;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      userSelect: 'none',
      touchAction: 'none',
    }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          cursor: dragging ? 'grabbing' : 'grab',
          // A faint inner glow so the dial reads as a contained
          // surface, not floating glyphs. drop-shadow + the warm-red
          // glow on the sun do the heavy visual work.
          filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.35))',
          // The sun's halo (radius ~ 0.19 × size) is anchored to the
          // ring (radius 0.42 × size from center) — at 0° / 180° its
          // outer edge sits just outside the SVG viewport. Allow the
          // SVG to paint into surrounding padding so the halo isn't
          // clipped flat at the top/bottom.
          overflow: 'visible',
        }}
      >
        <defs>
          {/* Ring track gradient — the side facing the sun is slightly
              brighter, so the user can tell direction at a glance. */}
          <radialGradient
            id="ld-ring-glow"
            cx={`${(sunX / size) * 100}%`}
            cy={`${(sunY / size) * 100}%`}
            r="60%"
          >
            <stop offset="0%" stopColor="rgba(196, 68, 68, 0.55)" />
            <stop offset="40%" stopColor="rgba(196, 68, 68, 0.18)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 0.04)" />
          </radialGradient>
          {/* Sun glow — small soft halo around the draggable glyph. */}
          <radialGradient id="ld-sun-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="rgba(255, 200, 170, 1)" />
            <stop offset="55%" stopColor="rgba(196, 68, 68, 0.85)" />
            <stop offset="100%" stopColor="rgba(196, 68, 68, 0)" />
          </radialGradient>
          {/* Sphere — radial gradient with dynamic highlight position.
              The highlight (fx/fy) tracks the sun direction, so as the
              user drags the sun the lit side of the sphere shifts with
              it. Pure visual physics, no figure needed. */}
          <radialGradient
            id="ld-sphere"
            cx="50%" cy="50%" r="55%"
            fx={`${hlFx}%`} fy={`${hlFy}%`}
          >
            <stop offset="0%"   stopColor="rgba(255, 240, 220, 0.96)" />
            <stop offset="42%"  stopColor="rgba(195, 200, 215, 0.78)" />
            <stop offset="100%" stopColor="rgba(36, 42, 58, 0.45)" />
          </radialGradient>
        </defs>

        {/* Ring track */}
        <circle
          cx={cx}
          cy={cy}
          r={ringRadius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        {/* Glow ring — only visible on the sun-facing side */}
        <circle
          cx={cx}
          cy={cy}
          r={ringRadius}
          fill="none"
          stroke="url(#ld-ring-glow)"
          strokeWidth={size * 0.045}
          opacity={dragging ? 0.95 : 0.7}
          style={{
            transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />

        {/* Cardinal ticks at 0/90/180/270 — small whisper to anchor
            the rotation without committing to a numeric dial. */}
        {[0, 90, 180, 270].map((tick) => {
          const tRad = ((tick - 90) * Math.PI) / 180;
          const inner = ringRadius - 5;
          const outer = ringRadius + 5;
          return (
            <line
              key={tick}
              x1={cx + inner * Math.cos(tRad)}
              y1={cy + inner * Math.sin(tRad)}
              x2={cx + outer * Math.cos(tRad)}
              y2={cy + outer * Math.sin(tRad)}
              stroke="rgba(255, 255, 255, 0.18)"
              strokeWidth={1}
              strokeLinecap="round"
            />
          );
        })}

        {/* Cast shadow — elongated ellipse projecting from the sphere
            in the anti-sun direction, rotated so its long axis aligns
            with the throw. As the sun orbits, the shadow swings around
            the sphere in lockstep, opposite side.
            transform-origin is the shadow's own center so the rotate
            spins it in place (not around the dial center). */}
        <ellipse
          cx={shadowCx}
          cy={shadowCy}
          rx={shadowLong}
          ry={shadowShort}
          fill="rgba(0, 0, 0, 0.32)"
          transform={`rotate(${shadowDeg} ${shadowCx} ${shadowCy})`}
          style={{
            transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            filter: 'blur(1.5px)',
          }}
        />

        {/* Subject — a single sphere lit from the sun's direction.
            The radial gradient's fx/fy is recomputed each render so
            the highlight tracks the sun continuously while dragging. */}
        <circle
          cx={cx}
          cy={cy}
          r={sphereR}
          fill="url(#ld-sphere)"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={0.5}
        />

        {/* Sun glyph — the draggable handle */}
        <g
          style={{
            transition: dragging
              ? 'none'
              : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            transformOrigin: `${sunX}px ${sunY}px`,
            transform: dragging ? 'scale(1.08)' : 'scale(1)',
          }}
        >
          {/* halo */}
          <circle
            cx={sunX}
            cy={sunY}
            r={sunRadius * 2.6}
            fill="url(#ld-sun-halo)"
          />
          {/* core */}
          <circle
            cx={sunX}
            cy={sunY}
            r={sunRadius}
            fill="rgba(255, 220, 195, 1)"
            stroke="rgba(196, 68, 68, 0.9)"
            strokeWidth={1.5}
          />
        </g>
      </svg>

      {/* Live angle readout — same letterspaced whisper voice as the
          rest of the app's ambient labels. The section header above
          says "Lighting", so this row just carries the number. */}
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: dragging ? 'var(--accent)' : 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
        transition: 'color 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {Math.round(value)}°
      </div>
    </div>
  );
}
