// After a MetaHuman arrives from Unreal: name it, give it a personality, give
// it a voice, then go and dress it. This is ONBOARDING for a character, and it
// is deliberately the same surface: the full-width sheet in the InputBar's
// slot, the ember tick and 24px title of StepHeader, the one 560px measure of
// StepShell, the pinned footer. It used to be a 460px card floating at z60 on
// top of a live InputBar, greeting, glance column and character switcher, so
// meeting a new character felt like a popup interrupting the app instead of
// the app doing one thing. App.tsx now hides that chrome while this is open,
// exactly as it does for the onboarding wizard.
//
//   1. Name         prefilled from the export's manifest name
//   2. Personality  the onboarding vibe sliders, saved on this character only
//   3. Voice        a built-in character's voice, or a clone: record up to
//                   15 s or drop a clip (soul /tts/voices), or reuse one
//
// "Hear it" speaks a line on stage in the candidate voice, so the user hears
// the new character itself. Nothing is saved until Finish; Skip keeps the
// manifest name and the defaults.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Check, Mic, Square, Upload, Volume2 } from 'lucide-react';

import { Slider } from './Onboarding/Slider';
import { FIELD_BASE, StepShell, applyBlur, applyFocus } from './Onboarding/onboardingKit';
import { CHARACTERS, type CharacterVoices } from '../characters';
import type { CharacterVibe } from '../hooks/useAgentStack';
import { useVoiceCloner } from '../hooks/useVoiceCloner';
import { vibeWord } from '../services/userSettings';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STEPS = ['Name', 'Personality', 'Voice'] as const;

/** Spring + step motion copied from the onboarding wizard so the two surfaces
 *  move identically. A character setup that eased differently read as a
 *  different product. */
const PANEL_SPRING = { type: 'spring' as const, stiffness: 320, damping: 34, mass: 0.8 };

/** The engines a cloned voice plays on. */
const CLONE_ENGINES = new Set(['pocket', 'chatterbox']);

export interface CharacterSetupResult {
  name: string;
  vibe: CharacterVibe;
  /** A built-in character id whose voices this character uses. */
  voiceFrom?: string;
  /** A cloned voice slug. */
  voice?: string;
}

