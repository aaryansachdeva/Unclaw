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
import { ColorPickerPanel, hexToRgb01 } from './ColorPickerPanel';
import type { WardrobeSettings, ClothingColor } from '../services/userSettings';

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

// Curated garment palette for the per-category color submenu. r/g/b are
// 0-1 (sent verbatim as color1/color2 to UE's changeClothingColor, matching
// the changeLightColor convention). Two-tone garments take a primary
// (diffuse_color_1) and a secondary (diffuse_color_2) from this same set.
export const CLOTHING_COLORS: Array<{ label: string; hex: string; r: number; g: number; b: number }> = [
  { label: 'Black',    hex: '#1b1b1e', r: 0.106, g: 0.106, b: 0.118 },
  { label: 'Charcoal', hex: '#3a3d42', r: 0.227, g: 0.239, b: 0.259 },
  { label: 'Stone',    hex: '#8b8a84', r: 0.545, g: 0.541, b: 0.518 },
  { label: 'Ivory',    hex: '#ece5d6', r: 0.925, g: 0.898, b: 0.839 },
  { label: 'Sand',     hex: '#c8af89', r: 0.784, g: 0.686, b: 0.537 },
  { label: 'Rust',     hex: '#b45f39', r: 0.706, g: 0.373, b: 0.224 },
  { label: 'Burgundy', hex: '#792d39', r: 0.475, g: 0.176, b: 0.224 },
  { label: 'Olive',    hex: '#6a6939', r: 0.416, g: 0.412, b: 0.224 },
  { label: 'Forest',   hex: '#33543e', r: 0.200, g: 0.329, b: 0.243 },
  { label: 'Navy',     hex: '#2a395b', r: 0.165, g: 0.224, b: 0.357 },
  { label: 'Slate',    hex: '#556273', r: 0.333, g: 0.384, b: 0.451 },
  { label: 'Plum',     hex: '#593a5b', r: 0.349, g: 0.227, b: 0.357 },
];

