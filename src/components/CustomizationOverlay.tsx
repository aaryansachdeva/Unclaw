// Customization mode, full-screen overlay.
//
// Same spatial composition as before (left rail of typographic
// pickers + right column of dial / accent / save), but pulled back
// into the existing Unclaw design vocabulary: Plus Jakarta Sans,
// frosted-slate glass at brand intensities, warm-red used sparingly,
// no display serif, no grain texture, no editorial nameplate.
//
// "Whisper, don't shout." The number is still the hero of each
// vignette, but in the brand body font with tight letterspacing
// instead of an italic serif. The chrome around the controls is
// the same glass + blur language as the existing widget panels , 
// the mode feels like a continuation of the app, not a separate
// world.
//
// Animations from the earlier draft are preserved (the user
// specifically liked the entrance choreography): backdrop fade,
// left-rail vignettes cascade in from -x, right column drifts in
// from +x, save lifts up last.

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, ArrowLeft } from 'lucide-react';
import { LightingDial } from './LightingDial';
import type { WardrobeSettings } from '../services/userSettings';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const WARDROBE_BOUNDS = {
  top:    4,
  bottom: 6,
  shoes:  4,
  hair:   5,
} as const;

export type WardrobeCategory = keyof typeof WARDROBE_BOUNDS;

// Order is anatomical top-to-bottom so the left rail reads like a
// body diagram from head to feet.
const CATEGORY_ORDER: WardrobeCategory[] = ['hair', 'top', 'bottom', 'shoes'];

const CATEGORY_LABELS: Record<WardrobeCategory, string> = {
  hair:   'Hair',
  top:    'Top',
  bottom: 'Bottom',
  shoes:  'Shoes',
};

// Exported so App can look up the RGB for a saved index when it fires
// changeLightColor on stream-connect / reset.
export const ACCENT_COLORS: Array<{ label: string; hex: string; r: number; g: number; b: number }> = [
  { label: 'Warm white', hex: '#f0e8d6', r: 0.94, g: 0.91, b: 0.84 },
  { label: 'Amber',      hex: '#ffaa55', r: 1.00, g: 0.67, b: 0.33 },
  { label: 'Rose',       hex: '#f08899', r: 0.94, g: 0.53, b: 0.60 },
  { label: 'Moonlight',  hex: '#6bb6ee', r: 0.42, g: 0.71, b: 0.93 },
  { label: 'Magenta',    hex: '#d066d0', r: 0.82, g: 0.40, b: 0.82 },
  { label: 'Forest',     hex: '#74c98f', r: 0.45, g: 0.79, b: 0.56 },
];

interface CustomizationOverlayProps {
  initial?: WardrobeSettings | null;
  onEmit: (payload: Record<string, unknown>) => void;
  onSave: (settings: WardrobeSettings) => void;
  /** Close without saving, try-on behavior. */
  onCancel: () => void;
}