/** "Test_New" -> "Test New": export folder names read like file names. */
export function displayNameFromExport(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function CharacterSetupPanel({
  initialName, defaultVibe, ttsProvider, onPreview, onFinish,
}: {
  initialName: string;
  /** Starting sliders: the user's onboarding vibe. */
  defaultVibe: CharacterVibe;
  /** The selected TTS engine; cloned voices need Pocket or Chatterbox. */
  ttsProvider: string | null;
  /** Speak `line` on stage with these voices. */
  onPreview: (voices: Partial<CharacterVoices>, line: string) => Promise<void>;
  onFinish: (result: CharacterSetupResult) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState(initialName);
  const [vibe, setVibe] = useState<CharacterVibe>(defaultVibe);
  const [voiceMode, setVoiceMode] = useState<'builtin' | 'clone'>('builtin');
  const [voiceFrom, setVoiceFrom] = useState<string>(CHARACTERS[0]?.id ?? 'grace_custom');
  const [cloneSlug, setCloneSlug] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const cloner = useVoiceCloner();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const shownName = name.trim() || initialName || 'your character';
  const clonePlays = !!ttsProvider && CLONE_ENGINES.has(ttsProvider);

  useEffect(() => { if (step === 0) nameRef.current?.focus(); }, [step]);

  const go = useCallback((next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
  }, [step]);

  const finish = useCallback(() => {
    const result: CharacterSetupResult = { name: shownName, vibe };
    if (voiceMode === 'clone' && cloneSlug) result.voice = cloneSlug;
    else result.voiceFrom = voiceFrom;
    onFinish(result);
  }, [cloneSlug, onFinish, shownName, vibe, voiceFrom, voiceMode]);

  const canNext = step === 0 ? shownName.length > 0
    : step === 2 ? (voiceMode === 'builtin' || !!cloneSlug)
    : true;

  const preview = useCallback(async (key: string, voices: Partial<CharacterVoices>) => {
    setPreviewing(key);
    try {
      await onPreview(voices, `Hi, I'm ${shownName}. This is how I sound.`);
    } finally {
      setPreviewing((cur) => (cur === key ? null : cur));
    }
  }, [onPreview, shownName]);

  const onCloned = (slug: string | undefined) => { if (slug) setCloneSlug(slug); };

  const setSlider = (k: keyof CharacterVibe) => (v: number) => setVibe((cur) => ({ ...cur, [k]: v }));

  const body = useMemo<ReactNode>(() => {
    if (step === 0) {
      return (
        <StepShell
          accent={false}
          title="What should we call them?"
          subtitle="This is the name they answer to and the one in your roster."
        >
          <input
            ref={nameRef}
            type="text"
            value={name}
            maxLength={40}
            placeholder={initialName || 'Name'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) go(1); }}
            onFocus={(e) => applyFocus(e.target)}
            onBlur={(e) => applyBlur(e.target)}
            style={FIELD_BASE}
          />
        </StepShell>
      );
    }
    if (step === 1) {
      return (
        <StepShell
          accent={false}
          title={`How does ${shownName} talk?`}
          subtitle={`Only for ${shownName}. Your other characters keep their own vibe.`}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', rowGap: 16, columnGap: 28 }}>
            <Slider value={vibe.formality} onChange={setSlider('formality')} leftLabel="Casual" rightLabel="Formal" caption="Formality" word={vibeWord('formality', vibe.formality)} />
            <Slider value={vibe.humor} onChange={setSlider('humor')} leftLabel="Dry" rightLabel="Playful" caption="Humor" word={vibeWord('humor', vibe.humor)} />
            <Slider value={vibe.directness} onChange={setSlider('directness')} leftLabel="Gentle" rightLabel="Blunt" caption="Directness" word={vibeWord('directness', vibe.directness)} />
            <Slider value={vibe.verbosity} onChange={setSlider('verbosity')} leftLabel="Brief" rightLabel="Thorough" caption="Verbosity" word={vibeWord('verbosity', vibe.verbosity)} />
          </div>
        </StepShell>
      );
    }
    return (
      <StepShell
        accent={false}
        title={`Give ${shownName} a voice.`}
        subtitle="Pick one, or clone a voice from a short clip. You will hear it on stage."
      >
        <div role="tablist" aria-label="Voice source" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)' }}>
          {(['builtin', 'clone'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={voiceMode === m}
              onClick={() => setVoiceMode(m)}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: voiceMode === m ? 600 : 500,
                color: voiceMode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: voiceMode === m ? 'rgba(255,255,255,0.10)' : 'transparent',
                transition: 'background 150ms var(--ease-out-quart), color 150ms var(--ease-out-quart)',
              }}
            >
              {m === 'builtin' ? 'Pick a voice' : 'Clone a voice'}
            </button>
          ))}
        </div>

        {voiceMode === 'builtin' ? (
          <div role="radiogroup" aria-label="Built-in voices" className="no-scrollbar" style={{ marginTop: 10, maxHeight: 172, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {CHARACTERS.map((c) => (
              <VoiceRow
                key={c.id}
                selected={voiceFrom === c.id}
                title={c.displayName}
                meta={c.blurb.replace(/\s*Custom build\.?$/, '')}
                onSelect={() => setVoiceFrom(c.id)}
                onPreview={() => void preview(c.id, c.voices)}
                previewing={previewing === c.id}
              />
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!clonePlays && (
              <Note>
                Cloned voices play on the Pocket and Chatterbox engines. Switch the engine in Settings &gt; Voice to hear this one; until then {shownName} uses your current engine's voice.
              </Note>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {cloner.busy === 'recording' ? (
                <button type="button" style={{ ...PILL, ...PILL_ACCENT }} onClick={cloner.stop}>
                  <Square size={12} /> Stop · {cloner.seconds.toFixed(1)} s
                </button>
              ) : (
                <button type="button" style={PILL} disabled={cloner.busy !== 'idle'} onClick={() => void cloner.record(shownName).then((v) => onCloned(v?.slug))}>
                  <Mic size={13} /> Record
                </button>
              )}
              <button type="button" style={PILL} disabled={cloner.busy !== 'idle'} onClick={() => fileRef.current?.click()}>
                <Upload size={13} /> Choose a clip
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void cloner.uploadFile(shownName, f).then((v) => onCloned(v?.slug));
                  e.target.value = '';
                }}
              />
              <span style={META}>
                {cloner.busy === 'uploading' ? 'Cloning…'
                  : cloner.busy === 'recording' ? 'Speak naturally. Stops by itself at 15 s.'
                  : '6 to 15 seconds of clean speech, no music'}
              </span>
            </div>
            {cloner.error && <div style={{ ...META, color: 'var(--danger, #c87a7a)' }}>{cloner.error}</div>}
            {cloner.voices && cloner.voices.length > 0 && (
              <div role="radiogroup" aria-label="Cloned voices" className="no-scrollbar" style={{ maxHeight: 132, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {cloner.voices.map((v) => (
                  <VoiceRow
                    key={v.slug}
                    selected={cloneSlug === v.slug}
                    title={v.name}
                    meta={`${v.seconds.toFixed(1)} s clip`}
                    onSelect={() => setCloneSlug(v.slug)}
                    onPreview={clonePlays ? () => void preview(v.slug, { pocket: v.slug, chatterbox: v.slug }) : undefined}
                    previewing={previewing === v.slug}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </StepShell>
    );
  }, [step, name, initialName, go, shownName, vibe, voiceMode, voiceFrom, previewing, preview, clonePlays, cloner, cloneSlug]);

  return (
    <motion.div
      role="dialog"
      aria-label={`Set up ${shownName}`}
      // `layout` so the sheet breathes between steps of different height,
      // exactly as the wizard does: the name step is one field, the voice step
      // is a list.
      layout
      initial={reduce ? { y: 0, opacity: 0 } : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduce ? { y: 0, opacity: 0 } : { y: 24, opacity: 0 }}
      transition={reduce ? { duration: 0 } : PANEL_SPRING}
      style={{
        // The InputBar's slot, the wizard's surface. App.tsx hides the
        // InputBar, the glance column, the widget rail and the switcher while
        // this is mounted, so this sheet IS the app for its duration.
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 30,
        background: 'var(--glass-bg-panel)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border-focus)',
        borderRadius: 16,
        boxShadow: [
          '0 1px 0 rgba(255, 255, 255, 0.06) inset',
          '0 16px 36px -10px rgba(0, 0, 0, 0.45)',
        ].join(', '),
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100% - 80px)',
        overflow: 'hidden',
        pointerEvents: 'auto',
        willChange: 'transform, opacity',
      }}
    >
      {/* Body scrolls; the footer below stays pinned so the primary action is
          always reachable, same as the wizard. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '20px 22px 14px' }}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -14 }}
            transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>

      <div style={{
        position: 'relative',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
      }}>
        {step > 0 && (
          <button type="button" onClick={() => go(step - 1)} style={{ ...PILL, border: 'none', paddingLeft: 6 }}>
            <ArrowLeft size={14} /> Back
          </button>
        )}
        <div style={{ flex: 1 }} />
        {/* Dots centred on the SHEET, not on the space left over between the
            buttons: step one has no Back, so a flex-centred row drifts right
            by exactly the width of a button that is not there. Absolute
            centring is the only kind that survives the footer's contents
            changing from step to step. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 5,
            pointerEvents: 'none',
          }}
        >
          {STEPS.map((s, i) => (
            <motion.span
              key={s}
              layout
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }}
              style={{
                width: i === step ? 18 : 6,
                height: 6,
                borderRadius: 3,
                background: i === step ? 'var(--accent, #c44444)'
                  : i < step ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.16)',
                boxShadow: i === step ? '0 0 8px var(--accent-strong, rgba(196,68,68,0.6))' : 'none',
              }}
            />
          ))}
        </div>
        {step < STEPS.length - 1 && (
          <button type="button" onClick={finish} style={{ ...PILL, border: 'none', color: 'var(--text-ghost)' }}>
            Skip for now
          </button>
        )}
        <motion.button
          type="button"
          disabled={!canNext || cloner.busy !== 'idle'}
          onClick={() => (step < STEPS.length - 1 ? go(step + 1) : finish())}
          whileHover={canNext && !reduce ? { y: -1 } : undefined}
          whileTap={canNext && !reduce ? { y: 0, scale: 0.98 } : undefined}
          style={{
            ...PILL,
            border: 'none',
            padding: '8px 18px',
            fontWeight: 600,
            color: '#fff',
            background: canNext ? 'var(--accent, #c44444)' : 'rgba(255,255,255,0.08)',
            opacity: canNext ? 1 : 0.6,
            cursor: canNext ? 'pointer' : 'default',
          }}
        >
          {step < STEPS.length - 1 ? 'Continue' : `Dress ${shownName}`}
        </motion.button>
      </div>
    </motion.div>
  );
}

function VoiceRow({
  selected, title, meta, onSelect, onPreview, previewing,
}: {
  selected: boolean; title: string; meta: string;
  onSelect: () => void; onPreview?: () => void; previewing: boolean;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 8px 7px 10px', borderRadius: 10, cursor: 'pointer',
        background: selected ? 'rgba(255,255,255,0.09)' : 'transparent',
        transition: 'background 120ms var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <span aria-hidden style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: selected ? 'none' : '1.5px solid rgba(255,255,255,0.28)',
        background: selected ? 'var(--text-primary)' : 'transparent',
        color: 'rgb(30, 36, 50)',
      }}>
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: selected ? 600 : 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        <div style={{ ...META, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</div>
      </div>
      {onPreview && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          disabled={previewing}
          aria-label={`Hear ${title}`}
          style={{ ...PILL, padding: '5px 10px', fontSize: 11.5, opacity: previewing ? 0.6 : 1 }}
        >
          <Volume2 size={12} /> {previewing ? 'Speaking' : 'Hear it'}
        </button>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ ...META, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)' }}>
      {children}
    </div>
  );
}

const META: CSSProperties = { fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-secondary)', letterSpacing: '0.005em' };

const PILL: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 12px', borderRadius: 999,
  background: 'transparent',
  border: '1px solid var(--glass-border)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500,
  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
};

const PILL_ACCENT: CSSProperties = {
  borderColor: 'rgba(196, 68, 68, 0.55)',
  color: '#e8a0a0',
};