// Categories whose garment master exposes diffuse_color_1/2. Hair is a
// groom (different material), so it has no clothing-color submenu.
const COLORABLE: WardrobeCategory[] = ['top', 'bottom', 'shoes'];

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

  // null = master category list; a category = its detail submenu (stepper +,
  // for colorable categories, the two color rows).
  const [activeCategory, setActiveCategory] = useState<WardrobeCategory | null>(null);
  // Per-category garment colors as palette indices. Defaults to (0,0).
  const [clothingColors, setClothingColors] = useState<Record<'top' | 'bottom' | 'shoes', ClothingColor>>(() => ({
    top:    clampColor(initial?.clothingColors?.top),
    bottom: clampColor(initial?.clothingColors?.bottom),
    shoes:  clampColor(initial?.clothingColors?.shoes),
  }));
  // Freeform accent (lighting) color override, set via the picker. Wins over
  // accentColorIndex when present.
  const [accentColorHex, setAccentColorHex] = useState<string | undefined>(initial?.accentColorHex);
  // Open color picker, anchored to the swatch that opened it. null = closed.
  type PickerTarget =
    | { kind: 'clothing'; cat: 'top' | 'bottom' | 'shoes'; slot: 'c1' | 'c2' }
    | { kind: 'accent' };
  const [picker, setPicker] = useState<{ target: PickerTarget; rect: DOMRect } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // In a category submenu, Escape backs out to the list first; only
        // closes the whole overlay from the top level.
        if (activeCategory !== null) setActiveCategory(null);
        else onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, activeCategory]);

  // Wardrobe staging mode follows the active view. ON in the category list and
  // the clothing details (full-body turntable to judge garments); OFF in the
  // HAIR detail, where we want a head-focused view and the wardrobe body pose
  // gets in the way. Fires on each ON/OFF transition (entering/leaving hair),
  // and closing the overlay (unmount) always drops back to OFF. This is the
  // single owner of wardrobeMode now — App.tsx no longer toggles it.
  const wardrobeStageOn = activeCategory !== 'hair';
  useEffect(() => {
    onEmit({ EventType: wardrobeStageOn ? 'wardrobeModeOn' : 'wardrobeModeOff' });
  }, [wardrobeStageOn, onEmit]);
  // Unmount = customization closed -> wardrobe mode off. Read onEmit off a ref so
  // a stream reconnect (which changes onEmit's identity) doesn't fire a spurious
  // off mid-session — only true unmount triggers this.
  const onEmitRef = useRef(onEmit);
  onEmitRef.current = onEmit;
  useEffect(() => () => { onEmitRef.current({ EventType: 'wardrobeModeOff' }); }, []);

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

  const emitLightColor = useCallback((rgb: { r: number; g: number; b: number }) => {
    onEmit({
      EventType: 'changeLightColor',
      'lightColor.r': rgb.r.toFixed(3),
      'lightColor.g': rgb.g.toFixed(3),
      'lightColor.b': rgb.b.toFixed(3),
    });
  }, [onEmit]);

  const handleAccent = useCallback((index: number) => {
    if (index < 0 || index >= ACCENT_COLORS.length) return;
    setAccentColorIndex(index);
    setAccentColorHex(undefined); // preset clears the custom override
    emitLightColor(ACCENT_COLORS[index]);
  }, [emitLightColor]);

  const handleAccentCustom = useCallback((hex: string) => {
    setAccentColorHex(hex);
    emitLightColor(hexToRgb01(hex));
  }, [emitLightColor]);

  // UE's changeClothingColor takes BOTH tones every time + the category. Each
  // slot's effective color is its custom hex if set, else the palette preset.
  const emitClothingColor = useCallback((cat: 'top' | 'bottom' | 'shoes', pair: ClothingColor) => {
    const a = pair.c1Hex ? hexToRgb01(pair.c1Hex) : CLOTHING_COLORS[pair.c1];
    const b = pair.c2Hex ? hexToRgb01(pair.c2Hex) : CLOTHING_COLORS[pair.c2];
    onEmit({
      EventType: 'changeClothingColor',
      wardrobeCategory: cat,
      'color1.r': a.r.toFixed(3), 'color1.g': a.g.toFixed(3), 'color1.b': a.b.toFixed(3),
      'color2.r': b.r.toFixed(3), 'color2.g': b.g.toFixed(3), 'color2.b': b.b.toFixed(3),
    });
  }, [onEmit]);

  // Preset pick: set the index AND clear that slot's custom hex (back to palette).
  const handleClothingColor = useCallback((
    cat: 'top' | 'bottom' | 'shoes', slot: 'c1' | 'c2', index: number,
  ) => {
    if (index < 0 || index >= CLOTHING_COLORS.length) return;
    const hexKey = slot === 'c1' ? 'c1Hex' : 'c2Hex';
    const nextPair: ClothingColor = { ...clothingColors[cat], [slot]: index, [hexKey]: undefined };
    setClothingColors((prev) => ({ ...prev, [cat]: nextPair }));
    emitClothingColor(cat, nextPair);
  }, [clothingColors, emitClothingColor]);

  // Custom pick (from the color picker): set the slot's freeform hex override.
  const handleClothingCustom = useCallback((
    cat: 'top' | 'bottom' | 'shoes', slot: 'c1' | 'c2', hex: string,
  ) => {
    const hexKey = slot === 'c1' ? 'c1Hex' : 'c2Hex';
    const nextPair: ClothingColor = { ...clothingColors[cat], [hexKey]: hex };
    setClothingColors((prev) => ({ ...prev, [cat]: nextPair }));
    emitClothingColor(cat, nextPair);
  }, [clothingColors, emitClothingColor]);

  const handleSave = useCallback(() => {
    onSave({
      topIndex, bottomIndex, shoesIndex, hairIndex,
      lightingAngle, accentColorIndex, accentColorHex,
      clothingColors,
    });
  }, [onSave, topIndex, bottomIndex, shoesIndex, hairIndex, lightingAngle, accentColorIndex, accentColorHex, clothingColors]);

  const activeAccent = accentColorHex
    ? { label: 'Custom', hex: accentColorHex }
    : (ACCENT_COLORS[accentColorIndex] ?? ACCENT_COLORS[0]);

  // Hex shown by the picker for whatever it's currently targeting.
  const pickerColor = (() => {
    if (!picker) return '#ffffff';
    if (picker.target.kind === 'accent') return accentColorHex ?? ACCENT_COLORS[accentColorIndex]?.hex ?? '#ffffff';
    const p = clothingColors[picker.target.cat];
    const slotHex = picker.target.slot === 'c1' ? p.c1Hex : p.c2Hex;
    return slotHex ?? CLOTHING_COLORS[picker.target.slot === 'c1' ? p.c1 : p.c2]?.hex ?? '#ffffff';
  })();

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
        pointerEvents: 'none',
        width: 260,
      }}>
        <AnimatePresence mode="wait" initial={false}>
          {activeCategory === null ? (
            // ----- master: tappable category list -----
            <motion.div
              key="master"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'auto' }}
            >
              {CATEGORY_ORDER.map((cat, i) => (
                <CategoryRow
                  key={cat}
                  category={cat}
                  value={getValue(cat)}
                  max={WARDROBE_BOUNDS[cat]}
                  onOpen={() => setActiveCategory(cat)}
                  delay={0.18 + i * 0.05}
                />
              ))}
            </motion.div>
          ) : (
            // ----- detail: stepper (+ color rows for clothing) -----
            <motion.div
              key={`detail-${activeCategory}`}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 14 }}
              transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
              style={{ display: 'flex', flexDirection: 'column', gap: 24, pointerEvents: 'auto' }}
            >
              <BackToCategories onClick={() => setActiveCategory(null)} />
              <ChevronVignette
                category={activeCategory}
                value={getValue(activeCategory)}
                max={WARDROBE_BOUNDS[activeCategory]}
                onPrev={() => handleStep(activeCategory, -1)}
                onNext={() => handleStep(activeCategory, 1)}
                delay={0}
              />
              {COLORABLE.includes(activeCategory) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {(['c1', 'c2'] as const).map((slot, idx) => {
                    const cat = activeCategory as 'top' | 'bottom' | 'shoes';
                    const pair = clothingColors[cat];
                    return (
                      <ColorRow
                        key={slot}
                        label={idx === 0 ? 'Color 1' : 'Color 2'}
                        activeIndex={pair[slot]}
                        customHex={slot === 'c1' ? pair.c1Hex : pair.c2Hex}
                        onPick={(i) => handleClothingColor(cat, slot, i)}
                        onOpenPicker={(rect) => setPicker({ target: { kind: 'clothing', cat, slot }, rect })}
                      />
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
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
            alignItems: 'center',
            gap: 12,
            padding: '2px 2px 4px 2px',
          }}>
            {ACCENT_COLORS.map((c, i) => (
              <AccentBulb
                key={c.label}
                color={c.hex}
                label={c.label}
                active={!accentColorHex && i === accentColorIndex}
                onClick={() => handleAccent(i)}
              />
            ))}
            <CustomSwatch
              customHex={accentColorHex}
              onOpen={(rect) => setPicker({ target: { kind: 'accent' }, rect })}
            />
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

      {/* Freeform color picker popover, anchored to whichever swatch opened it. */}
      <AnimatePresence>
        {picker && (
          <ColorPickerPanel
            color={pickerColor}
            anchorRect={picker.rect}
            onChange={(hex) => {
              if (picker.target.kind === 'accent') handleAccentCustom(hex);
              else handleClothingCustom(picker.target.cat, picker.target.slot, hex);
            }}
            onClose={() => setPicker(null)}
          />
        )}
      </AnimatePresence>
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

// ============ category row (master list) ===============================
// Tappable row: caps label · "n / N" · enter chevron. Opens the category's
// detail submenu. Frosted-slate hover, whisper-quiet at rest.

function CategoryRow({
  category, value, max, onOpen, delay,
}: {
  category: WardrobeCategory; value: number; max: number; onOpen: () => void; delay: number;
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT_EXPO, delay }}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.985 }}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: 232,
        padding: '11px 14px',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 12,
        cursor: 'pointer',
        transition:
          'background 200ms var(--ease-out-quart), border-color 200ms var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.09)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <span style={{
        flex: 1,
        textAlign: 'left',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'var(--text-primary)',
        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
      }}>
        {CATEGORY_LABELS[category]}
      </span>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-ghost)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.04em',
        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
      }}>
        {value + 1} / {max}
      </span>
      <ChevronRight
        size={16}
        strokeWidth={1.8}
        style={{ color: 'var(--text-ghost)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))' }}
      />
    </motion.button>
  );
}

