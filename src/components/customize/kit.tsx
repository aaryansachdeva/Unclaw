// Shared pieces of the customize surface (2026-09-16 split-islands redesign):
// the group model, the glass island, text tabs, the named tile, swatches and
// the deck slider. One vocabulary for every island so the surface reads as
// one object in the room, not four widgets.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { PersonStanding, Scissors, Shirt, Smile, Sun, type LucideIcon } from 'lucide-react';
import type { CustomCategory, WardrobeItem } from '../../wardrobe/catalog';

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** The editable panes. Garment categories keep their UE wardrobeCategory
 *  names; body and scene are ours. */
export type Pane = CustomCategory | 'body' | 'scene';
export type GroupId = 'hair' | 'facial' | 'outfit' | 'body' | 'scene';

export const GROUP_OF: Record<Pane, GroupId> = {
  hair: 'hair', eyebrow: 'hair', eyelash: 'hair',
  beard: 'facial', mustache: 'facial',
  top: 'outfit', bottom: 'outfit', shoes: 'outfit',
  body: 'body', scene: 'scene',
};

export const GROUP_META: Record<GroupId, { label: string; icon: LucideIcon }> = {
  hair:   { label: 'Hair',   icon: Scissors },
  facial: { label: 'Facial', icon: Smile },
  outfit: { label: 'Outfit', icon: Shirt },
  body:   { label: 'Body',   icon: PersonStanding },
  scene:  { label: 'Scene',  icon: Sun },
};

export const GROUP_ORDER: GroupId[] = ['hair', 'facial', 'outfit', 'body', 'scene'];

/** Frosted slate at panel intensity, with the inset top highlight that makes
 *  the glass read as material. */
export const ISLAND: CSSProperties = {
  background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.52))',
  backdropFilter: 'var(--glass-blur, blur(36px) saturate(1.7))',
  WebkitBackdropFilter: 'var(--glass-blur, blur(36px) saturate(1.7))',
  border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
  boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 22px 48px -18px rgba(0,0,0,0.62)',
  pointerEvents: 'auto',
  WebkitAppRegion: 'no-drag',
} as CSSProperties;

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

/** A named tile: the thumbnail fills it, the name sits on a scrim at the foot.
 *  Selection is an ember hairline plus a lift, never a heavy ring. */
export function NamedTile({ item, selected, onPick, height = 104 }: {
  item: WardrobeItem;
  selected: boolean;
  onPick: () => void;
  height?: number;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      title={item.name}
      className="cz-tile"
      style={{
        position: 'relative', flex: '0 0 auto', width: '100%', height,
        padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
        background: 'rgba(255,255,255,0.035)',
        border: selected ? '1px solid var(--accent, #c44444)' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: selected
          ? '0 0 0 1px var(--accent, #c44444) inset, 0 10px 22px -12px rgba(196,68,68,0.65)'
          : 'none',
        transition: 'border-color 160ms var(--ease-out-quart), box-shadow 200ms var(--ease-out-quart)',
      }}
    >
      {item.thumb ? (
        <img src={item.thumb} alt="" draggable={false} loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <span style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: 12, fontWeight: 600, color: 'var(--text-ghost)',
        }}>
          {item.name}
        </span>
      )}
      {item.thumb && (
        <span style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, padding: '16px 8px 5px',
          textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: '-0.005em',
          color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          background: 'linear-gradient(to top, rgba(12,14,20,0.86), rgba(12,14,20,0))',
        }}>
          {item.name}
        </span>
      )}
    </button>
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

/** One stylesheet for the surface's native controls. */
export function CustomizeStyles() {
  return (
    <style>{`
      input.cz-range { -webkit-appearance: none; appearance: none; width: 100%; height: 2px; border-radius: 999px; outline: none; cursor: pointer; margin: 6px 0; }
      input.cz-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: rgba(255,248,240,0.96); box-shadow: 0 1px 5px rgba(0,0,0,0.6), 0 0 10px rgba(255,240,220,0.3); transition: transform 180ms cubic-bezier(0.16,1,0.3,1); }
      input.cz-range:hover::-webkit-slider-thumb { transform: scale(1.15); }
      input.cz-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(196,68,68,0.5); }
      .cz-tile:focus-visible, .cz-focus:focus-visible { outline: 1.5px solid var(--accent, #c44444); outline-offset: 2px; }
      .cz-scroll { scrollbar-width: none; }
      .cz-scroll::-webkit-scrollbar { display: none; }
      @media (prefers-reduced-motion: reduce) { .cz-orbit-pulse { animation: none !important; } }
      @keyframes cz-pulse { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(2.2); opacity: 0; } }
    `}</style>
  );
}
