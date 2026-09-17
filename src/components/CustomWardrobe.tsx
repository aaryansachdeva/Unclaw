// CustomWardrobe: customization for every character (custom builds get the
// full catalog, the base six a restricted set; see wardrobeForAgent).
//
// SPLIT ISLANDS (2026-09-16 redesign). The old bottom bar put eleven tabs in
// one scrolling strip, 52 px tiles, and grew to cover the face on Body. Now:
// a slim group rail floats on the left (Hair, Facial, Outfit, Body, Scene), the
// group's options sit in a column island on the right as big named tiles, and
// a dock at the foot names what is on the character. She stays centred and
// whole. Scene drops the column entirely: the key light becomes a body you
// drag around an orbit ring on the stage, and colour, brightness, backdrop and
// effects share one deck (customize/SceneStage).
//
// State, emits and the touched-only save are unchanged from the bar version.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Check, Pencil } from 'lucide-react';
import type { WardrobeSettings, ClothingColor } from '../services/userSettings';
import { ColorPickerPanel, hexToRgb01, round3 } from './ColorPickerPanel';
import {
  ACCENT_COLORS, CLOTHING_COLORS, BG_COLORS, HAIR_COLORS, EYE_COLORS,
  LIGHT_INTENSITY_MIN, LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_DEFAULT,
  BG_GLOW_MIN, BG_GLOW_MAX, BG_GLOW_DEFAULT,
} from './CustomizationOverlay';
import { clampBgMode } from '../wardrobe/backgrounds';
import {
  CUSTOM_CATEGORY_LABELS, CUSTOM_COLORABLE,
  wardrobeForAgent, clampAgentIndex, type CustomCategory, type WardrobeItem,
} from '../wardrobe/catalog';
import { DEFAULT_EFFECT_ID, DEFAULT_EFFECT_STRENGTH } from './StreamEffects';
import {
  CustomizeStyles, EASE_OUT_EXPO, GROUP_META, GROUP_OF, GROUP_ORDER, ISLAND, NamedTile, Tabs,
  type GroupId, type Pane,
} from './customize/kit';
import { ColumnIsland, Dock, GroupRail } from './customize/Islands';
import { LightOrbit, SceneDeck, type SceneTab } from './customize/SceneStage';

const PANE_LABELS: Record<Pane, string> = {
  ...CUSTOM_CATEGORY_LABELS,
  body: 'Body',
  scene: 'Scene',
};

interface CustomWardrobeProps {
  /** Active character TYPE id (grace/mark/ava/goblin/chris/joi/*_custom).
   *  Selects which wardrobe surface to render: full catalog for custom
   *  builds, the restricted per-character set for the base six. */
  agentId?: string | null;
  /** Generate ANOTHER skin. Resolves true on success. Unified only. */
  onRegenSkin?: () => Promise<boolean>;
  /** Every skin generated for this character, oldest first. */
  skins?: Array<{ path: string; label: string }>;
  /** Which skin is currently on the character. */
  activeSkin?: string | null;
  /** Switch to a previously generated skin. */
  onPickSkin?: (path: string) => void;
  initial?: WardrobeSettings | null;
  onEmit: (payload: Record<string, unknown>) => void;
  onSave: (settings: WardrobeSettings) => void;
  onCancel: () => void;
  /** Live-preview a post effect. Separate from onEmit because effects are
   *  composited in the renderer and never reach UE. */
  onEffect?: (fx: { effectId: string; effectStrength: number }) => void;
  /** True when the active pane is a face-region edit (hair / brows / lashes / beard / mustache)
   *  and the camera should sit at the close resting shot instead of the
   *  full-figure customization pull-back. App drives the camera from this. */
  onCloseUpChange?: (closeUp: boolean) => void;
  /** GLOBAL backdrop style index (bgmode); backdrop is not per-instance. */
  bgMode?: number;
  /** Persist a new global backdrop style index. */
  onBgMode?: (index: number) => void;
  /** Photo-identity agents only: current instance name + rename persister.
   *  When provided, a "name your character" field renders in the toolbar. */
  instanceName?: string;
  onRenameInstance?: (name: string) => void;
}