// ============ back-to-categories affordance ============================

function BackToCategories({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ x: -2 }}
      whileTap={{ scale: 0.96 }}
      style={{
        pointerEvents: 'auto',
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 2px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-ghost)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        textShadow: '0 1px 3px rgba(0,0,0,0.55)',
        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
      }}
    >
      <ChevronLeft size={14} strokeWidth={2} />
      Categories
    </motion.button>
  );
}

// ============ color row (swatch strip) =================================
// Section label + wrapping strip of garment swatches. Active swatch wears
// a white ring (constant size, so picking never reflows the grid).

function ColorRow({
  label, activeIndex, customHex, onPick, onOpenPicker,
}: {
  label: string;
  activeIndex: number;
  customHex?: string;
  onPick: (i: number) => void;
  onOpenPicker: (rect: DOMRect) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 232 }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
        {CLOTHING_COLORS.map((c, i) => (
          <ClothingSwatch
            key={c.label}
            color={c.hex}
            label={c.label}
            active={!customHex && i === activeIndex}
            onClick={() => onPick(i)}
          />
        ))}
        <CustomSwatch customHex={customHex} onOpen={onOpenPicker} />
      </div>
    </div>
  );
}

// Trailing "custom color" chip: a rainbow conic-gradient at rest (opens the
// picker), or the chosen color (with the active ring) once a custom hex is set.
function CustomSwatch({
  customHex, onOpen,
}: { customHex?: string; onOpen: (rect: DOMRect) => void }) {
  const active = !!customHex;
  return (
    <motion.button
      type="button"
      title={active ? `Custom ${customHex}` : 'Custom color…'}
      aria-label="Custom color"
      whileHover={{ scale: 1.14 }}
      whileTap={{ scale: 0.9 }}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      style={{
        pointerEvents: 'auto',
        width: 19,
        height: 19,
        padding: 0,
        border: 'none',
        borderRadius: 7,
        cursor: 'pointer',
        // Always the rainbow — it's the "open the picker" affordance, not a
        // color readout. The active ring still signals a custom color is set.
        background: 'conic-gradient(from 0deg, #ff5b5b, #ffd25b, #6bff8e, #5bd0ff, #9b7bff, #ff6bd6, #ff5b5b)',
        boxShadow: active
          ? '0 0 0 2px rgba(0,0,0,0.55), 0 0 0 3.5px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.5)'
          : '0 0 0 1px rgba(255,255,255,0.2), 0 1px 3px rgba(0,0,0,0.45)',
        transition: 'box-shadow 200ms var(--ease-out-quart)',
      }}
    />
  );
}

function ClothingSwatch({
  color, label, active, onClick,
}: { color: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.14 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      style={{
        pointerEvents: 'auto',
        width: 19,
        height: 19,
        padding: 0,
        border: 'none',
        borderRadius: 7,
        background: color,
        cursor: 'pointer',
        // dark gap + white ring when active; subtle hairline otherwise.
        boxShadow: active
          ? '0 0 0 2px rgba(0,0,0,0.55), 0 0 0 3.5px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.5)'
          : '0 0 0 1px rgba(255,255,255,0.14), 0 1px 3px rgba(0,0,0,0.45)',
        transition: 'box-shadow 200ms var(--ease-out-quart)',
      }}
    />
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

function clampColorIndex(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(CLOTHING_COLORS.length - 1, Math.floor(value)));
}

function clampColor(c: ClothingColor | undefined): ClothingColor {
  return {
    c1: clampColorIndex(c?.c1), c2: clampColorIndex(c?.c2),
    c1Hex: c?.c1Hex, c2Hex: c?.c2Hex,
  };
}
