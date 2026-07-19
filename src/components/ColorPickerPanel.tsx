// A compact, on-brand HSV color picker popover. Saturation/value square + hue
// bar + hex field, in the frosted-slate material. Opens anchored to a trigger
// swatch (anchorRect), live-fires onChange as you drag, closes on Esc /
// outside-click. No external dependency — the color math + pointer handling
// live here so it matches DESIGN.md exactly.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ---- color math (pure) ----------------------------------------------------
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(clamp01(x / 255) * 255).toString(16).padStart(2, '0')).join('');
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
export function hexToHsv(hex: string) { const { r, g, b } = hexToRgb(hex); return rgbToHsv(r, g, b); }
export function hsvToHex(h: number, s: number, v: number) { const { r, g, b } = hsvToRgb(h, s, v); return rgbToHex(r, g, b); }
/** Hex -> {r,g,b} in 0..1, for the UE changeClothingColor / changeLightColor descriptors. */
export function hexToRgb01(hex: string) { const { r, g, b } = hexToRgb(hex); return { r: r / 255, g: g / 255, b: b / 255 }; }
/** Round to 3dp and stay a NUMBER. changeLightColor's Blueprint reads its fields
 *  with `Get Number Field`, which returns 0 for a JSON string — so `toFixed(3)`
 *  (a string) silently blacks the light out. Use this instead of toFixed for any
 *  descriptor field UE parses as a number. */
export function round3(n: number): number { return Math.round(n * 1000) / 1000; }
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

// ---- component ------------------------------------------------------------
interface ColorPickerPanelProps {
  color: string;                 // current hex
  onChange: (hex: string) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;    // trigger swatch rect (viewport coords)
}

const PANEL_W = 208;
const PANEL_H = 248;

export function ColorPickerPanel({ color, onChange, onClose, anchorRect }: ColorPickerPanelProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexText, setHexText] = useState(() => hsvToHex(hsv.h, hsv.s, hsv.v));
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);

  const apply = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const nh = hsvToHex(next.h, next.s, next.v);
    setHexText(nh);
    onChange(nh);
  };

  // Esc + outside-click to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    // defer the outside-click listener a tick so the opening click doesn't close it
    const id = window.setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.clearTimeout(id);
    };
  }, [onClose]);

  const handleSvPointer = (e: React.PointerEvent) => {
    const el = svRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const s = clamp01((e.clientX - r.left) / r.width);
    const v = clamp01(1 - (e.clientY - r.top) / r.height);
    apply({ ...hsv, s, v });
  };
  const handleHuePointer = (e: React.PointerEvent) => {
    const el = hueRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const h = clamp01((e.clientX - r.left) / r.width) * 360;
    apply({ ...hsv, h });
  };

  // Position: prefer below the anchor, flip above if it would overflow; clamp X.
  let left = 16, top = 16;
  if (anchorRect) {
    left = Math.min(Math.max(8, anchorRect.left + anchorRect.width / 2 - PANEL_W / 2), window.innerWidth - PANEL_W - 8);
    const below = anchorRect.bottom + 10;
    top = below + PANEL_H > window.innerHeight - 8 ? Math.max(8, anchorRect.top - PANEL_H - 10) : below;
  }

  const hueColor = hsvToHex(hsv.h, 1, 1);

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.18, ease: EASE_OUT_EXPO }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, width: PANEL_W, zIndex: 80,
        padding: 12,
        display: 'flex', flexDirection: 'column', gap: 11,
        background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.72))',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 14,
        backdropFilter: 'var(--glass-blur, blur(34px) saturate(1.6))',
        WebkitBackdropFilter: 'var(--glass-blur, blur(34px) saturate(1.6))',
        boxShadow: '0 18px 50px -16px rgba(0,0,0,0.7)',
        pointerEvents: 'auto',
      }}
    >
      {/* saturation / value square */}
      <div
        ref={svRef}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); handleSvPointer(e); }}
        onPointerMove={(e) => { if (e.buttons === 1) handleSvPointer(e); }}
        style={{
          position: 'relative', width: '100%', height: 132, borderRadius: 9, cursor: 'crosshair',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
          touchAction: 'none',
        }}
      >
        <span style={{
          position: 'absolute',
          left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
          width: 14, height: 14, marginLeft: -7, marginTop: -7,
          borderRadius: '50%', background: hex,
          border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
        }} />
      </div>

      {/* hue bar */}
      <div
        ref={hueRef}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); handleHuePointer(e); }}
        onPointerMove={(e) => { if (e.buttons === 1) handleHuePointer(e); }}
        style={{
          position: 'relative', width: '100%', height: 13, borderRadius: 7, cursor: 'ew-resize',
          background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
          touchAction: 'none',
        }}
      >
        <span style={{
          position: 'absolute', left: `${(hsv.h / 360) * 100}%`, top: '50%',
          width: 15, height: 15, marginLeft: -7.5, marginTop: -7.5,
          borderRadius: '50%', background: hueColor,
          border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
        }} />
      </div>

      {/* hex field + current-color chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 24, height: 24, flex: '0 0 auto', borderRadius: 7, background: hex,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18), 0 1px 3px rgba(0,0,0,0.4)',
        }} />
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{
            position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
            fontSize: 12, color: 'var(--text-ghost)', pointerEvents: 'none',
          }}>#</span>
          <input
            value={hexText.replace('#', '')}
            onChange={(e) => {
              const t = e.target.value;
              setHexText('#' + t);
              if (HEX_RE.test(t)) {
                const nh = '#' + t.replace('#', '');
                setHsv(hexToHsv(nh));
                onChange(nh);
              }
            }}
            onBlur={() => setHexText(hex)}
            spellCheck={false}
            maxLength={6}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 8px 6px 18px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, outline: 'none',
              color: 'var(--text-primary)', fontSize: 12.5, letterSpacing: '0.06em',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase',
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}
