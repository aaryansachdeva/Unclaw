// CustomWardrobe — customization for the custom-pipeline characters
// (grace_custom / kevin_custom / syd_custom), which carry 34 hair, 18 brows and
// 6 lashes with real thumbnails. A blind stepper can't browse that; you need to
// see them.
//
// THE SHAPE: A REEL, NOT A DRAWER
// First attempt was a 336px drawer with a 4-column grid. Wrong on both counts:
// it ate 44% of a 760px window (she's the product, not the chrome), and a grid
// forces tiles big enough to fill a row. A reel inverts that. One horizontal
// row of small frames, scrubbed sideways, is how you actually browse a set:
// film contact sheets, camera rolls, the macOS Dock. It costs ~150px instead of
// 336, the tiles get SMALLER as the set gets bigger, and she stays whole.
//
// The selected frame grows and lifts out of the reel and the strip centers it.
// That's the entire selection affordance: motion and scale, not a heavy ring.
// It reads at a glance and it's the one bit of delight this surface gets.
//
// THE BAR FLOATS AND BREATHES
// Not a full-bleed drawer pinned to the edge (that reads as a slab and competes
// with the stream). A frosted bar inset 10px on three sides, so it's an object
// in the room rather than a wall of it. Its height animates per pane: a reel
// needs 150px, the backdrop needs 100, light needs 140. Chrome takes what it
// needs and gives the rest back.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Check } from 'lucide-react';
import type { WardrobeSettings, ClothingColor } from '../services/userSettings';
import { ColorPickerPanel, hexToRgb01, round3 } from './ColorPickerPanel';
import { LightingDial } from './LightingDial';
import {
  ValueSlider, ACCENT_COLORS, CLOTHING_COLORS, BG_COLORS,
  LIGHT_INTENSITY_MIN, LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_DEFAULT,
  BG_GLOW_MIN, BG_GLOW_MAX, BG_GLOW_DEFAULT, BackdropStylePicker,
} from './CustomizationOverlay';
import { clampBgMode } from '../wardrobe/backgrounds';
import {
  CUSTOM_CATEGORY_ORDER, CUSTOM_CATEGORY_LABELS, CUSTOM_COLORABLE,
  itemsFor, clampCustomIndex, type CustomCategory, type WardrobeItem,
} from '../wardrobe/catalog';
import {
  STREAM_EFFECTS, EffectSwatch, effectFor,
  DEFAULT_EFFECT_ID, DEFAULT_EFFECT_STRENGTH,
} from './StreamEffects';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

// Body and Environment are not garment slots, so they ride alongside the six
// wardrobe categories rather than inside CUSTOM_CATEGORY_ORDER (which is the
// UE wardrobeCategory contract and must stay exactly the six UE accepts).
// Effects merged into Environment (2026-07-19): one "the room" pane holds
// light + backdrop + post effects, so there's no separate lens tab.
type Pane = CustomCategory | 'body' | 'environment';
const PANES: Pane[] = [...CUSTOM_CATEGORY_ORDER, 'body', 'environment'];
const PANE_LABELS: Record<Pane, string> = {
  ...CUSTOM_CATEGORY_LABELS,
  body: 'Body',
  environment: 'Environment',
};

// Chip-strip separator: after the character panes (her), before the room.
// Two groups now: her | the room.
const GROUP_BREAK_AFTER = new Set<Pane>(['body']);

// Wardrobe staging (the full-body turntable) is the DEFAULT. It's off only for
// the three face slots, where the body pose fights a head-level framing and
// you're judging millimetres of brow. Everything else wants the whole figure:
// garments obviously, Body because height and weight ARE the silhouette, and
// Environment because you're lighting a stage, not a face.
const FACE_PANES: Pane[] = ['hair', 'eyebrow', 'eyelash'];

// Frame geometry. 52px is deliberately small: the reel is scrubbed, not
// scanned, and the selected frame blows up to 1.22x anyway. Smaller frames mean
// more of the set visible at once, which is the whole point of a reel.
const FRAME = 52;
const FRAME_SELECTED = 1.22;

/** Per-pane bar height. The bar animates between these. */
function barHeight(pane: Pane): number {
  if (pane === 'body') return 182;
  // Environment holds light + backdrop (+ style) on the left and post effects
  // on the right, side by side, so it stays compact and non-scrolling.
  if (pane === 'environment') return 216;
  return CUSTOM_COLORABLE.includes(pane as CustomCategory) ? 178 : 146;
}

interface CustomWardrobeProps {
  initial?: WardrobeSettings | null;
  onEmit: (payload: Record<string, unknown>) => void;
  onSave: (settings: WardrobeSettings) => void;
  onCancel: () => void;
  /** Live-preview a post effect. Separate from onEmit because effects are
   *  composited in the renderer and never reach UE. */
  onEffect?: (fx: { effectId: string; effectStrength: number }) => void;
  /** GLOBAL backdrop style index (bgmode); backdrop is not per-instance. */
  bgMode?: number;
  /** Persist a new global backdrop style index. */
  onBgMode?: (index: number) => void;
}