export function CustomizationOverlay({
  initial, onEmit, onSave, onCancel,
}: CustomizationOverlayProps) {
  const [topIndex,    setTopIndex   ] = useState(clampIndex('top',    initial?.topIndex));
  const [bottomIndex, setBottomIndex] = useState(clampIndex('bottom', initial?.bottomIndex));
  const [shoesIndex,  setShoesIndex ] = useState(clampIndex('shoes',  initial?.shoesIndex));
  const [hairIndex,   setHairIndex  ] = useState(clampIndex('hair',   initial?.hairIndex));
  const [lightingAngle, setLightingAngle] = useState(clampAngle(initial?.lightingAngle ?? 0));
  const [accentColorIndex, setAccentColorIndex] = useState(clampAccent(initial?.accentColorIndex));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const getValue = (cat: WardrobeCategory): number => ({
    top: topIndex, bottom: bottomIndex, shoes: shoesIndex, hair: hairIndex,
  })[cat];

  const setValue = (cat: WardrobeCategory, n: number) => {
    switch (cat) {
      case 'top':    setTopIndex(n); break;
      case 'bottom': setBottomIndex(n); break;
      case 'shoes':  setShoesIndex(n); break;
      case 'hair':   setHairIndex(n); break;
    }
  };

  const handleStep = useCallback((cat: WardrobeCategory, step: 1 | -1) => {
    const max = WARDROBE_BOUNDS[cat];
    const current = getValue(cat);
    const next = ((current + step) % max + max) % max;
    setValue(cat, next);
    onEmit({
      EventType: 'changeWardrobeItem',
      wardrobeCategory: cat,
      wardrobeIndex: next,
    });
  }, [topIndex, bottomIndex, shoesIndex, hairIndex, onEmit]);

  const handleLighting = useCallback((angle: number) => {
    setLightingAngle(angle);
    onEmit({ EventType: 'changeLightAngle', lightAngle: String(angle) });
  }, [onEmit]);

  const handleAccent = useCallback((index: number) => {
    if (index < 0 || index >= ACCENT_COLORS.length) return;
    setAccentColorIndex(index);
    const c = ACCENT_COLORS[index];
    onEmit({
      EventType: 'changeLightColor',
      'lightColor.r': c.r.toFixed(3),
      'lightColor.g': c.g.toFixed(3),
      'lightColor.b': c.b.toFixed(3),
    });
  }, [onEmit]);

  const handleSave = useCallback(() => {
    onSave({
      topIndex, bottomIndex, shoesIndex, hairIndex,
      lightingAngle, accentColorIndex,
    });
  }, [onSave, topIndex, bottomIndex, shoesIndex, hairIndex, lightingAngle, accentColorIndex]);

  const activeAccent = ACCENT_COLORS[accentColorIndex] ?? ACCENT_COLORS[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
      style={{
        position: 'absolute',
        inset: 0,
        // Above the Titlebar (z-50). The overlay root keeps
        // pointer-events: none so empty areas pass clicks through to
        // the Titlebar beneath (drag region + window controls still
        // work); each floating control re-enables events for itself.
        zIndex: 55,
        pointerEvents: 'none',
      }}
    >
      {/* Subtle edge vignette, same restraint pattern the existing
          chrome uses (whisper, don't shout). Just enough to focus the
          eye toward the centered character, no atmospheric drama. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.32) 100%)',
        }}
      />

      {/* Back-button + label cluster, anchored to the LEFT under the
          macOS traffic lights. Both elements sit in the same horizontal
          row so they read as one beat: the back affordance leading the
          eye to the small-caps mode label. Below the traffic-light row
          (which occupies y ~8–28 on macOS), padded enough that the
          glass circle never collides with the close button. */}
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay: 0.18 }}
        style={{
          // y=80 (not 52) keeps the cluster BELOW the Titlebar's drag
          // region (~y0-76). Because this cluster is a DOM sibling of
          // the Titlebar (not a descendant), the no-drag flag below
          // can't override AppKit's compositor-level drag hit-test
          // where the regions overlap; the upper strip of the button
          // would get eaten as a window-drag start instead of an
          // onClick. y=80 puts the whole button outside the overlap.
          position: 'absolute',
          top: 80,
          left: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          // The overlay root is pointer-events: none so empty areas
          // pass clicks through to the stream. Each floating control
          // needs to re-enable its own pointer events; otherwise the
          // back button feels dead. Pair with no-drag so AppKit's
          // traffic-light row above doesn't intercept the click.
          pointerEvents: 'auto',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Back"
          title="Back"
          className="glass-btn"
          style={{
            width: 32,
            height: 32,
            padding: 0,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.10)',
            color: 'var(--text-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition:
              'background 180ms var(--ease-out-quart), border-color 180ms var(--ease-out-quart)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.10)';
          }}
        >
          <ArrowLeft size={15} strokeWidth={1.8} />
        </button>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.20em',
            textTransform: 'uppercase',
            color: 'var(--text-ghost)',
            textShadow: '0 1px 3px rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          Customization
        </span>
      </motion.div>

      {/* ===== Left rail, chevron vignettes ============================
          Typographic, no card chrome. Each picker: caps label whisper
          above, big number in the brand body font, "of N" grounded
          below. Chevrons are Lucide icons at refined small size , 
          matching the existing widget-pill icon vocabulary. */}
      <div style={{
        position: 'absolute',
        left: 56,
        top: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 32,
        pointerEvents: 'none',
      }}>
        {CATEGORY_ORDER.map((cat, i) => (
          <ChevronVignette
            key={cat}
            category={cat}
            value={getValue(cat)}
            max={WARDROBE_BOUNDS[cat]}
            onPrev={() => handleStep(cat, -1)}
            onNext={() => handleStep(cat, 1)}
            delay={0.22 + i * 0.06}
          />
        ))}
      </div>

      {/* ===== Right column, dial, accent palette, save =============== */}
      <div style={{
        position: 'absolute',
        right: 56,
        top: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-end',
        gap: 38,
        pointerEvents: 'none',
      }}>
        {/* Lighting, section label whisper + the dial. No card around
            the dial, it floats. Angle readout lives inside the
            LightingDial component itself, now in brand body font.
            Fixed width matches the accent block below so the two
            stacked controls share a vertical center line. */}
        <motion.div
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: 0.26 }}
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            width: 200,
          }}
        >
          <SectionLabel>Lighting</SectionLabel>
          <LightingDial value={lightingAngle} onChange={handleLighting} size={168} />
        </motion.div>

        {/* Accent palette, six bulbs. Active one grows + glows in its
            own hue. Above the row: section label + current color name
            in the same letterspaced caps voice (NOT a serif italic
           , keep the brand language consistent), tinted in the
            current color. */}
        <motion.div
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: 0.34 }}
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            // Same fixed width as the Lighting block above so both
            // share a centerline beneath the right column.
            width: 200,
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            height: 14,
          }}>
            <SectionLabel>Accent</SectionLabel>
            <AnimatePresence mode="wait">
              <motion.span
                key={activeAccent.label}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: activeAccent.hex,
                  textShadow: `0 1px 4px rgba(0,0,0,0.55), 0 0 10px ${activeAccent.hex}40`,
                }}
              >
                {activeAccent.label}
              </motion.span>
            </AnimatePresence>
          </div>
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '2px 2px 4px 2px',
          }}>
            {ACCENT_COLORS.map((c, i) => (
              <AccentBulb
                key={c.label}
                color={c.hex}
                label={c.label}
                active={i === accentColorIndex}
                onClick={() => handleAccent(i)}
              />
            ))}
          </div>
        </motion.div>
      </div>

      {/* ===== Save, bottom-right anchor ================================
          Brand widget-button language: caps, letterspaced, green (the
          --live token, same color Reminders uses for "completed" , 
          signals a finishing/committing gesture). */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.03, y: -1 }}
        whileTap={{ scale: 0.96 }}
        onClick={handleSave}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay: 0.5 }}
        className="glass-btn"
        style={{
          position: 'absolute',
          bottom: 30,
          right: 30,
          pointerEvents: 'auto',
          padding: '11px 22px',
          borderRadius: 12,
          background: 'color-mix(in srgb, var(--live) 24%, rgba(20, 24, 32, 0.55))',
          border: '1px solid color-mix(in srgb, var(--live) 65%, transparent)',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          color: '#e6f5e0',
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          cursor: 'pointer',
          boxShadow:
            '0 8px 24px -8px color-mix(in srgb, var(--live) 50%, transparent), 0 1px 0 rgba(255,255,255,0.08) inset',
          transition:
            'background 220ms var(--ease-out-quart), border-color 220ms var(--ease-out-quart), box-shadow 220ms var(--ease-out-quart)',
        }}
      >
        <Check size={13} strokeWidth={2.6} />
        Save
      </motion.button>
    </motion.div>
  );
}

