// Scene, redesigned (2026-09-16). The old Environment strip crammed a dial,
// two palettes, two sliders and a dropdown into one bar. Now the light lives
// where light lives: on the stage. A perspective orbit ring sits around the
// character and the key light is a glowing body you drag around it, dimming
// as it passes behind. Everything else (colour, brightness, backdrop, effects)
// moves to one deck at the foot, one job per tab.
//
// Angle convention is the LightingDial's (and UE's changeLightAngle): 0 at
// the front (toward the camera, the dial's 12 o'clock), 90 camera-right, 180
// behind, 270 camera-left.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ACCENT_COLORS, BG_COLORS, BG_GLOW_MAX, BG_GLOW_MIN, LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_MIN,
} from '../CustomizationOverlay';
import { BACKGROUNDS } from '../../wardrobe/backgrounds';
import { STREAM_EFFECTS, EffectSwatch, effectFor, DEFAULT_EFFECT_ID } from '../StreamEffects';
import { DeckSlider, EASE_OUT_EXPO, SectionLabel, Swatches, Tabs } from './kit';

export type SceneTab = 'light' | 'backdrop' | 'effects';

function sideName(a: number): string {
  const n = ((a % 360) + 360) % 360;
  if (n < 23 || n >= 338) return 'Front';
  if (n < 68) return 'Front right';
  if (n < 113) return 'Right';
  if (n < 158) return 'Back right';
  if (n < 203) return 'Behind';
  if (n < 248) return 'Back left';
  if (n < 293) return 'Left';
  return 'Front left';
}

/** The orbit ring and the draggable key light, drawn over the stream. Only the
 *  ring's stroke and the light take the pointer, so the rest of the stream
 *  still reaches Unreal. */
export function LightOrbit({ angle, hex, intensity, onAngle }: {
  angle: number;
  hex: string;
  intensity: number;
  onAngle: (a: number) => void;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState({ w: 600, h: 780 });
  const [drag, setDrag] = useState(false);
  const raf = useRef<number | null>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);

  // Around the hips in the full-body framing, wide enough to read as a floor
  // ring, flattened for perspective.
  const cx = box.w / 2;
  const cy = box.h * 0.6;
  const rx = Math.min(box.w * 0.36, 210);
  const ry = rx * 0.27;

  const queue = useCallback((a: number) => {
    pending.current = a;
    if (raf.current == null) {
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        if (pending.current != null) onAngle(pending.current);
        pending.current = null;
      });
    }
  }, [onAngle]);

  const angleAt = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = (clientX - r.left - cx) / rx;
    const dy = (clientY - r.top - cy) / ry;
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return Math.round((deg + 360) % 360);
  };

  const rad = (angle * Math.PI) / 180;
  const lx = cx + rx * Math.sin(rad);
  const ly = cy + ry * Math.cos(rad);
  const behind = Math.cos(rad) < 0;
  const lit = (intensity - LIGHT_INTENSITY_MIN) / (LIGHT_INTENSITY_MAX - LIGHT_INTENSITY_MIN);
  const knob = 11 + lit * 4;

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag(true);
    queue(angleAt(e.clientX, e.clientY));
  };
  const move = (e: React.PointerEvent) => { if (drag) queue(angleAt(e.clientX, e.clientY)); };
  const up = (e: React.PointerEvent) => {
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    setDrag(false);
  };

  // Back half of the ellipse (upper arc) and front half (lower arc).
  const back = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`;
  const front = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`;

  return (
    <motion.svg
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <defs>
        <radialGradient id="cz-light-glow">
          <stop offset="0%" stopColor={hex} stopOpacity={0.85} />
          <stop offset="45%" stopColor={hex} stopOpacity={0.28} />
          <stop offset="100%" stopColor={hex} stopOpacity={0} />
        </radialGradient>
        <linearGradient id="cz-ray" x1={lx} y1={ly} x2={cx} y2={cy - ry * 3.2} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={hex} stopOpacity={0.45 * (0.4 + lit)} />
          <stop offset="100%" stopColor={hex} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* The ring: the far arc recedes, the near arc is brighter. */}
      <path d={back} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={1.2} strokeDasharray="2 6" />
      <path d={front} fill="none" stroke="rgba(255,255,255,0.34)" strokeWidth={1.4} />
      {/* A wide invisible stroke so a click anywhere on the ring places the light. */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="transparent" strokeWidth={26}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onPointerDown={down} />

      {/* Where the light points: a soft ray toward the chest. */}
      <line x1={lx} y1={ly} x2={cx} y2={cy - ry * 3.2} stroke="url(#cz-ray)" strokeWidth={behind ? 1.5 : 2.5} strokeLinecap="round" />

      <g opacity={behind ? 0.55 : 1} style={{ transition: 'opacity 220ms ease-out' }}>
        <circle cx={lx} cy={ly} r={knob * 3.4} fill="url(#cz-light-glow)" />
        {!drag && (
          <circle cx={lx} cy={ly} r={knob} fill="none" stroke={hex} strokeWidth={1.2} className="cz-orbit-pulse"
            style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'cz-pulse 2.4s cubic-bezier(0.16,1,0.3,1) infinite' }} />
        )}
        <circle
          cx={lx} cy={ly} r={behind ? knob * 0.85 : knob}
          fill={hex}
          stroke="rgba(250,250,250,0.95)" strokeWidth={2}
          role="slider"
          aria-label="Key light direction"
          aria-valuemin={0} aria-valuemax={359} aria-valuenow={angle}
          aria-valuetext={`${sideName(angle)}, ${angle} degrees`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onAngle((angle + 5) % 360); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onAngle((angle + 355) % 360); }
          }}
          style={{ pointerEvents: 'auto', cursor: drag ? 'grabbing' : 'grab', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.55))' }}
          onPointerDown={down}
        />
      </g>

      <text x={lx} y={ly + (behind ? -knob - 12 : knob + 22)} textAnchor="middle"
        style={{ fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, fill: 'rgba(250,250,250,0.92)', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 3 }}>
        {sideName(angle)} {angle}°
      </text>
    </motion.svg>
  );
}