export function CustomWardrobe({ initial, onEmit, onSave, onCancel, onEffect, bgMode, onBgMode }: CustomWardrobeProps) {
  const [pane, setPane] = useState<Pane>('hair');

  const [hair,    setHair]    = useState(() => clampCustomIndex('hair',    initial?.hairIndex));
  const [eyebrow, setEyebrow] = useState(() => clampCustomIndex('eyebrow', initial?.browIndex));
  const [eyelash, setEyelash] = useState(() => clampCustomIndex('eyelash', initial?.lashIndex));
  const [top,     setTop]     = useState(() => clampCustomIndex('top',     initial?.topIndex));
  const [bottom,  setBottom]  = useState(() => clampCustomIndex('bottom',  initial?.bottomIndex));
  const [shoes,   setShoes]   = useState(() => clampCustomIndex('shoes',   initial?.shoesIndex));

  const [clothingColors, setClothingColors] = useState<Record<'top' | 'bottom' | 'shoes', ClothingColor>>(() => ({
    top:    normalizeColor(initial?.clothingColors?.top),
    bottom: normalizeColor(initial?.clothingColors?.bottom),
    shoes:  normalizeColor(initial?.clothingColors?.shoes),
  }));

  // Bipolar body axes. One signed lever per axis; the pair is derived at emit.
  const [heightBlend, setHeightBlend] = useState(() => clamp(initial?.heightBlend, -1, 1, 0));
  const [weightBlend, setWeightBlend] = useState(() => clamp(initial?.weightBlend, -1, 1, 0));

  const [lightingAngle, setLightingAngle] = useState(() => clampAngle(initial?.lightingAngle ?? 0));
  const [lightIntensity, setLightIntensity] = useState(() => clamp(initial?.lightIntensity, LIGHT_INTENSITY_MIN, LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_DEFAULT));
  const [accentIndex, setAccentIndex] = useState(() => clampIdx(initial?.accentColorIndex, ACCENT_COLORS.length));
  const [accentHex, setAccentHex] = useState<string | undefined>(initial?.accentColorHex);

  const [bgIndex, setBgIndex] = useState(() => clampIdx(initial?.bgColorIndex, BG_COLORS.length));
  const [bgHex, setBgHex] = useState<string | undefined>(initial?.bgColorHex);
  const [bgGlow, setBgGlow] = useState(() => clamp(initial?.bgGlow, BG_GLOW_MIN, BG_GLOW_MAX, BG_GLOW_DEFAULT));

  type PickerTarget =
    | { kind: 'clothing'; cat: 'top' | 'bottom' | 'shoes'; slot: 'c1' | 'c2' }
    | { kind: 'accent' }
    | { kind: 'bg' };
  const [picker, setPicker] = useState<{ target: PickerTarget; rect: DOMRect } | null>(null);

  // Dirty tracking: save persists ONLY what the user touched this session,
  // merged over the previous save. Untouched keys stay absent so the re-dress
  // chain leaves UE's authored defaults alone (a full snapshot would fabricate
  // index 0 / angle 0 for panes the user never opened and force them onto the
  // character at every switch). Same scheme as CustomizationOverlay.
  const touchedRef = useRef<Set<string>>(new Set());
  const touch = (key: string) => { touchedRef.current.add(key); };

  const value = (cat: CustomCategory) => ({ hair, eyebrow, eyelash, top, bottom, shoes })[cat];
  const setValue = (cat: CustomCategory, n: number) => {
    switch (cat) {
      case 'hair':    setHair(n); break;
      case 'eyebrow': setEyebrow(n); break;
      case 'eyelash': setEyelash(n); break;
      case 'top':     setTop(n); break;
      case 'bottom':  setBottom(n); break;
      case 'shoes':   setShoes(n); break;
    }
  };

  // Post effects. Live-previewed through onEffect rather than onEmit: these
  // never reach UE, they're composited over the <video> in the renderer.
  const [effectId, setEffectId] = useState(() => initial?.effectId ?? DEFAULT_EFFECT_ID);
  const [effectStrength, setEffectStrength] = useState(
    () => clamp(initial?.effectStrength, 0, 1, DEFAULT_EFFECT_STRENGTH));

  const applyEffect = useCallback((id: string, strength: number) => {
    setEffectId(id);
    setEffectStrength(strength);
    touch('effect');
    onEffect?.({ effectId: id, effectStrength: strength });
  }, [onEffect]);

  const isGarment = pane !== 'body' && pane !== 'environment';
  const items: WardrobeItem[] = isGarment ? itemsFor(pane) : [];
  const selected = isGarment ? value(pane) : 0;

  const pickItem = useCallback((cat: CustomCategory, index: number) => {
    setValue(cat, index);
    touch(cat);
    onEmit({ EventType: 'changeWardrobeItem', wardrobeCategory: cat, wardrobeIndex: index });
  }, [onEmit]);

  // Arrow keys scrub the reel. A reel you can only click is half a reel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (!isGarment || items.length === 0) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const next = (selected + step + items.length) % items.length;
      pickItem(pane, next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, isGarment, items.length, selected, pane, pickItem]);

  const stageOn = !FACE_PANES.includes(pane);
  useEffect(() => {
    onEmit({ EventType: stageOn ? 'wardrobeModeOn' : 'wardrobeModeOff' });
  }, [stageOn, onEmit]);
  const onEmitRef = useRef(onEmit);
  onEmitRef.current = onEmit;
  useEffect(() => () => { onEmitRef.current({ EventType: 'wardrobeModeOff' }); }, []);

  const emitClothingColor = useCallback((cat: 'top' | 'bottom' | 'shoes', pair: ClothingColor) => {
    const a = pair.c1Hex ? hexToRgb01(pair.c1Hex) : CLOTHING_COLORS[pair.c1];
    const b = pair.c2Hex ? hexToRgb01(pair.c2Hex) : CLOTHING_COLORS[pair.c2];
    // Strings here, unlike changeLightColor/changeBG: this Blueprint still
    // parses with Get String Field as far as we know. If it moves to Get Number
    // Field, swap toFixed for round3 or the garment renders black.
    onEmit({
      EventType: 'changeClothingColor',
      wardrobeCategory: cat,
      'color1.r': a.r.toFixed(3), 'color1.g': a.g.toFixed(3), 'color1.b': a.b.toFixed(3),
      'color2.r': b.r.toFixed(3), 'color2.g': b.g.toFixed(3), 'color2.b': b.b.toFixed(3),
    });
  }, [onEmit]);

  const setTone = useCallback((cat: 'top' | 'bottom' | 'shoes', slot: 'c1' | 'c2', idx: number) => {
    const next: ClothingColor = { ...clothingColors[cat], [slot]: idx, [slot === 'c1' ? 'c1Hex' : 'c2Hex']: undefined };
    setClothingColors((p) => ({ ...p, [cat]: next }));
    touch(`cc:${cat}`);
    emitClothingColor(cat, next);
  }, [clothingColors, emitClothingColor]);

  const setToneHex = useCallback((cat: 'top' | 'bottom' | 'shoes', slot: 'c1' | 'c2', hex: string) => {
    const next: ClothingColor = { ...clothingColors[cat], [slot === 'c1' ? 'c1Hex' : 'c2Hex']: hex };
    setClothingColors((p) => ({ ...p, [cat]: next }));
    touch(`cc:${cat}`);
    emitClothingColor(cat, next);
  }, [clothingColors, emitClothingColor]);

  // Light + backdrop each ride ONE descriptor carrying every field: their
  // Blueprints read color and magnitude off the same Arguments Object, so a
  // partial send reads the omitted ones as 0 and blacks them out.
  const emitLight = useCallback((rgb: { r: number; g: number; b: number }, intensity: number) => {
    onEmit({
      EventType: 'changeLightColor',
      'lightColor.r': round3(rgb.r), 'lightColor.g': round3(rgb.g), 'lightColor.b': round3(rgb.b),
      lightIntensity: round3(intensity),
    });
  }, [onEmit]);
  const emitBG = useCallback((rgb: { r: number; g: number; b: number }, glow: number) => {
    onEmit({
      EventType: 'changeBGColor',
      'bgcolor.r': round3(rgb.r), 'bgcolor.g': round3(rgb.g), 'bgcolor.b': round3(rgb.b),
      value: round3(glow),
    });
  }, [onEmit]);

  // setBlends: two signed levers in, four unsigned blends out.
  //
  // UE exposes tall/short/fat/slim as four independent 0-1 morphs, but they're
  // two opposed PAIRS: you cannot be 0.6 tall and 0.4 short, that's just 0.2
  // tall through two morphs fighting each other. So the UI keeps one signed
  // lever per axis and splits it here. A positive height means tall=h, short=0;
  // negative means the reverse. Centred means both are 0 and she returns to her
  // authored proportions.
  //
  // The Blueprint SETs all four then fires Apply Blend All, so every field must
  // be present on every send or the omitted ones read 0 and silently reset that
  // axis. All numbers: Get Number Field returns 0 for a JSON string.
  const emitBlends = useCallback((height: number, weight: number) => {
    onEmit({
      EventType: 'setBlends',
      tall:  round3(Math.max(0, height)),
      short: round3(Math.max(0, -height)),
      fat:   round3(Math.max(0, weight)),
      slim:  round3(Math.max(0, -weight)),
    });
  }, [onEmit]);

  const accentRgb = useCallback(
    () => (accentHex ? hexToRgb01(accentHex) : (ACCENT_COLORS[accentIndex] ?? ACCENT_COLORS[0])),
    [accentHex, accentIndex]);
  const bgRgb = useCallback(
    () => (bgHex ? hexToRgb01(bgHex) : (BG_COLORS[bgIndex] ?? BG_COLORS[0])),
    [bgHex, bgIndex]);

  // Persist only what was touched, merged over the previous save (see the
  // touchedRef comment above). Assigning `undefined` on purpose (a preset
  // pick clearing a custom hex) removes the key at JSON-serialization time.
  const handleSave = useCallback(() => {
    const touched = touchedRef.current;
    const out: WardrobeSettings = { ...(initial ?? {}) };
    if (touched.has('top'))     out.topIndex    = top;
    if (touched.has('bottom'))  out.bottomIndex = bottom;
    if (touched.has('shoes'))   out.shoesIndex  = shoes;
    if (touched.has('hair'))    out.hairIndex   = hair;
    if (touched.has('eyebrow')) out.browIndex   = eyebrow;
    if (touched.has('eyelash')) out.lashIndex   = eyelash;
    if (touched.has('heightBlend')) out.heightBlend = heightBlend;
    if (touched.has('weightBlend')) out.weightBlend = weightBlend;
    if (touched.has('lightingAngle'))  out.lightingAngle  = lightingAngle;
    if (touched.has('lightIntensity')) out.lightIntensity = lightIntensity;
    if (touched.has('accent')) {
      out.accentColorIndex = accentIndex;
      out.accentColorHex = accentHex;
    }
    if (touched.has('bg')) {
      out.bgColorIndex = bgIndex;
      out.bgColorHex = bgHex;
    }
    if (touched.has('bgGlow')) out.bgGlow = bgGlow;
    if (touched.has('effect')) {
      out.effectId = effectId;
      out.effectStrength = effectStrength;
    }
    const ccTouched = (['top', 'bottom', 'shoes'] as const)
      .filter((cat) => touched.has(`cc:${cat}`));
    if (ccTouched.length > 0) {
      out.clothingColors = { ...(initial?.clothingColors ?? {}) };
      for (const cat of ccTouched) out.clothingColors[cat] = clothingColors[cat];
    }
    onSave(out);
  }, [onSave, initial, top, bottom, shoes, hair, eyebrow, eyelash, heightBlend, weightBlend,
      lightingAngle, lightIntensity,
      accentIndex, accentHex, bgIndex, bgHex, bgGlow, clothingColors,
      effectId, effectStrength]);

  const pickerColor = useMemo(() => {
    if (!picker) return '#ffffff';
    if (picker.target.kind === 'accent') return accentHex ?? ACCENT_COLORS[accentIndex]?.hex ?? '#ffffff';
    if (picker.target.kind === 'bg') return bgHex ?? BG_COLORS[bgIndex]?.hex ?? '#ffffff';
    const p = clothingColors[picker.target.cat];
    const hex = picker.target.slot === 'c1' ? p.c1Hex : p.c2Hex;
    return hex ?? CLOTHING_COLORS[picker.target.slot === 'c1' ? p.c1 : p.c2]?.hex ?? '#ffffff';
  }, [picker, accentHex, accentIndex, bgHex, bgIndex, clothingColors]);

  const activeItem = isGarment ? items[selected] : undefined;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
      style={{ position: 'absolute', inset: 0, zIndex: 55, pointerEvents: 'none' }}
    >
      {/* Header, in the left margin under the traffic lights. */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE_OUT_EXPO, delay: 0.06 }}
        style={{
          position: 'absolute', top: 80, left: 18, right: 18,
          display: 'flex', alignItems: 'center', gap: 10,
          pointerEvents: 'auto', WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close customization"
          style={{
            width: 30, height: 30, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--glass-bg, rgba(40,48,65,0.32))',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            color: 'var(--text-secondary, #d4cec7)', cursor: 'pointer',
          }}
        >
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <span style={{
          fontSize: 10.5, fontWeight: 600, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-ghost)',
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>
          Customize
        </span>
      </motion.div>

      {/* The bar. Floating object, not a wall: inset on three sides, height
          animates to whatever the active pane actually needs. */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1, height: barHeight(pane) }}
        transition={{ type: 'spring', stiffness: 460, damping: 42 }}
        style={{
          position: 'absolute',
          left: 10, right: 10, bottom: 10,
          pointerEvents: 'auto',
          display: 'flex', flexDirection: 'column',
          borderRadius: 18,
          background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.52))',
          backdropFilter: 'var(--glass-blur, blur(36px) saturate(1.7))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(36px) saturate(1.7))',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
          boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 18px 44px -14px rgba(0,0,0,0.62)',
          overflow: 'hidden',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {/* Command row: the chip strip, then Save pinned at the right edge.
            Save lives IN the bar because this bar is where every change
            happens; a save button floating at the top of the window made the
            commit gesture feel unrelated to the work. */}
        <div style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center',
          padding: '5px 10px 0 4px', gap: 8,
        }}>
          {/* Nine chips can't fit 400px, so the strip scrolls. The mask fades
              the clipped edges (an honest "there's more" signal, instead of a
              hard cut that reads as the end of the list) and the active chip
              auto-centers so the selection is never the hidden one. */}
          <div
            role="tablist"
            aria-label="Customization categories"
            style={{
              flex: '1 1 auto', minWidth: 0,
              display: 'flex', alignItems: 'center', gap: 1,
              overflowX: 'auto', overflowY: 'hidden',
              scrollbarWidth: 'none',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
              maskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
              padding: '0 12px',
            }}
          >
            {PANES.map((p) => (
              <Fragment key={p}>
                <Chip
                  label={PANE_LABELS[p]}
                  active={pane === p}
                  onClick={() => setPane(p)}
                />
                {/* Hairline breaks between the three ideas: her, the room,
                    the lens. Quieter than group labels, same information. */}
                {GROUP_BREAK_AFTER.has(p) && (
                  <span aria-hidden style={{
                    flex: '0 0 auto', width: 1, height: 12, margin: '0 5px',
                    background: 'rgba(255,255,255,0.10)',
                  }} />
                )}
              </Fragment>
            ))}
          </div>
          <span aria-hidden style={{
            flex: '0 0 auto', width: 1, height: 16,
            background: 'rgba(255,255,255,0.08)',
          }} />
          <SaveButton onClick={handleSave} />
        </div>

        <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={pane}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.17, ease: EASE_OUT_EXPO }}
              style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
            >
              {isGarment ? (
                <>
                  <Reel
                    items={items}
                    selected={selected}
                    onPick={(i) => pickItem(pane, i)}
                  />
                  <Caption
                    name={activeItem?.name ?? ''}
                    position={selected + 1}
                    total={items.length}
                  />
                  {CUSTOM_COLORABLE.includes(pane as CustomCategory) && (
                    <ToneRow
                      pair={clothingColors[pane as 'top' | 'bottom' | 'shoes']}
                      onPreset={(slot, idx) => setTone(pane as 'top' | 'bottom' | 'shoes', slot, idx)}
                      onCustom={(slot, rect) =>
                        setPicker({ target: { kind: 'clothing', cat: pane as 'top' | 'bottom' | 'shoes', slot }, rect })}
                    />
                  )}
                </>
              ) : pane === 'body' ? (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 34, padding: '2px 16px 12px',
                }}>
                  <Lever
                    label="Height"
                    plus="Tall"
                    minus="Short"
                    value={heightBlend}
                    onChange={(v) => { setHeightBlend(v); touch('heightBlend'); emitBlends(v, weightBlend); }}
                  />
                  <Lever
                    label="Weight"
                    plus="Full"
                    minus="Slim"
                    value={weightBlend}
                    onChange={(v) => { setWeightBlend(v); touch('weightBlend'); emitBlends(heightBlend, v); }}
                  />
                </div>
              ) : (
                // Environment = three vertical sections: Light | Backdrop |
                // Effects. Light+Backdrop live in EnvironmentPane (split by their
                // own divider); Effects is its own section whose frame grid wraps
                // and scrolls vertically. `stretch` gives the effects grid full
                // height to scroll in; the outer bar itself never scrolls.
                <div style={{
                  flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch',
                  gap: 14, overflow: 'hidden', padding: '8px 18px',
                }}>
                <EnvironmentPane
                  angle={lightingAngle}
                  onAngle={(a) => {
                    setLightingAngle(a);
                    touch('lightingAngle');
                    onEmit({ EventType: 'changeLightAngle', lightAngle: String(a) });
                  }}
                  lightHex={accentHex ?? ACCENT_COLORS[accentIndex]?.hex ?? '#ffffff'}
                  lightIntensity={lightIntensity}
                  onLightIntensity={(v) => { setLightIntensity(v); touch('lightIntensity'); emitLight(accentRgb(), v); }}
                  accentIndex={accentHex ? -1 : accentIndex}
                  accentHex={accentHex}
                  onAccent={(i) => { setAccentIndex(i); setAccentHex(undefined); touch('accent'); emitLight(ACCENT_COLORS[i], lightIntensity); }}
                  onAccentCustom={(rect) => setPicker({ target: { kind: 'accent' }, rect })}
                  bgHex={bgHex ?? BG_COLORS[bgIndex]?.hex ?? '#1a2338'}
                  bgGlow={bgGlow}
                  onBgGlow={(v) => { setBgGlow(v); touch('bgGlow'); emitBG(bgRgb(), v); }}
                  bgIndex={bgHex ? -1 : bgIndex}
                  bgCustomHex={bgHex}
                  onBg={(i) => { setBgIndex(i); setBgHex(undefined); touch('bg'); emitBG(BG_COLORS[i], bgGlow); }}
                  onBgCustom={(rect) => setPicker({ target: { kind: 'bg' }, rect })}
                  bgMode={bgMode}
                  onBgMode={onBgMode ? (m) => { onEmit({ EventType: 'changeBGMaterial', bgmode: m }); onBgMode(m); } : undefined}
                />
                <span style={{ flex: '0 0 auto', width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.06)' }} />
                <EffectsPane
                  effectId={effectId}
                  strength={effectStrength}
                  onPick={(id) => applyEffect(id, effectStrength)}
                  onStrength={(v) => applyEffect(effectId, v)}
                />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      {picker && (
        <ColorPickerPanel
          color={pickerColor}
          anchorRect={picker.rect}
          onChange={(hex) => {
            if (picker.target.kind === 'accent') { setAccentHex(hex); touch('accent'); emitLight(hexToRgb01(hex), lightIntensity); }
            else if (picker.target.kind === 'bg') { setBgHex(hex); touch('bg'); emitBG(hexToRgb01(hex), bgGlow); }
            else setToneHex(picker.target.cat, picker.target.slot, hex);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </motion.div>
  );
}

// ============ reel ==================================================

function Reel({ items, selected, onPick }: {
  items: WardrobeItem[]; selected: number; onPick: (i: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selRef = useRef<HTMLButtonElement | null>(null);

  // Keep the selected frame centered. Without this, arrow-scrubbing walks the
  // selection off-screen and the reel feels broken.
  useEffect(() => {
    const el = selRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selected]);

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Items"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        // Vertical padding leaves room for the selected frame to grow + lift
        // without clipping against the scroll box.
        padding: '9px 16px 7px',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        scrollSnapType: 'x proximity',
      }}
    >
      {items.map((item) => {
        const isSel = item.index === selected;
        return (
          <motion.button
            key={item.key}
            ref={isSel ? selRef : undefined}
            type="button"
            role="option"
            aria-selected={isSel}
            title={item.name}
            onClick={() => onPick(item.index)}
            animate={{ scale: isSel ? FRAME_SELECTED : 1, y: isSel ? -3 : 0 }}
            whileHover={{ scale: isSel ? FRAME_SELECTED : 1.08 }}
            whileTap={{ scale: isSel ? FRAME_SELECTED * 0.97 : 0.96 }}
            transition={{ type: 'spring', stiffness: 480, damping: 30 }}
            style={{
              flex: '0 0 auto',
              width: FRAME, height: FRAME,
              padding: 0,
              borderRadius: 9,
              overflow: 'hidden',
              cursor: 'pointer',
              scrollSnapAlign: 'center',
              background: 'rgba(255,255,255,0.03)',
              border: isSel
                ? '1px solid var(--accent, #c44444)'
                : '1px solid rgba(255,255,255,0.10)',
              boxShadow: isSel
                ? '0 6px 16px -6px rgba(196,68,68,0.6)'
                : 'none',
              // Unselected frames recede so the grown one reads instantly.
              opacity: isSel ? 1 : 0.55,
              transition: 'opacity 180ms var(--ease-out-quart), border-color 180ms var(--ease-out-quart)',
            }}
          >
            {item.thumb ? (
              <img
                src={item.thumb}
                alt=""
                draggable={false}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              // No art for this index. Name it rather than showing a void.
              <span style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px', textAlign: 'center',
                fontSize: 7, fontWeight: 700, lineHeight: 1.2,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--text-ghost)',
              }}>
                {item.name}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

// ============ caption ===============================================
// The name lives here, once, instead of under 34 frames where it would clip.

function Caption({ name, position, total }: { name: string; position: number; total: number }) {
  return (
    <div style={{
      flex: '0 0 auto',
      height: 16,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      padding: '0 16px',
    }}>
      <AnimatePresence mode="wait">
        <motion.span
          key={name}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.14, ease: EASE_OUT_EXPO }}
          style={{
            fontSize: 11, fontWeight: 500,
            color: 'var(--text-secondary, #d4cec7)',
            letterSpacing: '-0.005em', whiteSpace: 'nowrap',
          }}
        >
          {name}
        </motion.span>
      </AnimatePresence>
      <span style={{
        fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
        fontSize: 9, color: 'var(--text-ghost)', fontVariantNumeric: 'tabular-nums',
      }}>
        {position}/{total}
      </span>
    </div>
  );
}

// ============ effects ===============================================
// Same reel as the wardrobe, because it's the same act: browsing a set and
// picking one. The frames can't show the real stream (nine live <video> clones
// to draw a menu is absurd), so each renders a procedural stand-in scene with
// the effect's own CSS applied to it. Abstract, but honest: what you see in the
// frame is literally the code that will grade her.
//
// One effect at a time. Each is a composited layer over a 60fps video on a
// machine already running Unreal, and stacking them would quietly tax the GPU
// that's drawing her. Strength is the only knob because it's the only one worth
// having: which look, and how much.

function EffectsPane({ effectId, strength, onPick, onStrength }: {
  effectId: string;
  strength: number;
  onPick: (id: string) => void;
  onStrength: (v: number) => void;
}) {
  const fx = effectFor(effectId);
  const isNone = fx.id === DEFAULT_EFFECT_ID;
  const selRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [effectId]);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 2 }}>
      <span style={{
        flex: '0 0 auto', paddingLeft: 4,
        fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--text-ghost)',
      }}>
        Effects
      </span>
      {/* Frames WRAP into a grid and the grid scrolls vertically inside this
          section, so every effect is reachable without a horizontal reel. */}
      <div
        role="listbox"
        aria-label="Effects"
        style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
          justifyContent: 'flex-start', gap: 7,
          padding: '2px 10px 2px 2px',
          overflowX: 'hidden', overflowY: 'auto',
          scrollbarWidth: 'thin',
        }}
      >
        {STREAM_EFFECTS.map((e) => {
          const sel = e.id === effectId;
          return (
            <motion.button
              key={e.id}
              ref={sel ? selRef : undefined}
              type="button"
              role="option"
              aria-selected={sel}
              title={e.name}
              onClick={() => onPick(e.id)}
              animate={{ scale: sel ? FRAME_SELECTED : 1, y: sel ? -3 : 0 }}
              whileHover={{ scale: sel ? FRAME_SELECTED : 1.08 }}
              whileTap={{ scale: sel ? FRAME_SELECTED * 0.97 : 0.96 }}
              transition={{ type: 'spring', stiffness: 480, damping: 30 }}
              style={{
                position: 'relative',
                flex: '0 0 auto',
                width: FRAME, height: FRAME,
                padding: 0, borderRadius: 9, overflow: 'hidden',
                cursor: 'pointer', scrollSnapAlign: 'center',
                background: 'rgba(255,255,255,0.03)',
                border: sel ? '1px solid var(--accent, #c44444)' : '1px solid rgba(255,255,255,0.10)',
                boxShadow: sel ? '0 6px 16px -6px rgba(196,68,68,0.6)' : 'none',
                opacity: sel ? 1 : 0.55,
                transition: 'opacity 180ms var(--ease-out-quart), border-color 180ms var(--ease-out-quart)',
              }}
            >
              {e.id === DEFAULT_EFFECT_ID ? (
                // "None" gets no swatch: an empty frame with a slash is the
                // clearest way to say "nothing applied".
                <span style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, color: 'var(--text-ghost)',
                }}>
                  &#8709;
                </span>
              ) : (
                <EffectSwatch effect={e} />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Name + what it does. The blurb earns its place here because an
          effect's name never tells you what it looks like. */}
      <div style={{
        flex: '0 0 auto', height: 30,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 1, padding: '0 16px',
      }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={fx.id}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.14, ease: EASE_OUT_EXPO }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
          >
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: 'var(--text-primary, #fafafa)', letterSpacing: '-0.005em',
            }}>
              {fx.name}
            </span>
            <span style={{
              fontSize: 9.5, color: 'var(--text-ghost)',
              letterSpacing: '-0.005em', whiteSpace: 'nowrap',
            }}>
              {fx.blurb}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Strength is meaningless with nothing applied, so it goes away rather
          than sitting there greyed out. */}
      <div style={{
        flex: '0 0 auto',
        display: 'flex', justifyContent: 'center',
        padding: '2px 16px 10px',
        opacity: isNone ? 0 : 1,
        pointerEvents: isNone ? 'none' : 'auto',
        transition: 'opacity 180ms var(--ease-out-quart)',
      }}>
        <ValueSlider
          value={strength}
          onChange={onStrength}
          min={0}
          max={1}
          step={0.01}
          width={200}
          label="Effect strength"
        />
      </div>
    </div>
  );
}

