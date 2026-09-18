// The inspector: what opens beside her when you tap a spot. It is not a card.
// A scrim rises out of the room's darkness at the right edge and the options
// sit on it, and the region's name flies in from its spot label (shared
// layoutId). It used to draw a hairline back to the part it edits, which meant
// a line straight across her body; now the spot on her and this title wear the
// same ember mark instead, which says the same thing over her, not through her.

import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { WardrobeItem } from '../../wardrobe/catalog';
import { EASE_OUT_EXPO } from './kit';
import type { RegionId } from './regions';

export const INSPECTOR_W = 212;
const TOP = 112;

export type ApplyPhase = 'idle' | 'applying' | 'landed';

export function Inspector({ region, title, tabs, status, children }: {
  region: RegionId;
  title: string;
  tabs?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: INSPECTOR_W + 110, pointerEvents: 'none',
          background: 'linear-gradient(to left, rgba(7,8,11,0.9) 0%, rgba(7,8,11,0.8) 58%, rgba(7,8,11,0) 100%)',
        }}
      />
      <motion.aside
        aria-label={title}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 16 }}
        transition={{ duration: 0.42, ease: EASE_OUT_EXPO }}
        style={{
          position: 'absolute', top: TOP, right: 0, bottom: 0, width: INSPECTOR_W, padding: '0 14px 0 16px',
          display: 'flex', flexDirection: 'column', pointerEvents: 'auto', WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        <motion.h2
          layoutId={`cz-region-${region}`}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          style={{
            margin: 0, fontSize: 30, lineHeight: '34px', fontWeight: 800, letterSpacing: '-0.04em',
            color: 'var(--text-primary, #fafafa)', whiteSpace: 'nowrap', alignSelf: 'flex-start',
            display: 'inline-flex', alignItems: 'center', gap: 9,
          }}
        >
          {/* The spot on her wears this same mark. A shared colour ties the two
              together without drawing a line across her. */}
          <span aria-hidden style={{
            width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto',
            background: 'var(--accent, #c44444)',
            boxShadow: '0 0 10px 1px rgba(196,68,68,0.55)',
          }} />
          {title}
        </motion.h2>
        <div style={{ minHeight: 20, marginTop: 2 }}>{status}</div>
        {tabs && <div style={{ marginTop: 12 }}>{tabs}</div>}
        <div
          className="cz-scroll"
          style={{
            flex: 1, minHeight: 0, overflowY: 'auto', margin: '12px -6px 0', padding: '4px 6px 40px',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 48px), transparent)',
            maskImage: 'linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 48px), transparent)',
          }}
        >
          {children}
        </div>
      </motion.aside>
    </>
  );
}

/** What is on her in this pane, and whether Unreal has put it there yet. */
export function ApplyStatus({ name, position, phase, who }: {
  name: string;
  position?: string;
  phase: ApplyPhase;
  who?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, fontSize: 13, lineHeight: '18px' }}>
      <span style={{ fontWeight: 700, color: 'var(--text-primary, #fafafa)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        {name}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto', fontSize: 11.5, color: 'var(--text-secondary, #d4cec7)', fontVariantNumeric: 'tabular-nums' }}>
        {phase === 'applying' && <><span className="cz-spin" />Applying</>}
        {phase === 'landed' && <><Check size={11} strokeWidth={3} style={{ color: 'var(--live, #8cbf8a)' }} />{who ? `On ${who}` : 'Applied'}</>}
        {phase === 'idle' && position}
      </span>
    </div>
  );
}

/** Words, not pills. The active one is bone and heavy with an ember point. */
export function WordTabs<T extends string>({ items, value, onChange }: {
  items: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  if (items.length < 2) return null;
  return (
    <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className="cz-focus"
            style={{
              position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0 8px',
              fontFamily: 'inherit', fontSize: 14, fontWeight: on ? 800 : 600, letterSpacing: '-0.015em',
              color: on ? 'var(--text-primary, #fafafa)' : 'var(--text-ghost)',
              transition: 'color 160ms var(--ease-out-quart)',
            }}
          >
            {t.label}
            {on && (
              <motion.span
                layoutId="cz-wordtab-dot"
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                style={{ position: 'absolute', left: '50%', bottom: 1, width: 4, height: 4, marginLeft: -2, borderRadius: '50%', background: 'var(--accent, #c44444)' }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Epic's grey studio renders, pulled into the room: desaturated, warmed from
 *  the key side and vignetted so they read as lit objects, not stock icons. */
export function RelitTile({ item, selected, applying, onPick, onPreview }: {
  item: WardrobeItem;
  selected: boolean;
  applying: boolean;
  onPick: () => void;
  onPreview?: (name: string | null) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  const none = item.key === 'none';
  return (
    <motion.button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={item.name}
      onClick={onPick}
      onMouseEnter={() => onPreview?.(item.name)}
      onMouseLeave={() => onPreview?.(null)}
      whileTap={{ scale: 0.96 }}
      className={`cz-focus cz-relit${selected ? ' on' : ''}${selected && applying ? ' applying' : ''}${none ? ' none' : ''}`}
      style={{ gridColumn: none ? '1 / -1' : undefined, height: none ? 42 : undefined }}
    >
      {none ? (
        <span className="cz-none"><i />None</span>
      ) : item.thumb ? (
        <img src={item.thumb} alt="" draggable={false} loading="lazy" />
      ) : (
        <span className="cz-none">{item.name}</span>
      )}
    </motion.button>
  );
}

export function TileGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="listbox" aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
      {children}
    </div>
  );
}

export function Sweep({ run }: { run: number }) {
  if (!run) return null;
  return <div key={run} className="cz-sweep" aria-hidden />;
}
