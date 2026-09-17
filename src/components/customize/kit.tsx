// Shared pieces of the customize surface (2026-09-16 hotspot redesign): text
// tabs, swatches, the deck slider and the one stylesheet. Nothing here is a
// glass box: controls sit on scrims that come out of the room's own darkness.

import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { CustomCategory } from '../../wardrobe/catalog';

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** The editable panes. Garment categories keep their UE wardrobeCategory
 *  names; body and scene are ours. */
export type Pane = CustomCategory | 'body' | 'scene';

/** Text tabs with a sliding ember underline. Hidden when there is only one. */
export function Tabs<T extends string>({ id, items, value, onChange, style }: {
  id: string;
  items: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  style?: CSSProperties;
}) {
  if (items.length < 2) return null;
  return (
    <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: '0 9px', ...style }}>
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            style={{
              position: 'relative', background: 'none', border: 'none', cursor: 'pointer',
              padding: '3px 0 6px', fontFamily: 'inherit', fontSize: 11.5,
              fontWeight: on ? 600 : 500, letterSpacing: '-0.01em',
              color: on ? 'var(--text-primary)' : 'var(--text-ghost)',
              transition: 'color 160ms var(--ease-out-quart)',
            }}
          >
            {t.label}
            {on && (
              <motion.span
                layoutId={`tabs-underline-${id}`}
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0, height: 1.5,
                  borderRadius: 2, background: 'var(--accent, #c44444)',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// The colour-wheel fill for the "any colour" swatch.
const RAINBOW = 'conic-gradient(from 0deg, #ff4d4d, #ffd24d, #7dff4d, #4dffd2, #4d9dff, #7d4dff, #ff4dd2, #ff4d4d)';

/** A preset palette plus an any-colour swatch that opens the picker. */
export function Swatches({ colors, activeIndex, customHex, onPick, onCustom, size = 20, glow = false }: {
  colors: Array<{ label: string; hex: string }>;
  activeIndex: number;
  customHex?: string;
  onPick: (i: number) => void;
  onCustom?: (rect: DOMRect) => void;
  size?: number;
  /** Lights glow in their own colour when chosen. */
  glow?: boolean;
}) {
  const dot = (hex: string, label: string, on: boolean, onClick: (r: DOMRect) => void, wheel = false) => (
    <motion.button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
      onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
      style={{
        width: size, height: size, padding: 0, borderRadius: '50%', cursor: 'pointer', flex: '0 0 auto',
        background: wheel ? RAINBOW : hex,
        border: on ? '2px solid rgba(250,250,250,0.95)' : '1px solid rgba(255,255,255,0.16)',
        boxShadow: on && glow ? `0 0 14px 1px ${hex}` : on ? '0 0 0 3px rgba(0,0,0,0.35)' : 'none',
        transition: 'border-color 160ms var(--ease-out-quart), box-shadow 200ms var(--ease-out-quart)',
      }}
    />
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: size > 20 ? 10 : 7 }}>
      {colors.map((c, i) => dot(c.hex, c.label, !customHex && i === activeIndex, () => onPick(i)))}
      {onCustom && dot(customHex ?? '#888', customHex ? 'Custom colour' : 'Any colour', !!customHex, onCustom, !customHex)}
    </div>
  );
}

/** Label left, value right, a hairline range underneath. */
export function DeckSlider({ label, value, min, max, step = 0.1, onChange, format }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {format ? format(value) : value.toFixed(1)}
        </span>
      </span>
      <input
        type="range"
        className="cz-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, rgba(255,245,235,0.78) 0%, rgba(255,245,235,0.78) ${pct}%, rgba(255,255,255,0.14) ${pct}%, rgba(255,255,255,0.14) 100%)`,
        }}
      />
    </label>
  );
}

export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{children}</span>
      {aside && <span style={{ fontSize: 11.5, color: 'var(--text-ghost)' }}>{aside}</span>}
    </div>
  );
}

