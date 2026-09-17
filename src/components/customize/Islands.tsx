// The split-islands frame (2026-09-16): a slim group rail floating on the
// left, the chosen group's tiles in a column island on the right, a dock at
// the foot naming what is selected. The character stays centred and whole;
// the chrome sits on the edges of the room.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Palette } from 'lucide-react';
import { CLOTHING_COLORS } from '../CustomizationOverlay';
import type { ClothingColor } from '../../services/userSettings';
import { EASE_OUT_EXPO, GROUP_META, ISLAND, Swatches, type GroupId } from './kit';

export function GroupRail({ groups, active, onPick }: {
  groups: GroupId[];
  active: GroupId;
  onPick: (g: GroupId) => void;
}) {
  return (
    <motion.nav
      aria-label="Customize groups"
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
      style={{
        ...ISLAND, position: 'absolute', left: 12, top: '50%', marginTop: -((groups.length * 62 + 12) / 2),
        width: 76, padding: 6, borderRadius: 24, display: 'flex', flexDirection: 'column', gap: 2,
      }}
    >
      {groups.map((g) => {
        const on = g === active;
        const Icon = GROUP_META[g].icon;
        return (
          <button
            key={g}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(g)}
            className="cz-focus"
            style={{
              position: 'relative', height: 60, border: 'none', borderRadius: 18, background: 'transparent', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
              color: on ? 'var(--text-primary)' : 'var(--text-ghost)', fontFamily: 'inherit',
              transition: 'color 160ms var(--ease-out-quart)',
            }}
          >
            {on && (
              <motion.span
                layoutId="cz-rail-pill"
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                style={{ position: 'absolute', inset: 0, borderRadius: 18, background: 'rgba(250,250,250,0.09)', boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset' }}
              />
            )}
            <Icon size={19} strokeWidth={1.8} style={{ position: 'relative', color: on ? 'var(--accent, #c44444)' : 'currentColor' }} />
            <span style={{ position: 'relative', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.01em' }}>{GROUP_META[g].label}</span>
          </button>
        );
      })}
    </motion.nav>
  );
}

/** The right-hand island: title, tabs, and a scrolling body. */
export function ColumnIsland({ title, tabs, children, bottom = 92, width = 144 }: {
  title: string;
  tabs?: ReactNode;
  children: ReactNode;
  bottom?: number;
  width?: number;
}) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.36, ease: EASE_OUT_EXPO }}
      style={{
        ...ISLAND, position: 'absolute', right: 12, top: 124, bottom, width,
        borderRadius: 22, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 10px 2px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{title}</span>
        {tabs}
      </div>
      <div className="cz-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 9px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {children}
      </div>
    </motion.aside>
  );
}

/** Bottom dock: what is on the character right now, plus its colour. */
export function Dock({ name, position, colour }: {
  name: string;
  position: string;
  colour?: {
    pair: ClothingColor;
    onPreset: (slot: 'c1' | 'c2', idx: number) => void;
    onCustom: (slot: 'c1' | 'c2', rect: DOMRect) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (!colour) setOpen(false); }, [colour]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // The custom colour picker is portaled; clicks inside it keep the palette open.
      if (ref.current?.contains(t) || t.closest?.('[data-color-picker]')) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'absolute', left: 100, right: 168, bottom: 14, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ position: 'relative', pointerEvents: 'auto', maxWidth: '100%' }}>
        <AnimatePresence>
          {open && colour && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              style={{
                ...ISLAND, position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%', x: '-50%',
                width: 'max-content', maxWidth: 'min(400px, calc(100vw - 32px))', borderRadius: 18, padding: '12px 14px',
                display: 'flex', flexDirection: 'column', gap: 12, transformOrigin: 'bottom center',
              }}
            >
              {(['c1', 'c2'] as const).map((slot) => {
                const hex = slot === 'c1' ? colour.pair.c1Hex : colour.pair.c2Hex;
                const idx = slot === 'c1' ? colour.pair.c1 : colour.pair.c2;
                return (
                  <div key={slot} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {slot === 'c1' ? 'Main' : 'Trim'}
                      <span style={{ fontWeight: 500, color: 'var(--text-ghost)', marginLeft: 8 }}>
                        {hex ? 'Custom' : CLOTHING_COLORS[idx]?.label}
                      </span>
                    </span>
                    <Swatches colors={CLOTHING_COLORS} activeIndex={idx} customHex={hex}
                      onPick={(i) => colour.onPreset(slot, i)} onCustom={(r) => colour.onCustom(slot, r)} size={20} />
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{ ...ISLAND, borderRadius: 16, padding: colour ? '6px 6px 6px 16px' : '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={name}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16, ease: EASE_OUT_EXPO }}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
            >
              {name}
              <span style={{ fontWeight: 500, color: 'var(--text-ghost)', marginLeft: 8, fontVariantNumeric: 'tabular-nums' }}>{position}</span>
            </motion.span>
          </AnimatePresence>
          {colour && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="cz-focus"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 11px', borderRadius: 11, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.12)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                background: open ? 'rgba(250,250,250,0.10)' : 'transparent', color: 'var(--text-primary)', whiteSpace: 'nowrap',
              }}
            >
              <Palette size={14} strokeWidth={2} />
              <span style={{ display: 'inline-flex' }}>
                {(['c1', 'c2'] as const).map((slot, i) => {
                  const hex = (slot === 'c1' ? colour.pair.c1Hex : colour.pair.c2Hex) ?? CLOTHING_COLORS[slot === 'c1' ? colour.pair.c1 : colour.pair.c2]?.hex;
                  return <span key={slot} style={{ width: 12, height: 12, borderRadius: '50%', background: hex, border: '1.5px solid rgba(20,24,32,0.9)', marginLeft: i ? -4 : 0 }} />;
                })}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