export function CustomWardrobe({ agentId, initial, onEmit, onSave, onCancel, onEffect, onCloseUpChange, bgMode, onBgMode, instanceName, onRenameInstance, onRegenSkin, skins, activeSkin, onPickSkin }: CustomWardrobeProps) {
  // The wardrobe surface for THIS character: which categories exist, their
  // items (per-character hair, shared/subset clothing), whether body blends
  // apply. Memoized on agentId so a switch mid-session re-resolves.
  const wardrobe = useMemo(() => wardrobeForAgent(agentId), [agentId]);
  const catItems = useCallback((c: CustomCategory) => wardrobe.items[c] ?? [], [wardrobe]);

  // Panes = this character's garment categories, then Body (custom only), then
  // the global Environment. Divider is rendered before Environment.
  const panes = useMemo<Pane[]>(
    () => [...wardrobe.categories, ...(wardrobe.body ? ['body' as const] : []), 'scene'],
    [wardrobe],
  );
  // Groups present for this character, and the pane each one last showed so
  // hopping between groups returns to where you were.
  const groups = useMemo(
    () => GROUP_ORDER.filter((g) => panes.some((p) => GROUP_OF[p] === g)),
    [panes],
  );
  const lastPaneRef = useRef<Partial<Record<GroupId, Pane>>>({});

  const [pane, setPane] = useState<Pane>('hair');
  // A character switch can drop the current pane (e.g. leaving a custom build
  // while on Eyebrow). Fall back to the first pane if it's gone.
  useEffect(() => {
    if (!panes.includes(pane)) setPane(panes[0] ?? 'hair');
  }, [panes, pane]);

  // Declared above the framing effect on purpose: that effect lists tuneTab in
  // its dependency array, which is evaluated during render, so a later const
  // would be a temporal dead zone at runtime even though tsc stays quiet.
  const [tuneTab, setTuneTab] = useState<'body' | 'face' | 'colour'>('body');
  const [sceneTab, setSceneTab] = useState<SceneTab>('light');
  const group: GroupId = GROUP_OF[pane] ?? 'hair';
  const pickGroup = useCallback((g: GroupId) => {
    lastPaneRef.current[group] = pane;
    const remembered = lastPaneRef.current[g];
    setPane(remembered && panes.includes(remembered) ? remembered : (panes.find((p) => GROUP_OF[p] === g) ?? 'scene'));
  }, [group, pane, panes]);

  // Tell App whether the active pane is a face-region edit so it can frame the
  // camera close (hair / eyebrow / eyelash) vs pull back to the whole figure
  // for clothing / body / environment.
  //
  // The unified Body pane is three different jobs behind one pane, so it cannot
  // pick a framing from `pane` alone: shaping the BODY wants the whole figure,
  // while the Face and Colour tabs are edits you can only judge on the face.
  // Fires on mount, on pane change, and on tab change.
  useEffect(() => {
    const faceTab = pane === 'body' && isUnifiedHost(agentId) && tuneTab !== 'body';
    onCloseUpChange?.(group === 'hair' || group === 'facial' || faceTab);
  }, [pane, group, tuneTab, agentId, onCloseUpChange]);

  const [hair,    setHair]    = useState(() => clampAgentIndex(wardrobe.items.hair,    initial?.hairIndex));
  const [eyebrow, setEyebrow] = useState(() => clampAgentIndex(wardrobe.items.eyebrow, initial?.browIndex));
  const [eyelash, setEyelash] = useState(() => clampAgentIndex(wardrobe.items.eyelash, initial?.lashIndex));
  const [beard,    setBeard]    = useState(() => clampAgentIndex(wardrobe.items.beard,    initial?.beardIndex));
  const [mustache, setMustache] = useState(() => clampAgentIndex(wardrobe.items.mustache, initial?.mustacheIndex));
  const [top,     setTop]     = useState(() => clampAgentIndex(wardrobe.items.top,     initial?.topIndex));
  const [bottom,  setBottom]  = useState(() => clampAgentIndex(wardrobe.items.bottom,  initial?.bottomIndex));
  const [shoes,   setShoes]   = useState(() => clampAgentIndex(wardrobe.items.shoes,   initial?.shoesIndex));

  const [clothingColors, setClothingColors] = useState<Record<'top' | 'bottom' | 'shoes', ClothingColor>>(() => ({
    top:    normalizeColor(initial?.clothingColors?.top),
    bottom: normalizeColor(initial?.clothingColors?.bottom),
    shoes:  normalizeColor(initial?.clothingColors?.shoes),
  }));

  // Bipolar body axes. One signed lever per axis; the pair is derived at emit.
  const [heightBlend, setHeightBlend] = useState(() => clamp(initial?.heightBlend, -1, 1, 0));
  const [weightBlend, setWeightBlend] = useState(() => clamp(initial?.weightBlend, -1, 1, 0));
  // Unified characters are ONE body driven by 16 signed axes plus a photo-read
  // hair and eye colour. Preset characters have none of that, so this whole
  // surface is gated rather than rendered empty for everyone else.
  const [axes, setAxes] = useState<Record<string, number>>(() => ({ ...(initial?.blendAxes ?? {}) }));
  const [hairColor, setHairColor] = useState(() => initial?.hairColor);
  const [eyeColor, setEyeColor] = useState(() => initial?.eyeColor);
  const [regenSkin, setRegenSkin] = useState<'idle' | 'busy' | 'failed'>('idle');

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
  const [dirty, setDirty] = useState(false);
  const touch = (key: string) => { touchedRef.current.add(key); setDirty(true); };

  const value = (cat: CustomCategory) => ({ hair, eyebrow, eyelash, beard, mustache, top, bottom, shoes })[cat];
  const setValue = (cat: CustomCategory, n: number) => {
    switch (cat) {
      case 'hair':    setHair(n); break;
      case 'eyebrow': setEyebrow(n); break;
      case 'eyelash': setEyelash(n); break;
      case 'beard':    setBeard(n); break;
      case 'mustache': setMustache(n); break;
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

  const isGarment = pane !== 'body' && pane !== 'scene';
  const items: WardrobeItem[] = isGarment ? catItems(pane) : [];
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
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      // Step through positions, not index numbers: the facial-hair None tile
      // carries index 999 and base hair lists can skip numbers.
      const pos = Math.max(0, items.findIndex((i) => i.index === selected));
      pickItem(pane, items[(pos + step + items.length) % items.length].index);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, isGarment, items.length, selected, pane, pickItem]);

  // NOTE: wardrobeModeOn/Off is gone. All it ever did was zoom the camera
  // in/out for the fitting-room framing, and the camera is now driven from
  // App.tsx (updateCameraFromLocation, keyed on customizationActive) — so the
  // zoom-out-to-show-the-whole-figure happens there instead.

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

  // setBlendsUnified: the full 16-axis snapshot, every time.
  //
  // A full snapshot rather than a delta because the UE side applies what it is
  // given: omit an axis and it reads 0 and silently resets. Same reason the
  // four-field setBlends above sends all four.
  const emitAxes = useCallback((next: Record<string, number>) => {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(next)) {
      if (Number.isFinite(v) && v !== 0) clean[k] = round3(v);
    }
    onEmit({ EventType: 'setBlendsUnified', axes: clean });
  }, [onEmit]);

  const setAxis = useCallback((key: string, value: number) => {
    setAxes((prev) => {
      const next = { ...prev, [key]: value };
      touch('blendAxes');
      emitAxes(next);
      return next;
    });
  }, [emitAxes]);

  const pickHair = useCallback((i: number) => {
    const h = HAIR_COLORS[i];
    const next = { preset: i, melanin: h.melanin, redness: h.redness, dyeHex: h.dyeHex };
    setHairColor(next);
    touch('hairColor');
    onEmit({
      EventType: 'changeHairColor',
      melanin: h.melanin,
      redness: h.redness,
      // Hair and brows only: real lashes stay dark whatever the hair does.
      targets: ['hair', 'brows'],
    });
  }, [onEmit]);

  const pickEyes = useCallback((iris: string) => {
    setEyeColor({ iris });
    touch('eyeColor');
    onEmit({ EventType: 'changeEyeColor', iris });
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
    if (touched.has('beard'))    out.beardIndex    = beard;
    if (touched.has('mustache')) out.mustacheIndex = mustache;
    if (touched.has('heightBlend')) out.heightBlend = heightBlend;
    if (touched.has('weightBlend')) out.weightBlend = weightBlend;
    if (touched.has('blendAxes')) out.blendAxes = axes;
    if (touched.has('hairColor') && hairColor) out.hairColor = hairColor;
    if (touched.has('eyeColor') && eyeColor) out.eyeColor = eyeColor;
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
    setDirty(false);
  }, [onSave, initial, top, bottom, shoes, hair, eyebrow, eyelash, beard, mustache, heightBlend, weightBlend,
      axes, hairColor, eyeColor,
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

  const activeItem = isGarment ? items.find((i) => i.index === selected) : undefined;
  const position = isGarment ? `${Math.max(0, items.findIndex((i) => i.index === selected)) + 1} of ${items.length}` : '';
  const groupPanes = panes.filter((p) => GROUP_OF[p] === group);
  const unified = isUnifiedHost(agentId);
  const colourable = isGarment && CUSTOM_COLORABLE.includes(pane as CustomCategory);
  const [justSaved, setJustSaved] = useState(false);
  const save = () => { handleSave(); setJustSaved(true); window.setTimeout(() => setJustSaved(false), 1600); };

  const bodyTabs = unified
    ? [{ id: 'body' as const, label: 'Shape' }, { id: 'face' as const, label: 'Face' }, { id: 'colour' as const, label: 'Colour' }]
    : [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
      style={{ position: 'absolute', inset: 0, zIndex: 55, pointerEvents: 'none' }}
    >
      <CustomizeStyles />

      {/* Header: back and the character's name on the left, Save on the right. */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: EASE_OUT_EXPO, delay: 0.06 }}
        style={{
          position: 'absolute', top: 72, left: 14, right: 14,
          display: 'flex', alignItems: 'center', gap: 10,
          pointerEvents: 'none',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close customize"
          className="cz-focus"
          style={{
            ...ISLAND, width: 36, height: 36, borderRadius: '50%', flex: '0 0 auto',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary, #d4cec7)', cursor: 'pointer',
          }}
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        {onRenameInstance ? (
          <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, pointerEvents: 'auto', minWidth: 0 }}>
            <input
              defaultValue={instanceName ?? ''}
              placeholder="Name your character"
              maxLength={24}
              aria-label="Character name"
              onBlur={(e) => onRenameInstance(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              style={{
                width: `calc(${Math.max(4, Math.min(20, (instanceName ?? '').length || 16))}ch + 44px)`,
                padding: '6px 26px 6px 8px', borderRadius: 10, outline: 'none',
                background: 'transparent', border: '1px solid transparent',
                color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em',
                textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              }}
              onFocus={(e) => { e.target.style.background = 'rgba(40,48,65,0.52)'; e.target.style.borderColor = 'rgba(255,255,255,0.14)'; }}
              onBlurCapture={(e) => { (e.target as HTMLInputElement).style.background = 'transparent'; (e.target as HTMLInputElement).style.borderColor = 'transparent'; }}
            />
            <Pencil size={13} strokeWidth={2} style={{ position: 'absolute', right: 9, color: 'var(--text-ghost)', pointerEvents: 'none' }} />
          </label>
        ) : (
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-primary)', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
            Customize
          </span>
        )}
        <span style={{ flex: 1 }} />
        <motion.button
          type="button"
          onClick={save}
          whileTap={{ scale: 0.96 }}
          className="cz-focus"
          style={{
            pointerEvents: 'auto', flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '9px 18px', borderRadius: 11, border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
            color: dirty ? '#fafafa' : 'var(--text-secondary)',
            background: dirty ? 'var(--accent, #c44444)' : justSaved ? 'rgba(140,191,138,0.16)' : 'rgba(40,48,65,0.52)',
            boxShadow: dirty ? '0 4px 14px -4px rgba(196,68,68,0.6)' : 'none',
            backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
            transition: 'background 200ms var(--ease-out-quart), color 200ms var(--ease-out-quart), box-shadow 200ms var(--ease-out-quart)',
          }}
        >
          {!dirty && justSaved && <Check size={14} strokeWidth={2.4} style={{ color: 'var(--live, #8cbf8a)' }} />}
          {dirty ? 'Save' : justSaved ? 'Saved' : 'Save'}
        </motion.button>
      </motion.div>

      <GroupRail groups={groups} active={group} onPick={pickGroup} />

      <AnimatePresence>
        {group === 'scene' ? (
          <motion.div key="scene" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <LightOrbit
              angle={lightingAngle}
              hex={accentHex ?? ACCENT_COLORS[accentIndex]?.hex ?? '#f0e8d6'}
              intensity={lightIntensity}
              onAngle={(a) => {
                setLightingAngle(a);
                touch('lightingAngle');
                onEmit({ EventType: 'changeLightAngle', lightAngle: String(a) });
              }}
            />
            <SceneDeck
              tab={sceneTab}
              onTab={setSceneTab}
              lightHex={accentHex ?? ACCENT_COLORS[accentIndex]?.hex ?? '#ffffff'}
              accentIndex={accentHex ? -1 : accentIndex}
              accentHex={accentHex}
              onAccent={(i) => { setAccentIndex(i); setAccentHex(undefined); touch('accent'); emitLight(ACCENT_COLORS[i], lightIntensity); }}
              onAccentCustom={(rect) => setPicker({ target: { kind: 'accent' }, rect })}
              lightIntensity={lightIntensity}
              onLightIntensity={(v) => { setLightIntensity(v); touch('lightIntensity'); emitLight(accentRgb(), v); }}
              bgHex={bgHex ?? BG_COLORS[bgIndex]?.hex ?? '#1a2338'}
              bgIndex={bgHex ? -1 : bgIndex}
              bgCustomHex={bgHex}
              onBg={(i) => { setBgIndex(i); setBgHex(undefined); touch('bg'); emitBG(BG_COLORS[i], bgGlow); }}
              onBgCustom={(rect) => setPicker({ target: { kind: 'bg' }, rect })}
              bgGlow={bgGlow}
              onBgGlow={(v) => { setBgGlow(v); touch('bgGlow'); emitBG(bgRgb(), v); }}
              bgMode={clampBgMode(bgMode)}
              onBgMode={onBgMode ? (m) => { onEmit({ EventType: 'changeBGMaterial', bgmode: m }); onBgMode(m); } : undefined}
              effectId={effectId}
              effectStrength={effectStrength}
              onEffect={(id) => applyEffect(id, effectStrength)}
              onEffectStrength={(v) => applyEffect(effectId, v)}
            />
          </motion.div>
        ) : pane === 'body' ? (
          <ColumnIsland
            key="body"
            title={GROUP_META.body.label}
            width={172}
            bottom={14}
            tabs={unified ? <Tabs id="body" items={bodyTabs} value={tuneTab} onChange={setTuneTab} /> : undefined}
          >
            {unified ? (
              tuneTab === 'colour' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <SwatchRow
                    label="Hair"
                    items={HAIR_COLORS.map((h, i) => ({ key: String(i), hex: h.hex, name: h.label }))}
                    activeKey={hairColor?.preset !== undefined ? String(hairColor.preset) : null}
                    onPick={(k) => pickHair(Number(k))}
                  />
                  <SwatchRow
                    label="Eyes"
                    items={EYE_COLORS.map((e) => ({ key: e.iris, hex: e.hex, name: e.label }))}
                    activeKey={eyeColor?.iris ?? null}
                    onPick={pickEyes}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Skin</span>
                    {(skins?.length ?? 0) > 1 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {skins!.map((sk) => {
                          const on = sk.path === activeSkin;
                          return (
                            <button
                              key={sk.path}
                              type="button"
                              onClick={() => onPickSkin?.(sk.path)}
                              className="cz-focus"
                              style={{
                                padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                                background: on ? 'rgba(196,68,68,0.16)' : 'rgba(255,255,255,0.04)',
                                border: on ? '1px solid rgba(196,68,68,0.55)' : '1px solid rgba(255,255,255,0.10)',
                                color: on ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 11.5, fontWeight: 500,
                              }}
                            >
                              {sk.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={regenSkin === 'busy' || !onRegenSkin}
                      onClick={async () => {
                        if (!onRegenSkin) return;
                        setRegenSkin('busy');
                        const ok = await onRegenSkin();
                        setRegenSkin(ok ? 'idle' : 'failed');
                      }}
                      className="cz-focus"
                      style={{
                        alignSelf: 'flex-start', padding: '8px 13px', borderRadius: 10, fontFamily: 'inherit',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                        color: regenSkin === 'failed' ? 'var(--accent, #c44444)' : 'var(--text-primary)',
                        fontSize: 12.5, fontWeight: 600, cursor: regenSkin === 'busy' ? 'default' : 'pointer',
                        opacity: regenSkin === 'busy' ? 0.6 : 1,
                      }}
                    >
                      {regenSkin === 'busy' ? 'Painting new skin' : regenSkin === 'failed' ? 'Failed, try again' : 'Generate new skin'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
                  {(tuneTab === 'body' ? UNIFIED_BODY_AXES : UNIFIED_FACE_AXES).map((ax) => (
                    <Lever key={ax.key} label={ax.label} plus={ax.plus} minus={ax.minus}
                      value={axes[ax.key] ?? 0} onChange={(v) => setAxis(ax.key, v)} />
                  ))}
                </div>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 6 }}>
                <Lever label="Height" plus="Tall" minus="Short" value={heightBlend}
                  onChange={(v) => { setHeightBlend(v); touch('heightBlend'); emitBlends(v, weightBlend); }} />
                <Lever label="Weight" plus="Full" minus="Slim" value={weightBlend}
                  onChange={(v) => { setWeightBlend(v); touch('weightBlend'); emitBlends(heightBlend, v); }} />
              </div>
            )}
          </ColumnIsland>
        ) : (
          <ColumnIsland
            key={`items-${group}`}
            title={GROUP_META[group].label}
            tabs={<Tabs id={`g-${group}`} items={groupPanes.map((p) => ({ id: p, label: PANE_LABELS[p] }))} value={pane} onChange={(p) => setPane(p)} />}
          >
            <div role="listbox" aria-label={PANE_LABELS[pane]} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((it) => (
                <NamedTile key={`${pane}-${it.key}`} item={it} selected={it.index === selected} onPick={() => pickItem(pane as CustomCategory, it.index)}
                  height={it.key === 'none' ? 48 : 88} />
              ))}
            </div>
          </ColumnIsland>
        )}
      </AnimatePresence>

      {isGarment && (
        <Dock
          name={activeItem?.name ?? ''}
          position={position}
          colour={colourable ? {
            pair: clothingColors[pane as 'top' | 'bottom' | 'shoes'],
            onPreset: (slot, idx) => setTone(pane as 'top' | 'bottom' | 'shoes', slot, idx),
            onCustom: (slot, rect) => setPicker({ target: { kind: 'clothing', cat: pane as 'top' | 'bottom' | 'shoes', slot }, rect }),
          } : undefined}
        />
      )}

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

// ============ lever =================================================
// A bipolar HORIZONTAL fader: zero in the middle, poles at the ends (minus
// left, plus right). Custom rather than an <input type=range> because this
// needs a center detent, a fill that grows OUT from the middle, and a thumb
// that snaps home. The mixing-desk read is the point: two faders, both resting
// at center, is instantly legible as "she is at her defaults".

const DETENT = 0.05;   // snap-to-zero window; the lever has a real center click

/** Unified hosts get the extended rig. Kept as its own test rather than reusing
 *  isCustomCharacter: grace_custom is a "custom character" but has no blend rig,
 *  so the two questions are genuinely different. */
function isUnifiedHost(agentId?: string | null): boolean {
  return !!agentId && (agentId === 'unified' || agentId.startsWith('unified'));
}

// The 16 axes, named the way a person would describe the change rather than the
// way the rig does. Poles are labelled because a bipolar lever with no ends is
// a mystery: "Jawline" alone does not tell you which way is softer.
const UNIFIED_BODY_AXES = [
  { key: 'mascFem',  label: 'Build',     minus: 'Masc',   plus: 'Fem' },
  { key: 'height',   label: 'Height',    minus: 'Short',  plus: 'Tall' },
  { key: 'fat',      label: 'Weight',    minus: 'Slim',   plus: 'Full' },
  { key: 'musc',     label: 'Muscle',    minus: 'Soft',   plus: 'Toned' },
  { key: 'shoulder', label: 'Shoulders', minus: 'Narrow', plus: 'Broad' },
  { key: 'chest',    label: 'Chest',     minus: 'Flat',   plus: 'Full' },
  { key: 'waistHip', label: 'Waist',     minus: 'Straight', plus: 'Curved' },
  { key: 'neck',     label: 'Neck',      minus: 'Thin',   plus: 'Thick' },
] as const;

const UNIFIED_FACE_AXES = [
  { key: 'jawline',   label: 'Jawline',   minus: 'Soft',   plus: 'Sharp' },
  { key: 'chin',      label: 'Chin',      minus: 'Receded', plus: 'Forward' },
  { key: 'cheek',     label: 'Cheeks',    minus: 'Hollow', plus: 'Full' },
  { key: 'nose',      label: 'Nose size', minus: 'Small',  plus: 'Large' },
  { key: 'noseShape', label: 'Nose shape', minus: 'Narrow', plus: 'Wide' },
  { key: 'mouthSize', label: 'Mouth',     minus: 'Narrow', plus: 'Wide' },
  { key: 'lip',       label: 'Lips',      minus: 'Thin',   plus: 'Full' },
  { key: 'eyeSize',   label: 'Eyes',      minus: 'Small',  plus: 'Large' },
] as const;

/** Colour row. Same swatch vocabulary as the clothing colours so the surface has
 *  one way of picking a colour, not three. */
function SwatchRow({ label, items, activeKey, onPick }: {
  label: string;
  items: Array<{ key: string; hex: string; name: string }>;
  activeKey: string | null;
  onPick: (key: string) => void;
}) {
  const active = items.find((i) => i.key === activeKey);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--text-ghost)',
        }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {active?.name ?? 'As read'}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((it) => {
          const on = it.key === activeKey;
          return (
            <button
              key={it.key}
              type="button"
              aria-label={it.name}
              onClick={() => onPick(it.key)}
              style={{
                width: 18, height: 18, borderRadius: '50%', padding: 0,
                background: it.hex,
                border: on ? '1.5px solid rgba(255,255,255,0.92)' : '1px solid rgba(255,255,255,0.14)',
                boxShadow: on ? '0 0 0 3px rgba(0,0,0,0.45)' : 'none',
                transform: on ? 'scale(1.14)' : 'scale(1)',
                transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1)',
                cursor: 'pointer',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function Lever({ label, plus, minus, value, onChange }: {
  label: string;
  plus: string;
  minus: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Pointer x -> signed value. Left is minus, right is plus.
  const fromPointer = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const t = (clientX - r.left) / r.width;        // 0 at left, 1 at right
    const v = t * 2 - 1;                            // -1 left, +1 right
    const clamped = Math.max(-1, Math.min(1, v));
    return Math.abs(clamped) < DETENT ? 0 : Math.round(clamped * 100) / 100;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(fromPointer(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    onChange(fromPointer(e.clientX));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowRight')     { e.preventDefault(); onChange(Math.min(1, round2(value + step))); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(Math.max(-1, round2(value - step))); }
    else if (e.key === 'Home' || e.key === '0') { e.preventDefault(); onChange(0); }
  };

  // Thumb position as a percentage of the track: -1 left, +1 right. The track
  // fills its column, so everything is relative.
  const pct = ((value + 1) / 2) * 100;
  const fillLeft = value > 0 ? 50 : pct;
  const fillW = Math.abs(value) * 50;
  const readout = value === 0 ? 'Default' : `${value > 0 ? plus : minus} ${Math.round(Math.abs(value) * 100)}%`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{
          fontSize: 11.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          color: value === 0 ? 'var(--text-ghost)' : 'var(--text-secondary, #d4cec7)',
        }}>
          {readout}
        </span>
      </div>

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
        className="cz-focus"
        style={{
          position: 'relative', width: '100%', height: 20, borderRadius: 6,
          cursor: dragging ? 'grabbing' : 'pointer', touchAction: 'none',
        }}
      >
        <span style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: 3, marginTop: -1.5, borderRadius: 999, background: 'rgba(255,255,255,0.13)',
        }} />
        {/* center detent: home, visible at a glance */}
        <span style={{ position: 'absolute', top: 4, bottom: 4, left: '50%', width: 1, background: 'rgba(255,255,255,0.30)' }} />
        <motion.span
          animate={{ left: `${fillLeft}%`, width: `${fillW}%` }}
          transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
          style={{ position: 'absolute', top: '50%', height: 3, marginTop: -1.5, borderRadius: 999, background: 'rgba(255, 245, 235, 0.78)' }}
        />
        <motion.span
          animate={{ left: `${pct}%` }}
          transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
          style={{
            position: 'absolute', top: '50%', width: 14, height: 14, marginTop: -7, marginLeft: -7,
            borderRadius: '50%', background: 'rgba(255, 248, 240, 0.96)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.6), 0 0 12px rgba(255,240,220,0.35)',
            scale: value === 0 ? 0.86 : 1,
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <PoleLabel active={value < -0.02}>{minus}</PoleLabel>
        <PoleLabel active={value > 0.02}>{plus}</PoleLabel>
      </div>
    </div>
  );
}

function PoleLabel({ children, active }: { children: React.ReactNode; active: boolean }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 500, whiteSpace: 'nowrap',
      // The engaged pole brightens: which way you've pushed, without a readout.
      color: active ? 'var(--text-primary, #fafafa)' : 'var(--text-ghost)',
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
