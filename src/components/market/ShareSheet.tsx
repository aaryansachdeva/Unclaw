// Share a finished character with the community. Offered once, right after a
// new character is named, voiced and dressed, and on demand from Community >
// Yours. It lives in the setup flow's surface (the InputBar's slot, the
// wizard's spring) so it reads as the last step of making a character, not a
// store form. Optional in every sense: "Not now" is always one click.

import { useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { FIELD_BASE, FieldLabel, StepShell, applyBlur, applyFocus } from '../Onboarding/onboardingKit';
import {
  MARKET_TERMS_URL, MarketError, shareCharacter, type ShareStep, type Visibility,
} from '../../services/market';
import type { AgentInstance } from '../../hooks/useAgentStack';
import { META, MarketStyles, PILL, Spinner } from './kit';

const PANEL_SPRING = { type: 'spring' as const, stiffness: 320, damping: 34, mass: 0.8 };

const STEP_WORDS: Record<ShareStep, string> = {
  preparing: 'Getting their files ready',
  character: 'Uploading the character',
  voice: 'Uploading the voice',
  picture: 'Uploading the picture',
  publishing: 'Publishing',
};

interface Props {
  token: string;
  inst: AgentInstance;
  /** A portrait taken from the live character just before the sheet opened. */
  thumb: Blob;
  voiceName?: string;
  onClose: () => void;
  onShared: (listingId: string) => void;
}

export function ShareSheet({ token, inst, thumb, voiceName, onClose, onShared }: Props) {
  const reduce = useReducedMotion() ?? false;
  const [thumbUrl] = useState(() => URL.createObjectURL(thumb));
  const [name, setName] = useState(inst.name?.trim() || 'Character');
  const [blurb, setBlurb] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState<ShareStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const busy = step !== null && !done;
  const canShare = agreed && name.trim().length > 0 && !busy;

  const share = async () => {
    if (!canShare) return;
    setError(null);
    try {
      const id = await shareCharacter({
        token, inst, name: name.trim(), blurb: blurb.trim(), visibility, voiceName, thumb, onStep: setStep,
      });
      setDone(true);
      onShared(id);
    } catch (e) {
      setStep(null);
      setError(e instanceof MarketError ? e.message : 'Sharing failed. Try again.');
    }
  };

  const title = done ? `${name.trim()} is shared` : `Share ${name.trim() || 'them'} with the community?`;
  const subtitle = done
    ? visibility === 'public'
      ? 'Anyone can find them in Community now. To hide or delete them, open Community and choose Yours.'
      : 'Only you can see them. To make them public, open Community and choose Yours.'
    : 'Others can add them to their Unclaw, voice and all. You can hide or delete them any time.';

  return (
    <motion.div
      role="dialog"
      aria-label={title}
      layout
      initial={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
      transition={reduce ? { duration: 0 } : PANEL_SPRING}
      style={SHEET}
    >
      <MarketStyles />
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '20px 22px 14px' }}>
        <StepShell accent={false} title={title} subtitle={done ? undefined : subtitle}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            <img
              src={thumbUrl}
              alt=""
              style={{
                width: 112, aspectRatio: '4 / 5', objectFit: 'cover', borderRadius: 12, flexShrink: 0,
                border: '1px solid var(--glass-border)', boxShadow: '0 10px 24px -12px rgba(0,0,0,0.6)',
              }}
            />
            {done && (
              <p style={{ margin: 0, alignSelf: 'center', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-secondary)', maxWidth: '44ch' }}>
                {subtitle}
              </p>
            )}
            {!done && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <FieldLabel text="Name">
                  <input
                    value={name}
                    maxLength={60}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={(e) => applyFocus(e.currentTarget)}
                    onBlur={(e) => applyBlur(e.currentTarget)}
                    style={FIELD_BASE}
                  />
                </FieldLabel>
                <FieldLabel text="About them" count={280 - blurb.length}>
                  <textarea
                    value={blurb}
                    rows={2}
                    maxLength={280}
                    disabled={busy}
                    placeholder="Optional"
                    onChange={(e) => setBlurb(e.target.value)}
                    onFocus={(e) => applyFocus(e.currentTarget)}
                    onBlur={(e) => applyBlur(e.currentTarget)}
                    style={FIELD_BASE}
                  />
                </FieldLabel>
              </div>
            )}
          </div>

          {!done && (
            <>
              <div role="radiogroup" aria-label="Who can find them" style={{ display: 'flex', gap: 8 }}>
                <Choice on={visibility === 'public'} disabled={busy} onClick={() => setVisibility('public')}
                  title="Everyone" meta="Listed in Community" />
                <Choice on={visibility === 'private'} disabled={busy} onClick={() => setVisibility('private')}
                  title="Only me" meta="Saved to your account" />
              </div>

              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: busy ? 'default' : 'pointer' }}>
                <span
                  role="checkbox"
                  aria-checked={agreed}
                  tabIndex={0}
                  onClick={(e) => { e.preventDefault(); if (!busy) setAgreed((a) => !a); }}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!busy) setAgreed((a) => !a); } }}
                  style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: agreed ? 'none' : '1.5px solid rgba(255,255,255,0.3)',
                    background: agreed ? 'var(--accent, #c44444)' : 'transparent',
                    color: '#fff', transition: 'background 140ms var(--ease-out-quart)',
                  }}
                >
                  {agreed && <Check size={12} strokeWidth={3} />}
                </span>
                <span style={META}>
                  This character's face and voice are mine to share, or I have permission, and they follow the{' '}
                  <a
                    href={MARKET_TERMS_URL}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void window.electronAPI?.authOpenExternal?.(MARKET_TERMS_URL); }}
                    style={{ color: 'var(--text-primary)', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    community terms
                  </a>.
                </span>
              </label>
            </>
          )}

          <AnimatePresence initial={false}>
            {(error || busy) && (
              <motion.div
                key={error ? 'err' : 'busy'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{ ...META, color: error ? '#e8a0a0' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {!error && <Spinner />}
                {error ?? `${STEP_WORDS[step as ShareStep]}…`}
              </motion.div>
            )}
          </AnimatePresence>
        </StepShell>
      </div>

      <div style={FOOTER}>
        <div style={{ flex: 1 }} />
        {!done && (
          <button type="button" onClick={onClose} disabled={busy} style={{ ...PILL, border: 'none', color: 'var(--text-ghost)', opacity: busy ? 0.5 : 1 }}>
            Not now
          </button>
        )}
        <motion.button
          type="button"
          disabled={!done && !canShare}
          onClick={done ? onClose : share}
          whileHover={(done || canShare) && !reduce ? { y: -1 } : undefined}
          whileTap={(done || canShare) && !reduce ? { y: 0, scale: 0.98 } : undefined}
          style={{
            ...PILL, border: 'none', padding: '8px 18px', fontWeight: 600, color: '#fff',
            background: done || canShare ? 'var(--accent, #c44444)' : 'rgba(255,255,255,0.08)',
            opacity: done || canShare ? 1 : 0.6,
            cursor: done || canShare ? 'pointer' : 'default',
          }}
        >
          {done ? 'Done' : busy ? 'Sharing' : 'Share'}
        </motion.button>
      </div>
    </motion.div>
  );
}

function Choice({ on, disabled, onClick, title, meta }: { on: boolean; disabled: boolean; onClick: () => void; title: string; meta: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 11, cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', color: 'var(--text-primary)',
        background: on ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${on ? 'var(--glass-border-focus)' : 'var(--glass-border)'}`,
        transition: 'background 140ms var(--ease-out-quart), border-color 140ms var(--ease-out-quart)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: on ? 600 : 500 }}>{title}</div>
      <div style={{ ...META, marginTop: 1 }}>{meta}</div>
    </button>
  );
}

const SHEET: CSSProperties = {
  position: 'absolute', left: 16, right: 16, bottom: 16, zIndex: 30,
  background: 'var(--glass-bg-panel)',
  backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
  border: '1px solid var(--glass-border-focus)', borderRadius: 16,
  boxShadow: '0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 16px 36px -10px rgba(0, 0, 0, 0.45)',
  display: 'flex', flexDirection: 'column', maxHeight: 'calc(100% - 80px)', overflow: 'hidden',
  pointerEvents: 'auto', willChange: 'transform, opacity',
};

const FOOTER: CSSProperties = {
  position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
  padding: '12px 16px', borderTop: '1px solid rgba(255, 255, 255, 0.06)',
};