// ============ lever =================================================
// A bipolar vertical fader: zero in the middle, poles at the ends. Vertical
// because that's the shape of the idea — taller is up. Custom rather than an
// <input type=range> because vertical range inputs are a browser-support coin
// flip and this needs a center detent, a fill that grows OUT from the middle,
// and a thumb that snaps home. The mixing-desk read is the point: two faders,
// both resting at center, is instantly legible as "she is at her defaults".

const LEVER_H = 96;
const DETENT = 0.05;   // snap-to-zero window; the lever has a real center click

function Lever({ label, plus, minus, value, onChange }: {
  label: string;
  plus: string;
  minus: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Pointer y -> signed value. Up is positive, which is why the sign flips.
  const fromPointer = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const t = (clientY - r.top) / r.height;        // 0 at top, 1 at bottom
    const v = 1 - t * 2;                            // +1 top, -1 bottom
    const clamped = Math.max(-1, Math.min(1, v));
    return Math.abs(clamped) < DETENT ? 0 : Math.round(clamped * 100) / 100;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(fromPointer(e.clientY));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    onChange(fromPointer(e.clientY));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp')        { e.preventDefault(); onChange(Math.min(1, round2(value + step))); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(-1, round2(value - step))); }
    else if (e.key === 'Home' || e.key === '0') { e.preventDefault(); onChange(0); }
  };

  // Thumb position: +1 -> top, -1 -> bottom.
  const pct = (1 - value) / 2;                     // 0 at +1, 1 at -1
  const thumbTop = pct * LEVER_H;
  // Fill spans center -> thumb, so magnitude reads as distance from home.
  const fillTop = value > 0 ? thumbTop : LEVER_H / 2;
  const fillH = Math.abs(value) * (LEVER_H / 2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <PoleLabel active={value > 0.02}>{plus}</PoleLabel>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label} blend`}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={valueText(value, plus, minus)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        style={{
          position: 'relative',
          width: 26,
          height: LEVER_H,
          cursor: dragging ? 'grabbing' : 'pointer',
          touchAction: 'none',
          outline: 'none',
        }}
      >
        {/* rail */}
        <span style={{
          position: 'absolute', left: '50%', top: 0, bottom: 0,
          width: 3, marginLeft: -1.5, borderRadius: 999,
          background: 'rgba(255,255,255,0.13)',
        }} />
        {/* center detent: the home line you can feel by sight */}
        <span style={{
          position: 'absolute', left: 3, right: 3, top: LEVER_H / 2 - 0.5,
          height: 1, background: 'rgba(255,255,255,0.30)',
        }} />
        {/* fill, growing out of the middle */}
        <motion.span
          animate={{ top: fillTop, height: fillH }}
          transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
          style={{
            position: 'absolute', left: '50%', width: 3, marginLeft: -1.5,
            borderRadius: 999,
            background: 'rgba(255, 245, 235, 0.78)',
          }}
        />
        {/* thumb */}
        <motion.span
          animate={{ top: thumbTop }}
          transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
          style={{
            position: 'absolute', left: '50%',
            width: 14, height: 14, marginLeft: -7, marginTop: -7,
            borderRadius: '50%',
            background: 'rgba(255, 248, 240, 0.96)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.6), 0 0 12px rgba(255,240,220,0.35)',
            // At home the thumb sits flush and quiet; off home it lifts.
            scale: value === 0 ? 0.86 : 1,
          }}
        />
      </div>

      <PoleLabel active={value < -0.02}>{minus}</PoleLabel>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, marginTop: 2 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'var(--text-ghost)',
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
          fontSize: 9.5,
          color: value === 0 ? 'var(--text-ghost)' : 'var(--text-secondary, #d4cec7)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value === 0 ? 'home' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`}
        </span>
      </div>
    </div>
  );
}