// ============ chevron vignette (typographic) ===========================
// Caps label · big number · "of N", no card. Plus Jakarta Sans
// throughout. Hover state nudges the chevrons inward as a tiny tell
// that they're tappable.

interface ChevronVignetteProps {
  category: WardrobeCategory;
  value: number;
  max: number;
  onPrev: () => void;
  onNext: () => void;
  delay: number;
}

function ChevronVignette({
  category, value, max, onPrev, onNext, delay,
}: ChevronVignetteProps) {
  // Wrap-aware direction tracking for the split-flap animation.
  const prevValueRef = useRef(value);
  let direction: 1 | -1 = 1;
  if (value !== prevValueRef.current) {
    const raw = value - prevValueRef.current;
    direction = raw > 0
      ? (raw > max / 2 ? -1 : 1)
      : (Math.abs(raw) > max / 2 ? 1 : -1);
    prevValueRef.current = value;
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -18, y: 4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT_EXPO, delay }}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 160,
      }}
    >
      {/* Caps label, same letterspaced whisper voice the rest of the
          app uses for category labels. */}
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.30em',
        textTransform: 'uppercase',
        color: 'var(--text-ghost)',
        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
        marginBottom: 6,
      }}>
        {CATEGORY_LABELS[category]}
      </div>

      {/* Hero row, chevron · number · chevron. The number split-flaps
          in the tap direction; chevrons stay put. */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 48,
      }}>
        <ChevronBtn dir="prev" onClick={onPrev} />

        <div style={{
          position: 'relative',
          width: 46,
          height: 46,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <AnimatePresence initial={false} custom={direction} mode="wait">
            <motion.span
              key={value}
              custom={direction}
              variants={flipVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 38,
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.025em',
                textShadow: '0 2px 12px rgba(0,0,0,0.65)',
              }}
            >
              {value + 1}
            </motion.span>
          </AnimatePresence>
        </div>

        <ChevronBtn dir="next" onClick={onNext} />
      </div>

      {/* "of N", grounded below in the brand body font, ghost color. */}
      <div style={{
        marginTop: 5,
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--text-ghost)',
        letterSpacing: '0.04em',
        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        of {max}
      </div>
    </motion.div>
  );
}

