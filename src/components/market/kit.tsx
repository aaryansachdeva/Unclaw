// Shared pieces for the community screens: one spinner, one pill, one meta
// line, so the Share sheet and the Community overlay speak the same language
// as the setup flow they sit next to.

import type { CSSProperties } from 'react';

export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const META: CSSProperties = { fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-secondary)', letterSpacing: '0.005em' };

export const PILL: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999,
  background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-primary)',
  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};

export const PRIMARY: CSSProperties = {
  ...PILL, border: 'none', padding: '8px 18px', fontWeight: 600, color: '#fff', background: 'var(--accent, #c44444)',
};

export function Spinner() {
  return <span className="mk-spin" aria-hidden />;
}

export function MarketStyles() {
  return (
    <style>{`
      .mk-spin { display: inline-block; width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;
        border: 1.5px solid rgba(255,255,255,0.22); border-top-color: rgba(255,255,255,0.9); animation: mk-rot 700ms linear infinite; }
      @keyframes mk-rot { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .mk-spin { animation-duration: 2s; } }
      .mk-card:focus-visible, .mk-focus:focus-visible { outline: 2px solid var(--accent, #c44444); outline-offset: 2px; }
    `}</style>
  );
}