function PoleLabel({ children, active }: { children: React.ReactNode; active: boolean }) {
  return (
    <span style={{
      fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase',
      // The engaged pole brightens: which way you've pushed, without a readout.
      color: active ? 'var(--text-primary, #fafafa)' : 'rgba(255,255,255,0.24)',
      transition: 'color 180ms var(--ease-out-quart)',
    }}>
      {children}
    </span>
  );
}

function valueText(v: number, plus: string, minus: string): string {
  if (v === 0) return 'Default';
  return `${Math.round(Math.abs(v) * 100)}% ${v > 0 ? plus : minus}`;
}

function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Math.abs(r) < DETENT ? 0 : r;
}

// ============ environment ===========================================
// Light and backdrop were two panes asking the same question from opposite
// sides: what does this room look like. Merged, they get to be one object.
//
// The dial is a plan view of the stage. Behind it sits a live wash of the
// actual backdrop color at the actual glow, and inside it a wash of the key
// light at its actual intensity. So the control previews the thing it controls:
// push glow up and the halo blooms, swing the angle and the light sweeps around
// her. That's why they merged, and it's the one moment of delight on this
// surface.

function EnvironmentPane(p: {
  angle: number;
  onAngle: (a: number) => void;
  lightHex: string;
  lightIntensity: number;
  onLightIntensity: (v: number) => void;
  accentIndex: number;
  accentHex?: string;
  onAccent: (i: number) => void;
  onAccentCustom: (rect: DOMRect) => void;
  bgHex: string;
  bgGlow: number;
  onBgGlow: (v: number) => void;
  bgIndex: number;
  bgCustomHex?: string;
  onBg: (i: number) => void;
  onBgCustom: (rect: DOMRect) => void;
  bgMode?: number;
  onBgMode?: (i: number) => void;
}) {
  // Normalize both magnitudes to 0-1 so they can drive opacity honestly.
  const glowN = (p.bgGlow - BG_GLOW_MIN) / (BG_GLOW_MAX - BG_GLOW_MIN);
  const litN = (p.lightIntensity - LIGHT_INTENSITY_MIN) / (LIGHT_INTENSITY_MAX - LIGHT_INTENSITY_MIN);

  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px' }}>
      {/* The stage */}
      <div style={{ position: 'relative', flex: '0 0 auto', width: 96, height: 96 }}>
        {/* backdrop wash: the half-sphere, seen from above */}
        <motion.span
          aria-hidden
          animate={{ opacity: 0.22 + glowN * 0.78 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          style={{
            position: 'absolute', inset: -14, borderRadius: '50%',
            background: `radial-gradient(circle, ${p.bgHex} 0%, ${p.bgHex}66 45%, transparent 72%)`,
            filter: 'blur(6px)',
            pointerEvents: 'none',
          }}
        />
        {/* key-light wash: brightens with intensity, tinted by the light color */}
        <motion.span
          aria-hidden
          animate={{ opacity: 0.1 + litN * 0.5 }}
          transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          style={{
            position: 'absolute', inset: 4, borderRadius: '50%',
            background: `radial-gradient(circle, ${p.lightHex}55 0%, transparent 68%)`,
            filter: 'blur(4px)',
            pointerEvents: 'none',
          }}
        />
        <LightingDial value={p.angle} onChange={p.onAngle} size={96} />
      </div>

      {/* The two axes, side by side (each a column: label, swatches, magnitude,
          + the backdrop's mode dropdown) so the pane stays short in the bar. */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
        <EnvRow label="Light">
          <Dots
            colors={ACCENT_COLORS}
            activeIndex={p.accentIndex}
            customHex={p.accentHex}
            onPick={p.onAccent}
            onCustom={p.onAccentCustom}
          />
          <ValueSlider
            value={p.lightIntensity}
            onChange={p.onLightIntensity}
            min={LIGHT_INTENSITY_MIN}
            max={LIGHT_INTENSITY_MAX}
            width={150}
            label="Key light intensity"
          />
        </EnvRow>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.06)' }} />
        <EnvRow label="Backdrop">
          <Dots
            colors={BG_COLORS}
            activeIndex={p.bgIndex}
            customHex={p.bgCustomHex}
            onPick={p.onBg}
            onCustom={p.onBgCustom}
          />
          <ValueSlider
            value={p.bgGlow}
            onChange={p.onBgGlow}
            min={BG_GLOW_MIN}
            max={BG_GLOW_MAX}
            width={150}
            label="Backdrop glow"
          />
          {p.onBgMode && (
            <BackdropStylePicker value={clampBgMode(p.bgMode)} onSelect={p.onBgMode} />
          )}
        </EnvRow>
      </div>
    </div>
  );
}

function EnvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{
        fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--text-ghost)',
      }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

