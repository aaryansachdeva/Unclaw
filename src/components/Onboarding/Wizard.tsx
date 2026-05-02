// Full-window onboarding overlay that walks the user through Identity →
// Vibe → Interests, then saves the profile and triggers the aha-moment
// greeting. Built on top of the existing frosted-slate aesthetic.
//
// Keyboard map:
//   Tab/Shift+Tab     — move between fields
//   Enter             — advance step (when on the focused name field, etc.)
//   Esc               — skip the current step (or close on the last step)
//   Cmd/Ctrl+Enter    — finish from any step
//
// Voice intro plays once on mount (firstRun mode only). On re-open
// (firstRun=false) the wizard prefills with the existing profile, the
// Finish button reads "Save changes", and no voice plays.

import { useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

import { IdentityStep, type IdentityValues } from './IdentityStep';
import { VibeStep } from './VibeStep';
import { InterestsStep, type InterestsValues } from './InterestsStep';
import { WelcomeStep } from './WelcomeStep';
import type { VibeValues } from './VibeStep';
import {
  fetchOnboardingWelcome,
  fetchOnboardingGreet,
  DEFAULT_VIBE,
  type UserProfile,
  type UserSchedule,
} from '../../services/profile';
import type { SoulChatResult } from '../../services/soulChat';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface WizardProps {
  /** True on first launch (no profile yet). False when reopened to edit. */
  firstRun: boolean;
  /** Pre-fill values when reopening to edit. */
  initial?: UserProfile | null;
  /** Active persona's prompt — passed to /onboarding/greet so the
   *  personalization picks up the agent's voice. */
  personaPrompt?: string;
  /** Persist the profile. Parent owns the dual-write strategy (soul +
   *  cloud); the wizard just hands a finished payload over. */
  onSave: (profile: UserProfile) => Promise<UserProfile>;
  /** Called after a successful save. Wizard stays mounted briefly so the
   *  fade-out can play; parent removes it from the tree afterwards. */
  onComplete: (profile: UserProfile) => void;
  /** Called when a chat-shape result is ready to play (welcome line
   *  on mount, aha greeting on save). Parent feeds it to the existing
   *  dispatchChatResult path. */
  onChatResult: (result: SoulChatResult) => void;
  /** User-driven close (Esc on last step / X). Only allowed when
   *  firstRun is false — first-run cannot be closed without saving. */
  onCancel?: () => void;
}

type StepKey = 'welcome' | 'identity' | 'vibe' | 'interests';
const FIRST_RUN_STEPS: StepKey[] = ['welcome', 'identity', 'vibe', 'interests'];
const EDIT_STEPS: StepKey[] = ['identity', 'vibe', 'interests'];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function Wizard({
  firstRun,
  initial,
  personaPrompt,
  onSave,
  onComplete,
  onChatResult,
  onCancel,
}: WizardProps) {
  const reduce = useReducedMotion() ?? false;

  const stepOrder = firstRun ? FIRST_RUN_STEPS : EDIT_STEPS;
  const [step, setStep] = useState<StepKey>(stepOrder[0]);

  const [identity, setIdentity] = useState<IdentityValues>(() => ({
    name:     initial?.name ?? '',
    pronouns: initial?.pronouns ?? '',
    city:     initial?.city ?? '',
    timezone: initial?.timezone ?? detectTimezone(),
  }));

  const [vibe, setVibe] = useState<VibeValues>(() => ({
    formality:  initial?.vibe_formality  ?? DEFAULT_VIBE.vibe_formality,
    humor:      initial?.vibe_humor      ?? DEFAULT_VIBE.vibe_humor,
    directness: initial?.vibe_directness ?? DEFAULT_VIBE.vibe_directness,
    verbosity:  initial?.vibe_verbosity  ?? DEFAULT_VIBE.vibe_verbosity,
  }));

  const [interests, setInterests] = useState<InterestsValues>(() => ({
    interests: initial?.interests ?? [],
    work:      initial?.work ?? '',
    schedule:  (initial?.schedule as UserSchedule | undefined) ?? '',
    notes:     initial?.notes ?? '',
  }));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIdx = stepOrder.indexOf(step);
  const isLastStep = stepIdx === stepOrder.length - 1;
  const canFinish = identity.name.trim().length > 0;
  // Welcome step has no validation gate; identity needs a name; the rest
  // are always advance-able. The Finish action still requires a name.
  const canAdvance = step === 'welcome'
    ? true
    : step === 'identity'
    ? canFinish
    : true;

  // Voice intro plays EXACTLY ONCE per wizard mount, on first-run only.
  // Critical: the previous version had `onChatResult` in the dep array,
  // and because that callback's identity changed across App renders,
  // the effect re-fired repeatedly — each refire hit /onboarding/welcome
  // (Groq + ElevenLabs tokens). The ref guard below makes the network
  // call unconditional-once: even if React re-runs this effect for any
  // reason, the fetch is locked behind a flag that flips on first run.
  const welcomeFiredRef = useRef(false);
  useEffect(() => {
    if (!firstRun) return;
    if (welcomeFiredRef.current) return;
    welcomeFiredRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchOnboardingWelcome();
        if (!cancelled) onChatResult(result);
      } catch (err) {
        console.warn('[onboarding] welcome failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // onChatResult intentionally omitted from deps — the ref guard
    // above is what makes "fire once" guaranteed; including the
    // callback here would re-arm the effect every time App re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRun]);

  const handleAdvance = () => {
    if (step === 'identity' && !canFinish) return;
    if (isLastStep) {
      void handleFinish();
      return;
    }
    setStep(stepOrder[stepIdx + 1]);
  };

  const handleBack = () => {
    if (stepIdx > 0) setStep(stepOrder[stepIdx - 1]);
  };

  const handleSkip = () => {
    // On welcome there's nothing to skip — Continue is the action.
    if (step === 'welcome') return;
    if (step === 'identity') {
      // Skip-the-rest only valid once a name exists.
      if (canFinish) void handleFinish();
      return;
    }
    if (isLastStep) void handleFinish();
    else setStep(stepOrder[stepIdx + 1]);
  };

  const handleFinish = async () => {
    if (!canFinish) {
      setStep('identity');
      setError('Please enter your name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const profile: UserProfile = {
        name:            identity.name.trim(),
        pronouns:        identity.pronouns.trim() || null,
        city:            identity.city.trim() || null,
        timezone:        identity.timezone.trim() || null,
        vibe_formality:  vibe.formality,
        vibe_humor:      vibe.humor,
        vibe_directness: vibe.directness,
        vibe_verbosity:  vibe.verbosity,
        interests:       interests.interests.length ? interests.interests : null,
        work:            interests.work.trim() || null,
        schedule:        interests.schedule || null,
        notes:           interests.notes.trim() || null,
      };
      const saved = await onSave(profile);
      // Fire greeting first (slow), then unmount the wizard so the user
      // doesn't sit on a frozen Finish button while the LLM thinks.
      onComplete(saved);
      // Aha-moment greeting, fully personalized. Best-effort.
      try {
        const greet = await fetchOnboardingGreet(personaPrompt);
        onChatResult(greet);
      } catch (greetErr) {
        console.warn('[onboarding] greet failed', greetErr);
      }
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const onWizardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (submitting) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleFinish();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // First step in edit mode -> close. Otherwise skip the current step.
      if (stepIdx === 0 && !firstRun && onCancel) {
        onCancel();
      } else {
        handleSkip();
      }
    }
  };

  const finishLabel = firstRun ? 'Finish' : 'Save changes';
  // Label stays "Skip" everywhere — short enough not to crowd the
  // narrow footer next to the progress dots and primary button.
  const skipLabel = 'Skip';

  const stepBody = useMemo(() => {
    if (step === 'welcome') return <WelcomeStep />;
    if (step === 'identity') {
      return (
        <IdentityStep
          values={identity}
          onChange={setIdentity}
          onAdvance={handleAdvance}
        />
      );
    }
    if (step === 'vibe') {
      return <VibeStep values={vibe} onChange={setVibe} />;
    }
    return <InterestsStep values={interests} onChange={setInterests} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, identity, vibe, interests]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding"
      onKeyDown={onWizardKey}
      tabIndex={-1}
      initial={reduce
        ? { y: 0, opacity: 1 }
        : { y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduce
        ? { y: 0, opacity: 0 }
        : { y: 24, opacity: 0 }}
      transition={reduce
        ? { duration: 0 }
        : { type: 'spring', stiffness: 320, damping: 34, mass: 0.8 }}
      style={{
        // Bottom-panel layout: replaces the InputBar in the chat dock
        // area. Left/right margins match the InputBar exactly so the
        // wizard reads as the same surface the user types into,
        // expanded for setup. The InputBar is conditionally hidden
        // by App.tsx while this is mounted.
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
        // Cap so we never push above the visible area on a tiny window;
        // otherwise the panel just grows to fit its content. No
        // scrolling — onboarding is short by design and any step that
        // overflows is a content bug, not a UX feature.
        maxHeight: 'calc(100% - 80px)',
        overflow: 'hidden',
        willChange: 'transform, opacity',
      }}
    >
      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Body — animated step content. No scroll: the panel grows to
            fit, and each step is sized to fit comfortably without
            overflowing. */}
        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            padding: '20px 22px 14px',
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={reduce ? { opacity: 1, x: 0 } : { opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0, x: 0 } : { opacity: 0, x: -14 }}
              transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT_EXPO }}
            >
              {stepBody}
            </motion.div>
          </AnimatePresence>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 14,
                fontSize: 12,
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            flexShrink: 0,
            padding: '12px 16px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {/* Welcome has no Skip/Back affordance — Continue is the only
              action. Render a placeholder so the footer keeps balanced
              spacing relative to the progress dots and primary button. */}
          {step === 'welcome' ? (
            <span style={{ width: 50, flexShrink: 0 }} aria-hidden />
          ) : (
            <button
              type="button"
              onClick={stepIdx > 0 ? handleBack : handleSkip}
              disabled={submitting}
              style={footerLinkStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {stepIdx > 0 ? '← Back' : skipLabel}
            </button>
          )}

          {/* Progress dots — current step is a wider pill with a subtle
              accent glow; past steps are small filled circles; future
              steps are small ghost circles. The width transitions on
              step change so the active marker visibly slides forward. */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {stepOrder.map((k, i) => {
              const isCurrent = i === stepIdx;
              const isPast = i < stepIdx;
              return (
                <motion.div
                  key={k}
                  layout
                  initial={false}
                  animate={{
                    width: isCurrent ? 18 : 6,
                    opacity: isCurrent ? 1 : (isPast ? 0.85 : 0.32),
                  }}
                  transition={{
                    duration: reduce ? 0 : 0.32,
                    ease: EASE_OUT_EXPO,
                  }}
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: isCurrent || isPast
                      ? 'var(--accent)'
                      : 'rgba(255, 255, 255, 0.30)',
                    boxShadow: isCurrent
                      ? '0 0 8px var(--accent-strong)'
                      : 'none',
                  }}
                />
              );
            })}
          </div>

          {!isLastStep ? (
            <motion.button
              type="button"
              onClick={handleAdvance}
              disabled={submitting || !canAdvance}
              whileHover={canAdvance && !submitting ? { y: -1 } : undefined}
              whileTap={canAdvance && !submitting ? { y: 0, scale: 0.98 } : undefined}
              transition={{ duration: 0.12, ease: EASE_OUT_EXPO }}
              style={footerPrimaryStyle(canAdvance && !submitting)}
            >
              {step === 'welcome' ? 'Get started →' : 'Continue →'}
            </motion.button>
          ) : (
            <motion.button
              type="button"
              onClick={handleFinish}
              disabled={submitting || !canFinish}
              whileHover={canFinish && !submitting ? { y: -1 } : undefined}
              whileTap={canFinish && !submitting ? { y: 0, scale: 0.98 } : undefined}
              transition={{ duration: 0.12, ease: EASE_OUT_EXPO }}
              style={footerPrimaryStyle(canFinish && !submitting)}
            >
              {submitting ? 'Saving…' : `${finishLabel} ✓`}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

const footerLinkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 12.5,
  fontFamily: 'inherit',
  padding: '6px 10px',
  cursor: 'pointer',
  letterSpacing: '0.01em',
  borderRadius: 6,
  transition: 'color 0.15s var(--ease-out-quart), background 0.15s var(--ease-out-quart)',
};

// Matches the InputBar send button language: white pill, dark text,
// soft drop shadow. The strongest CTA shape in UnClaw is "white round
// thing on glass chrome" — we re-use that here so Continue/Finish read
// as siblings of the send button rather than a one-off red badge.
const footerPrimaryStyle = (enabled: boolean): React.CSSProperties => ({
  background: '#ffffff',
  color: 'rgba(20, 20, 20, 0.88)',
  border: 'none',
  borderRadius: 10,
  fontSize: 13,
  fontFamily: 'inherit',
  fontWeight: 500,
  padding: '8px 14px',
  cursor: enabled ? 'pointer' : 'default',
  letterSpacing: '0.005em',
  opacity: enabled ? 1 : 0.4,
  boxShadow: enabled ? '0 2px 8px rgba(0, 0, 0, 0.20)' : 'none',
  transition: [
    'opacity 0.15s var(--ease-out-quart)',
    'box-shadow 0.18s var(--ease-out-quart)',
    'transform 0.12s var(--ease-out-quart)',
  ].join(', '),
});