/** Previews that look like the three backdrop styles, drawn in the chosen colour. */
function BackdropPreview({ index, hex }: { index: number; hex: string }) {
  const base: React.CSSProperties = { position: 'absolute', inset: 0 };
  if (index === 1) {
    return (
      <span style={{
        ...base,
        background: `linear-gradient(rgba(255,255,255,0.10) 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, rgba(255,255,255,0.10) 1px, transparent 1px) 0 0 / 12px 12px, radial-gradient(circle at 50% 40%, ${hex}, #07080b 85%)`,
      }} />
    );
  }
  if (index === 2) {
    return (
      <span style={{
        ...base, background: `radial-gradient(circle at 50% 40%, ${hex}, #07080b 85%)`,
        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 7, lineHeight: '8px', color: 'rgba(255,255,255,0.32)',
        overflow: 'hidden', padding: 3, letterSpacing: 1, wordBreak: 'break-all',
      }}>
        {'@#%*+=-:. '.repeat(14)}
      </span>
    );
  }
  return <span style={{ ...base, background: `radial-gradient(circle at 50% 38%, ${hex} 0%, ${hex}aa 30%, #07080b 90%)` }} />;
}

export function SceneDeck(p: {
  tab: SceneTab;
  onTab: (t: SceneTab) => void;
  lightHex: string;
  accentIndex: number;
  accentHex?: string;
  onAccent: (i: number) => void;
  onAccentCustom: (r: DOMRect) => void;
  lightIntensity: number;
  onLightIntensity: (v: number) => void;
  bgHex: string;
  bgIndex: number;
  bgCustomHex?: string;
  onBg: (i: number) => void;
  onBgCustom: (r: DOMRect) => void;
  bgGlow: number;
  onBgGlow: (v: number) => void;
  bgMode?: number;
  onBgMode?: (i: number) => void;
  effectId: string;
  effectStrength: number;
  onEffect: (id: string) => void;
  onEffectStrength: (v: number) => void;
}) {
  const fx = effectFor(p.effectId);
  const tabs: Array<{ id: SceneTab; label: string }> = [
    { id: 'light', label: 'Light' }, { id: 'backdrop', label: 'Backdrop' }, { id: 'effects', label: 'Effects' },
  ];
  const hint = p.tab === 'light' ? 'Drag the light around them' : p.tab === 'backdrop' ? BACKGROUNDS[p.bgMode ?? 0]?.name : fx.name;
  return (
    <motion.section
      aria-label="Scene"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: '64px 18px 16px',
        display: 'flex', flexDirection: 'column', gap: 12, pointerEvents: 'auto', WebkitAppRegion: 'no-drag',
        // A scrim out of the room's darkness, not a glass card over it.
        background: 'linear-gradient(to top, rgba(7,8,11,0.93) 0%, rgba(7,8,11,0.84) 55%, rgba(7,8,11,0) 100%)',
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Tabs id="scene" items={tabs} value={p.tab} onChange={p.onTab} />
        <span style={{ fontSize: 11.5, color: 'var(--text-ghost)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hint}</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={p.tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
          style={{ minHeight: 96 }}
        >
          {p.tab === 'light' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 22, alignItems: 'end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionLabel>Colour</SectionLabel>
                <Swatches colors={ACCENT_COLORS} activeIndex={p.accentIndex} customHex={p.accentHex}
                  onPick={p.onAccent} onCustom={p.onAccentCustom} size={24} glow />
              </div>
              <DeckSlider label="Brightness" value={p.lightIntensity} min={LIGHT_INTENSITY_MIN} max={LIGHT_INTENSITY_MAX}
                onChange={p.onLightIntensity} />
            </div>
          )}

          {p.tab === 'backdrop' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {p.onBgMode && (
                <div role="radiogroup" aria-label="Backdrop style" style={{ display: 'flex', gap: 8 }}>
                  {BACKGROUNDS.map((b) => {
                    const on = (p.bgMode ?? 0) === b.index;
                    return (
                      <button
                        key={b.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => p.onBgMode?.(b.index)}
                        className="cz-focus"
                        style={{
                          position: 'relative', flex: '1 1 0', height: 56, padding: 0, borderRadius: 11, overflow: 'hidden', cursor: 'pointer',
                          border: on ? '1px solid var(--accent, #c44444)' : '1px solid rgba(255,255,255,0.10)',
                          boxShadow: on ? '0 0 0 1px var(--accent, #c44444) inset' : 'none',
                        }}
                      >
                        <BackdropPreview index={b.index} hex={p.bgHex} />
                        <span style={{
                          position: 'absolute', left: 8, bottom: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)',
                          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                        }}>{b.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 22, alignItems: 'end' }}>
                <Swatches colors={BG_COLORS} activeIndex={p.bgIndex} customHex={p.bgCustomHex} onPick={p.onBg} onCustom={p.onBgCustom} size={22} />
                <DeckSlider label="Glow" value={p.bgGlow} min={BG_GLOW_MIN} max={BG_GLOW_MAX} onChange={p.onBgGlow} />
              </div>
            </div>
          )}

          {p.tab === 'effects' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div role="listbox" aria-label="Effects" className="cz-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                {STREAM_EFFECTS.map((e) => {
                  const on = e.id === p.effectId;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      title={e.name}
                      onClick={() => p.onEffect(e.id)}
                      className="cz-focus"
                      style={{
                        position: 'relative', flex: '0 0 auto', width: 62, height: 62, padding: 0, borderRadius: 11,
                        overflow: 'hidden', cursor: 'pointer', background: 'rgba(255,255,255,0.03)',
                        border: on ? '1px solid var(--accent, #c44444)' : '1px solid rgba(255,255,255,0.10)',
                        boxShadow: on ? '0 0 0 1px var(--accent, #c44444) inset' : 'none',
                      }}
                    >
                      {e.id === DEFAULT_EFFECT_ID
                        ? <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--text-ghost)' }}>None</span>
                        : <EffectSwatch effect={e} />}
                    </button>
                  );
                })}
              </div>
              <div style={{ opacity: fx.id === DEFAULT_EFFECT_ID ? 0.35 : 1, pointerEvents: fx.id === DEFAULT_EFFECT_ID ? 'none' : 'auto', transition: 'opacity 180ms ease-out', maxWidth: 260 }}>
                <DeckSlider label="Strength" value={p.effectStrength} min={0} max={1} step={0.01}
                  onChange={p.onEffectStrength} format={(v) => `${Math.round(v * 100)}%`} />
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}