// ============ chip ==================================================

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  // Keep the active chip visible inside the masked, scrollable strip; without
  // this, tabbing to Environment or Effects leaves the selection off-screen.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        position: 'relative', flex: '0 0 auto',
        padding: '8px 10px 9px',
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 10.5,
        fontWeight: active ? 600 : 500,
        letterSpacing: '-0.005em', whiteSpace: 'nowrap',
        color: active ? 'var(--text-primary, #fafafa)' : 'var(--text-ghost)',
        transition: 'color 160ms var(--ease-out-quart)',
      }}
    >
      {label}
      {active && (
        <motion.span
          layoutId="custom-wardrobe-chip"
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
          style={{
            position: 'absolute', left: 8, right: 8, bottom: 1,
            height: 2, borderRadius: 999,
            background: 'var(--accent, #c44444)',
          }}
        />
      )}
    </button>
  );
}

// ============ dots ==================================================

function Dots({ colors, activeIndex, customHex, onPick, onCustom }: {
  colors: Array<{ label: string; hex: string }>;
  activeIndex: number;
  customHex?: string;
  onPick: (i: number) => void;
  onCustom: (rect: DOMRect) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      {colors.map((c, i) => (
        <Dot key={c.label} hex={c.hex} label={c.label} active={i === activeIndex} onClick={() => onPick(i)} />
      ))}
      <Dot
        hex={customHex ?? 'transparent'}
        label="Custom color"
        active={!!customHex}
        dashed={!customHex}
        onClick={(rect) => onCustom(rect)}
      />
    </div>
  );
}