/** One stylesheet for the surface's native controls, spots and tiles. */
export function CustomizeStyles() {
  return (
    <style>{`
      input.cz-range { -webkit-appearance: none; appearance: none; width: 100%; height: 2px; border-radius: 999px; outline: none; cursor: pointer; margin: 6px 0; }
      input.cz-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: rgba(255,248,240,0.96); box-shadow: 0 1px 5px rgba(0,0,0,0.6), 0 0 10px rgba(255,240,220,0.3); transition: transform 180ms cubic-bezier(0.16,1,0.3,1); }
      input.cz-range:hover::-webkit-slider-thumb { transform: scale(1.15); }
      input.cz-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(196,68,68,0.5); }
      .cz-focus:focus-visible { outline: 1.5px solid var(--accent, #c44444); outline-offset: 2px; }
      .cz-scroll { scrollbar-width: none; }
      .cz-scroll::-webkit-scrollbar { display: none; }

      .cz-spot-ring { position: absolute; left: 50%; top: 50%; width: 30px; height: 30px; margin: -15px; border-radius: 50%; border: 1px solid rgba(255,233,214,0.7); animation: cz-breathe 2.8s cubic-bezier(0.16,1,0.3,1) infinite; pointer-events: none; }
      @keyframes cz-breathe { 0% { transform: scale(0.45); opacity: 0.9; } 70% { opacity: 0; } 100% { transform: scale(1.35); opacity: 0; } }

      .cz-relit { position: relative; aspect-ratio: 1 / 1.1; padding: 0; overflow: hidden; border-radius: 14px; cursor: pointer; background: #121419; border: none; font-family: inherit; box-shadow: 0 0 0 1px rgba(255,255,255,0.07) inset; transition: box-shadow 240ms cubic-bezier(0.16,1,0.3,1); }
      .cz-relit img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; filter: grayscale(0.7) contrast(1.32) brightness(0.8); transform: scale(1.06); transition: filter 300ms cubic-bezier(0.16,1,0.3,1), transform 500ms cubic-bezier(0.16,1,0.3,1); }
      .cz-relit::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; background: linear-gradient(150deg, rgba(255,196,150,0.5), rgba(255,196,150,0) 55%); mix-blend-mode: soft-light; }
      .cz-relit::after { content: ""; position: absolute; inset: 0; z-index: 2; pointer-events: none; border-radius: inherit; background: radial-gradient(110% 85% at 50% 38%, rgba(8,9,12,0) 38%, rgba(8,9,12,0.9) 100%); transition: box-shadow 240ms cubic-bezier(0.16,1,0.3,1); }
      .cz-relit:hover img { filter: grayscale(0.45) contrast(1.3) brightness(0.92); transform: scale(1.12); }
      .cz-relit.on { box-shadow: 0 0 0 1.5px rgba(255,236,220,0.92) inset, 0 12px 28px -12px rgba(0,0,0,0.9), 0 0 36px -8px rgba(255,200,160,0.45); }
      .cz-relit.on img { filter: grayscale(0.35) contrast(1.28) brightness(0.98); }
      .cz-relit.applying::after { box-shadow: 0 0 0 1.5px rgba(255,236,220,0.25) inset; }
      .cz-relit.applying > img { animation: cz-dim 1.1s ease-in-out infinite alternate; }
      @keyframes cz-dim { from { opacity: 1; } to { opacity: 0.55; } }
      .cz-relit.none { aspect-ratio: auto; background: rgba(255,255,255,0.03); }
      .cz-relit.none::before, .cz-relit.none::after { display: none; }
      .cz-none { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 9px; font-size: 12.5px; font-weight: 700; color: var(--text-secondary, #d4cec7); }
      .cz-none i { position: relative; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid currentColor; opacity: 0.7; }
      .cz-none i::after { content: ""; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1.5px; margin-left: -0.75px; background: currentColor; transform: rotate(45deg); }

      .cz-spin { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid rgba(255,233,214,0.25); border-top-color: rgba(255,233,214,0.95); animation: cz-rot 700ms linear infinite; }
      @keyframes cz-rot { to { transform: rotate(360deg); } }

      .cz-sweep { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen; opacity: 0; background: linear-gradient(100deg, transparent 40%, rgba(255,233,214,0.14) 50%, transparent 60%); background-size: 260% 100%; animation: cz-sweep 1100ms cubic-bezier(0.16,1,0.3,1) forwards; }
      @keyframes cz-sweep { 0% { opacity: 1; background-position: 130% 0; } 85% { opacity: 1; } 100% { opacity: 0; background-position: -30% 0; } }

      @media (prefers-reduced-motion: reduce) {
        .cz-orbit-pulse, .cz-spot-ring, .cz-sweep, .cz-relit.applying > img { animation: none !important; }
        .cz-spot-ring { opacity: 0.5; transform: scale(1); }
      }
      @keyframes cz-pulse { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(2.2); opacity: 0; } }
    `}</style>
  );
}