const flipVariants = {
  enter: (d: 1 | -1) => ({ y: d > 0 ? 22 : -22, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit:  (d: 1 | -1) => ({ y: d > 0 ? -22 : 22, opacity: 0 }),
};

function ChevronBtn({ dir, onClick }: { dir: 'prev' | 'next'; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      whileHover={{
        scale: 1.15,
        x: dir === 'next' ? 2 : -2,
        color: 'var(--text-primary)',
      }}
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      aria-label={dir === 'next' ? 'Next' : 'Previous'}
      className="glass-btn"
      style={{
        pointerEvents: 'auto',
        width: 28,
        height: 28,
        padding: 0,
        background: 'transparent',
        border: '1px solid transparent',
        color: 'var(--text-ghost)',
        cursor: 'pointer',
        borderRadius: 8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition:
          'color 200ms var(--ease-out-quart), background 200ms var(--ease-out-quart), border-color 200ms var(--ease-out-quart)',
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.10)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      {dir === 'prev'
        ? <ChevronLeft size={16} strokeWidth={1.8} />
        : <ChevronRight size={16} strokeWidth={1.8} />}
    </motion.button>
  );
}

// ============ section label ============================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.30em',
      textTransform: 'uppercase',
      color: 'var(--text-ghost)',
      textShadow: '0 1px 3px rgba(0,0,0,0.55)',
    }}>
      {children}
    </div>
  );
}

// ============ accent bulb ============================================
// Small color dot that lights up in its own hue when active. The row
// reads like a string of stage bulbs at the side of the runway , 
// quiet at rest, glowing when chosen.

function AccentBulb({
  color, label, active, onClick,
}: { color: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      style={{
        pointerEvents: 'auto',
        width: active ? 14 : 11,
        height: active ? 14 : 11,
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        background: color,
        cursor: 'pointer',
        boxShadow: active
          ? `0 0 0 1.5px rgba(255,255,255,0.20), 0 0 16px ${color}, 0 0 4px ${color}`
          : `0 0 0 1px rgba(255,255,255,0.12), 0 1px 3px rgba(0,0,0,0.40)`,
        transition:
          'width 220ms var(--ease-out-quart), height 220ms var(--ease-out-quart), box-shadow 220ms var(--ease-out-quart)',
      }}
    />
  );
}

// ============ helpers ==================================================

function clampIndex(category: WardrobeCategory, value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  const max = WARDROBE_BOUNDS[category];
  return Math.max(0, Math.min(max - 1, Math.floor(value)));
}

function clampAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(value) % 360) + 360) % 360;
}

function clampAccent(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(ACCENT_COLORS.length - 1, Math.floor(value)));
}