function Dot({ hex, label, active, dashed, onClick }: {
  hex: string; label: string; active: boolean; dashed?: boolean;
  onClick: (rect: DOMRect) => void;
}) {
  return (
    <motion.button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      whileHover={{ scale: 1.16 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
      onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
      style={{
        width: 18, height: 18, borderRadius: '50%', padding: 0, cursor: 'pointer',
        background: dashed ? 'rgba(255,255,255,0.06)' : hex,
        border: active
          ? '2px solid rgba(255,255,255,0.92)'
          : dashed ? '1px dashed rgba(255,255,255,0.34)' : '1px solid rgba(255,255,255,0.16)',
        boxShadow: active && !dashed ? `0 0 9px -1px ${hex}` : 'none',
        transition: 'border-color 160ms var(--ease-out-quart), box-shadow 160ms var(--ease-out-quart)',
      }}
    />
  );
}

// ============ strands row ===========================================
// Hair only. Same style either way, so this is a quality switch rather than a
// choice about the look: strand grooms are the real thing, cards are the cheap
// stand-in. It sits under the reel because it modifies whatever you just
// picked, and it's a switch rather than a reel frame because it isn't a
// hairstyle, it's how that hairstyle is drawn.

// ============ tone row ==============================================

function ToneRow({ pair, onPreset, onCustom }: {
  pair: ClothingColor;
  onPreset: (slot: 'c1' | 'c2', idx: number) => void;
  onCustom: (slot: 'c1' | 'c2', rect: DOMRect) => void;
}) {
  return (
    <div style={{
      flex: '0 0 auto',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      padding: '7px 14px 8px',
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      {(['c1', 'c2'] as const).map((slot) => {
        const hex = slot === 'c1' ? pair.c1Hex : pair.c2Hex;
        const idx = slot === 'c1' ? pair.c1 : pair.c2;
        return (
          <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              flex: '0 0 auto', width: 10,
              fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
              fontSize: 8.5, color: 'var(--text-ghost)',
            }}>
              {slot === 'c1' ? '1' : '2'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {CLOTHING_COLORS.map((c, i) => (
                <Dot
                  key={c.label}
                  hex={c.hex}
                  label={c.label}
                  active={!hex && i === idx}
                  onClick={() => onPreset(slot, i)}
                />
              ))}
              <Dot
                hex={hex ?? 'transparent'}
                label="Custom color"
                active={!!hex}
                dashed={!hex}
                onClick={(rect) => onCustom(slot, rect)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ save ==================================================

function SaveButton({ onClick }: { onClick: () => void }) {
  const [saved, setSaved] = useState(false);
  const handle = () => {
    onClick();
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };
  return (
    <motion.button
      type="button"
      onClick={handle}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.95 }}
      style={{
        pointerEvents: 'auto',
        flex: '0 0 auto',
        padding: '6px 12px', borderRadius: 999,
        background: saved
          ? 'color-mix(in srgb, var(--live) 24%, rgba(20, 24, 32, 0.55))'
          : 'color-mix(in srgb, var(--accent) 22%, rgba(20, 24, 32, 0.55))',
        border: `1px solid color-mix(in srgb, ${saved ? 'var(--live)' : 'var(--accent)'} 55%, transparent)`,
        color: '#fafafa', fontFamily: 'inherit',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
        transition: 'background 200ms var(--ease-out-quart), border-color 200ms var(--ease-out-quart)',
      }}
    >
      {saved && <Check size={10} strokeWidth={2.6} />}
      {saved ? 'Saved' : 'Save'}
    </motion.button>
  );
}

// ============ helpers ===============================================

function clamp(v: number | undefined, min: number, max: number, fallback: number): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function clampIdx(v: number | undefined, len: number): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(len - 1, Math.floor(v)));
}

function clampAngle(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return ((Math.round(v) % 360) + 360) % 360;
}

function normalizeColor(c: ClothingColor | undefined): ClothingColor {
  return {
    c1: clampIdx(c?.c1, CLOTHING_COLORS.length),
    c2: clampIdx(c?.c2, CLOTHING_COLORS.length),
    c1Hex: c?.c1Hex,
    c2Hex: c?.c2Hex,
  };
}
