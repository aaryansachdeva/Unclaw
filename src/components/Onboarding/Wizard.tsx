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
import { Volume2, VolumeX } from 'lucide-react';

import { type IdentityValues } from './IdentityStep';
import { VibeStep } from './VibeStep';
import { type InterestsValues } from './InterestsStep';
import { GettingToKnowYou } from './GettingToKnowYou';
import { WelcomeStep } from './WelcomeStep';
import { BrandLogo } from './BrandLogo';
import { ClawsStep } from './ClawsStep';
import { ConnectionsStep } from './ConnectionsStep';
import { AuthPanel } from '../Auth/AuthPanel';
import type { AuthSession, AuthUser } from '../../services/auth';
import type { VibeValues } from './VibeStep';
import {
  DEFAULT_VIBE,
  firstName,
  type UserSettings,
  type UserSchedule,
} from '../../services/userSettings';
import {
  fetchApiKeys,
  saveApiKeys,
  missingRequiredKeyFields,
  DEFAULT_API_KEYS,
  type ApiKeysProfile,
} from '../../services/apiKeys';
import {
  playPreGenAudio, speakLiveLine, PRE_GEN_LINES,
  type PreGenLine, type OnboardingLine,
} from '../../services/onboardingAudio';
import type { SoulChatResult } from '../../services/soulChat';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface WizardProps {
  /** True on first launch (no profile yet). False when reopened to edit. */
  firstRun: boolean;
  /** True once UE reports the character is spawned + on-screen. The first-run
   *  welcome voice line waits on this so it doesn't play into the black /
   *  transitioning stage before Grace exists. */
  characterReady?: boolean;
  /** Pre-fill values when reopening to edit. */
  initial?: UserSettings | null;
  /** Active persona's prompt — passed to /onboarding/greet so the
   *  personalization picks up the agent's voice. */
  personaPrompt?: string;
  /** Persist the profile. Parent owns the dual-write strategy (soul +
   *  cloud); the wizard just hands a finished payload over. */
  onSave: (profile: UserSettings) => Promise<UserSettings>;
  /** Called after a successful save. Wizard stays mounted briefly so the
   *  fade-out can play; parent removes it from the tree afterwards. */
  onComplete: (profile: UserSettings) => void;
  /** Called when a chat-shape result is ready to play (welcome line
   *  on mount, aha greeting on save). Parent feeds it to the existing
   *  dispatchChatResult path. */
  onChatResult: (result: SoulChatResult) => void;
  /** User-driven close (Esc on last step / X). Only allowed when
   *  firstRun is false — first-run cannot be closed without saving. */
  onCancel?: () => void;
  /** Streams the user's typed name out as they edit the Identity
   *  step. App.tsx feeds this to the on-screen Greeting so "good
   *  evening, friend" turns into "good evening, Aryan" live as the
   *  user types — they see their name take effect before they even
   *  hit Continue. Empty string while the field is blank. */
  onIdentityNameChange?: (name: string) => void;
  /** Whether the user is signed in. Drives the auth step: while false on
   *  first-run, the wizard shows the welcome + login steps; signing in
   *  auto-advances past auth. */
  hasSession?: boolean;
  /** The signed-in user (once available). Its name pre-seeds Identity so we
   *  don't ask for the name twice. */
  authUser?: AuthUser | null;
  /** Completes a sign-in from the auth step (App sets token + user). */
  onSignedIn?: (session: AuthSession) => void;
}

type StepKey = 'welcome' | 'auth' | 'claws' | 'identity' | 'vibe' | 'llm' | 'voice';
// First-run for a NOT-yet-signed-in user (reordered 2026-08-27): the wizard
// leads with the PERSON, not the account. Pocket runs locally with no key
// and its weights ship with the install, so nothing early needs auth: name
// and profile come first, then setup, then login, and Claws lands AFTER
// the account exists (the balance it describes is real by then). Finish
// lives on the Claws step.
const FIRST_RUN_STEPS: StepKey[] = ['welcome', 'identity', 'vibe', 'llm', 'voice', 'auth', 'claws'];
// First-run when ALREADY signed in (e.g. fresh device, profile not synced):
// same person-first order, minus welcome + auth; Claws intro still shown.
const FIRST_RUN_STEPS_AUTHED: StepKey[] = ['identity', 'vibe', 'llm', 'voice', 'claws'];
const EDIT_STEPS: StepKey[] = ['identity', 'vibe', 'llm', 'voice'];

/** localStorage key for the onboarding-mute preference. Persisted so a
 *  user who finished onboarding with audio off doesn't have to mute
 *  again if they re-open the wizard via the profile edit flow. */
const MUTED_STORAGE_KEY = 'unclaw.onboardingMuted';

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function Wizard({
  firstRun,
  characterReady = false,
  initial,
  // `personaPrompt` is still part of the public prop shape (App.tsx
  // passes it) but unused now that the LLM-driven /onboarding/greet
  // is replaced by a pre-gen "excited to start" audio clip. Left in
  // place so the App-side call site doesn't need an unrelated edit;
  // we'll prune the prop when the personalized greet flow returns.
  personaPrompt: _personaPrompt,
  onSave,
  onComplete,
  onChatResult,
  onCancel,
  onIdentityNameChange,
  hasSession = false,
  authUser,
  onSignedIn,
}: WizardProps) {
  const reduce = useReducedMotion() ?? false;

  // Whether the user was already signed in when the wizard mounted. If so on
  // first-run (e.g. a fresh device whose profile hasn't synced), skip the
  // welcome + login steps and go straight to profile setup. Captured once.
  const signedInAtMountRef = useRef(hasSession);
  const stepOrder = firstRun
    ? (signedInAtMountRef.current ? FIRST_RUN_STEPS_AUTHED : FIRST_RUN_STEPS)
    : EDIT_STEPS;
  const [step, setStep] = useState<StepKey>(stepOrder[0]);

  const [identity, setIdentity] = useState<IdentityValues>(() => ({
    // Seed the name from an existing profile, else from the signed-in user
    // (Google/Discord profile or the email sign-up's name) so we never ask
    // for it twice.
    name:     initial?.name ?? firstName(authUser?.name) ?? '',
    pronouns: initial?.pronouns ?? '',
    city:     initial?.city ?? '',
    timezone: initial?.timezone ?? detectTimezone(),
  }));
  // True when the name came from auth (not typed) — IdentityStep hides the
  // name field in that case so we don't ask again.
  const nameFromAuth = !initial?.name && !!authUser?.name;
  // When the user signs in DURING the wizard (auth step), the identity
  // initializer has already run with an empty name — seed it now from the
  // freshly-available account name (unless they've already typed one).
  useEffect(() => {
    const n = firstName(authUser?.name);
    if (n) setIdentity((prev) => (prev.name.trim() ? prev : { ...prev, name: n }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.name]);

  const [vibe, setVibe] = useState<VibeValues>(() => ({
    formality:  initial?.vibe_formality  ?? DEFAULT_VIBE.vibe_formality,
    humor:      initial?.vibe_humor      ?? DEFAULT_VIBE.vibe_humor,
    directness: initial?.vibe_directness ?? DEFAULT_VIBE.vibe_directness,
    verbosity:  initial?.vibe_verbosity  ?? DEFAULT_VIBE.vibe_verbosity,
    agent_name: initial?.agent_name ?? '',
  }));

  const [interests, setInterests] = useState<InterestsValues>(() => ({
    interests: initial?.interests ?? [],
    work:      initial?.work ?? '',
    schedule:  (initial?.schedule as UserSchedule | undefined) ?? '',
    notes:     initial?.notes ?? '',
  }));

  // BYOK profile — loaded from safeStorage once on mount. Independent of
  // the user profile (lives in its own encrypted blob), so we don't
  // serialize the keys through onSave; we persist them ourselves on
  // Finish.
  const [apiKeys, setApiKeys] = useState<ApiKeysProfile>({ ...DEFAULT_API_KEYS });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await fetchApiKeys();
      // First-run drafts start on Pocket regardless of what a leftover
      // apiKeys.bin says: the default engine should be what a fresh user
      // actually sees on the voice page (a stale dev/reinstall blob was
      // surfacing Supertonic there). The user's pick on the page is what
      // gets saved; profile edits (non-first-run) keep the saved choice.
      if (firstRun) loaded.tts_provider = 'pocket';
      if (!cancelled) setApiKeys(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // True when the user has pressed Check Keys and BOTH the LLM provider
  // and ElevenLabs probes came back ok. Cleared the moment any key
  // field changes (ConnectionsStep handles that side via its own
  // useEffect — it calls our setter with `false`). Gates the Finish
  // button so the user can't ship a typo and discover it on first chat.
  // Verification is now per-page. The user verifies LLM + agentic
  // on the LLM page, voice on the voice page. Both must be true for
  // Finish to unlock. Splitting them lets each page hold its own
  // green check independently — editing the voice provider doesn't
  // invalidate the LLM verify (and vice versa).
  const [llmValidated, setLlmValidated] = useState(false);
  const [voiceValidated, setVoiceValidated] = useState(false);
  const keysValidated = llmValidated && voiceValidated;

  // Mute switch — when on, the wizard suppresses every Grace audio
  // beat (the welcome line on mount, the per-step pre-gens, the
  // finish celebration). The MetaHuman just stays quiet for the
  // whole onboarding. Persisted across re-opens so a user who turned
  // it off once doesn't keep getting startled. We also reset the
  // ref-guard on the welcome line below so toggling mute mid-mount
  // doesn't accidentally fire the line on a later effect tick.
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const toggleMuted = () => {
    setMuted((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(MUTED_STORAGE_KEY, '1');
        else localStorage.removeItem(MUTED_STORAGE_KEY);
      } catch {
        // Quota / private browsing — preference becomes session-only.
      }
      return next;
    });
  };

  // Stream the live name up to App.tsx so the on-screen Greeting can
  // re-render as the user types. The wizard panel sits over the
  // workspace where the Greeting is mounted; this lets the user see
  // their name take effect ("good evening, Aryan") before they even
  // hit Continue, which makes the field feel like it actually does
  // something rather than just collecting text into a future profile.
  useEffect(() => {
    onIdentityNameChange?.(identity.name);
    // We deliberately don't include onIdentityNameChange in the deps
    // array — App.tsx passes a stable setter (useState's setter is
    // referentially stable), so this effect only fires on real name
    // changes. Listing it would be correct in lint terms but cause
    // every parent re-render to refire the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.name]);

  // True while the Wizard is mounted; flipped false in the unmount
  // effect below. The async closures inside playLine check this
  // BEFORE handing the result to onChatResult — without the check,
  // a fetch in flight when the user closes the wizard (advances past
  // Finish, hits Cancel, App-level state forces unmount) would still
  // dispatch the audio through UE after the wizard is gone, so the
  // user would hear an onboarding line in a non-onboarding context.
  const wizardMountedRef = useRef(true);
  useEffect(() => {
    wizardMountedRef.current = true;
    return () => {
      wizardMountedRef.current = false;
    };
  }, []);

  // Best-effort dispatch of a pre-generated onboarding audio clip
  // through soul + UE. Failures (soul offline, asset missing) are
  // swallowed — they shouldn't block the user advancing through the
  // wizard. Each clip is a one-time ElevenLabs synth shipped as a
  // static asset, so the wizard's fixed beats (name confirmation,
  // failed key check, finish celebration) cost zero per-call ElevenLabs
  // credit at runtime.
  //
  // Mute short-circuits at the top — we don't even POST the audio to
  // soul, so the lipsync + T2F passes are skipped entirely. The
  // MetaHuman's last pushed face frame just keeps showing.
  //
  // Mount-state guard around onChatResult ensures we don't play
  // onboarding audio outside the wizard if the user closes it while
  // a request is in flight.
  // Live-first (2026-08-27): each beat is synthesized on the spot with the
  // local Pocket engine (keyless, ships with the install), which lets the
  // lines carry the user's actual name. The pre-gen MP3s remain the
  // fallback when live synthesis fails, so the wizard never goes silent
  // on a soul hiccup.
  const playLine = (line: OnboardingLine, text?: string) => {
    if (mutedRef.current) return;
    void (async () => {
      let result;
      try {
        result = text
          ? await speakLiveLine(line, text)
          : await playPreGenAudio(line as PreGenLine);
      } catch (err) {
        // Only the original four beats have a shipped MP3 to fall back
        // to; live-only lines (the agent-name acknowledgement) just stay
        // silent on failure.
        if (!PRE_GEN_LINES.has(line)) {
          console.warn(`[onboarding] live "${line}" failed (no fallback)`, err);
          return;
        }
        console.warn(`[onboarding] live "${line}" failed, falling back to pre-gen`, err);
        try {
          result = await playPreGenAudio(line as PreGenLine);
        } catch (err2) {
          console.warn(`[onboarding] pre-gen "${line}" failed`, err2);
          return;
        }
      }
      if (!wizardMountedRef.current) {
        console.debug(`[onboarding] line "${line}" arrived after `
                      + 'wizard unmounted — dropping');
        return;
      }
      onChatResult(result);
    })();
  };

  // Ref so effects defined above handleFinish can call it without
  // re-ordering the component.
  const handleFinishRef = useRef<(() => Promise<void>) | null>(null);
  const agentNameAckRef = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIdx = stepOrder.indexOf(step);
  const isLastStep = stepIdx === stepOrder.length - 1;
  // Connections is now a hard gate, not a polite suggestion: soul
  // refuses to fall back to env keys for the chat path, so the wizard
  // can't finish until the user has supplied an LLM provider + key
  // (or picked Ollama) AND an ElevenLabs key AND pressed Check Keys
  // to verify both probe successfully against the live provider APIs.
  // The list of missing fields drives the inline panel in
  // ConnectionsStep too.
  const missingKeyFields = missingRequiredKeyFields(apiKeys);
  const hasName = identity.name.trim().length > 0;
  const canFinish = hasName
    && missingKeyFields.length === 0
    && keysValidated;
  // Welcome step has no validation gate; identity needs a name; the
  // rest are always advance-able EXCEPT connections (the last step),
  // where Continue/Finish is blocked until the keys are filled in.
  // LLM page advances unconditionally; the voice page (the LAST step)
  // is the one that gates Continue/Finish on verification — that's
  // where the verify panel lives.
  const canAdvance = step === 'welcome'
    ? true
    : step === 'auth'
    ? hasSession            // can't leave the login step until signed in
    : step === 'identity'
    ? hasName
    : step === 'voice'
    ? canFinish
    : true;

  // Auth sits at the END of the flow now. Signing in mid-list (should the
  // order ever change back) still auto-advances; signing in on the LAST
  // step presses Finish for the user, once, so login lands as the final
  // seamless beat instead of "now press Finish". handleFinish still owns
  // the gates (name, keys, verify) and routes back if something is missing.
  const autoFinishedRef = useRef(false);
  useEffect(() => {
    if (step !== 'auth' || !hasSession) return;
    const idx = stepOrder.indexOf('auth');
    if (idx >= 0 && idx < stepOrder.length - 1) {
      setStep(stepOrder[idx + 1]);
      return;
    }
    if (!autoFinishedRef.current) {
      autoFinishedRef.current = true;
      void handleFinishRef.current?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hasSession]);

  // Welcome line plays EXACTLY ONCE per wizard mount, on first-run.
  // Live Pocket synthesis (2026-08-27): the engine is keyless and its
  // weights ship with the install, so a live line works before any BYOK
  // exists; the pre-gen MP3 remains the fallback inside playLine. The
  // ref guard makes it unconditional-once even if React re-runs the
  // effect.
  const welcomeFiredRef = useRef(false);
  useEffect(() => {
    if (!firstRun) return;
    // Wait for UE to report the character is actually on-screen. The stream now
    // boots black and transitions into Grace; firing the welcome audio before
    // that means the pre-recorded line plays into an empty/transitioning stage.
    if (!characterReady) return;
    if (welcomeFiredRef.current) return;
    welcomeFiredRef.current = true;
    if (mutedRef.current) return;
    playLine('welcome', "Welcome to Unclaw. I'm Grace. Let's get you set up.");
    // playLine is defined per-render and is intentionally omitted —
    // the ref guard guarantees fire-once regardless of identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRun, characterReady]);

  const handleAdvance = () => {
    // Per-step gate. Identity needs a name to move forward; Connections
    // (the last step) needs valid keys before it can Finish; the rest
    // are always advance-able. `canAdvance` already encodes this — use
    // it directly so adding a future step doesn't reintroduce the bug
    // where Identity used the wrong (full-finish) check and locked out
    // Continue before the user could even reach Connections.
    if (!canAdvance) return;
    if (isLastStep) {
      void handleFinish();
      return;
    }
    // First time the user moves past Identity is the natural moment
    // for Grace to acknowledge the introduction. Fires once per
    // session — the next time the user hits Continue (out of Vibe
    // etc.) it doesn't replay because we only check `step` here.
    if (step === 'identity') {
      const n = identity.name.trim();
      playLine('nice-to-meet-you',
        n ? `Nice to meet you, ${n}!` : 'Nice to meet you!');
    }
    // Naming the agent gets acknowledged in HER OWN new name: the moment
    // the name becomes real. Skipped when left as the Grace default, and
    // fires once per wizard session.
    if (step === 'vibe') {
      const agentName = vibe.agent_name.trim();
      if (agentName && agentName.toLowerCase() !== 'grace' && !agentNameAckRef.current) {
        agentNameAckRef.current = true;
        playLine('name-liked',
          `${agentName}? Oh, I like that. That's me now. `
          + 'And if you ever want to adjust me, or any of your agents, '
          + 'the agents section has it all.');
      }
    }
    setStep(stepOrder[stepIdx + 1]);
  };

  const handleBack = () => {
    if (stepIdx > 0) setStep(stepOrder[stepIdx - 1]);
  };

  const handleSkip = () => {
    // On welcome there's nothing to skip — Continue is the action. Auth can't
    // be skipped — login is required.
    if (step === 'welcome' || step === 'auth') return;
    if (step === 'identity') {
      // "Skip the rest" jumps straight to Finish — but the user still
      // can't actually finish without keys, so handleFinish will route
      // them to Connections if anything's missing. Just need a name to
      // even attempt the shortcut.
      if (hasName) void handleFinish();
      return;
    }
    if (isLastStep) void handleFinish();
    else setStep(stepOrder[stepIdx + 1]);
  };

  // Save the profile + whatever BYOK keys are present, then complete. Shared by
  // the gated Finish and the "Skip for now" path (which bypasses the key gate).
  const finishOnboarding = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const profile: UserSettings = {
        name:            identity.name.trim(),
        pronouns:        identity.pronouns.trim() || null,
        city:            identity.city.trim() || null,
        timezone:        identity.timezone.trim() || null,
        agent_name:      vibe.agent_name.trim() || null,
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
      // Persist BYOK fields locally (best-effort, independent of the
      // profile save). Failure here doesn't block onboarding — soul
      // continues to use its own .env keys.
      try {
        await saveApiKeys(apiKeys);
      } catch (keyErr) {
        console.warn('[onboarding] api-key save failed', keyErr);
      }
      // Tear down the wizard immediately, then dispatch the "excited
      // to start" pre-gen line so the MetaHuman speaks while the user
      // is settling into the chat workspace. This replaces the older
      // /onboarding/greet path which round-tripped the LLM + ElevenLabs
      // on every save — for shipping we ship a static MP3 instead.
      // Personalized greeting can come back later via a /chat call
      // once the keys are confirmed working.
      onComplete(saved);
      const n = identity.name.trim();
      playLine('excited-to-start',
        n ? `We're all set, ${n}. I'm so excited to start!`
          : "We're all set. I'm so excited to start!");
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleFinish = async () => {
    if (!hasName) {
      setStep('identity');
      setError('Please enter your name.');
      return;
    }
    // Auth moved to the END of the flow (2026-08-27), so Finish can now be
    // reached by shortcuts (identity skip, Cmd+Enter) before the user has
    // ever seen the login step. First-run still requires an account.
    if (!hasSession && stepOrder.includes('auth')) {
      setStep('auth');
      setError('Last step: sign in to finish.');
      return;
    }
    // The user explicitly skipped key setup on the LLM/voice pages;
    // don't re-impose the key gate here.
    if (skipKeysRef.current) {
      await finishOnboarding();
      return;
    }
    if (missingKeyFields.length > 0) {
      // Route the user back to whichever step holds the missing field
      // so they can fix it. LLM-related fields (provider, model, key,
      // agentic) live on the LLM page; everything else (voice provider
      // or its install state) lives on the voice page.
      const targetStep: StepKey = missingKeyFields.some((f) =>
        f === 'LLM provider' || f === 'Model'
        || f.endsWith('API key') && f !== 'ElevenLabs API key'
        || f === 'Agentic model' || f === 'OpenAI key for agentic',
      ) ? 'llm' : 'voice';
      setStep(targetStep);
      setError(`Please add: ${missingKeyFields.join(', ')}`);
      return;
    }
    if (!keysValidated) {
      // Fields are filled but the user hasn't pressed Verify (or
      // they edited a key after a prior successful check). The voice
      // page is the last one and hosts the verify panel.
      setStep('voice');
      setError('Press Verify before finishing.');
      return;
    }
    await finishOnboarding();
  };
  handleFinishRef.current = handleFinish;

  // "Skip for now" on the LLM / voice steps: finish onboarding WITHOUT the key
  // gate. Whatever keys the user did enter are still saved; the rest they set up
  // later in Settings (the apiKeysNotice nudges them). Name is still required.
  const skipKeysRef = useRef(false);
  const handleSkipSetup = () => {
    if (!hasName) {
      setStep('identity');
      setError('Please enter your name.');
      return;
    }
    // Keys are skippable; the rest of the flow (sign-in, Claws intro) is
    // not. Remember the skip so handleFinish doesn't re-impose the key
    // gate, and continue forward instead of finishing on the spot: to
    // login first if it's still owed, else straight to Claws.
    skipKeysRef.current = true;
    const next = !hasSession && stepOrder.indexOf('auth') >= 0 ? 'auth'
      : stepOrder.indexOf('claws') >= 0 ? 'claws' : null;
    if (next) setStep(next as StepKey);
    else void finishOnboarding();
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
    if (step === 'claws') return <ClawsStep />;
    if (step === 'auth') {
      return (
        // Two-column sign-in: brand mark on the left, the auth form on
        // the right — same visual language as the welcome ("Get started")
        // step so the two surfaces read as one continuous moment.
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 44,
            padding: '14px 0 10px',
          }}
        >
          <BrandLogo size={168} />
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                Create your account
              </h2>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                Sign in to save your setup and sync it across devices.
              </p>
            </div>
            <AuthPanel onSignedIn={(s) => onSignedIn?.(s)} />
          </div>
        </div>
      );
    }
    if (step === 'identity') {
      return (
        <GettingToKnowYou
          identity={identity}
          onIdentityChange={setIdentity}
          interests={interests}
          onInterestsChange={setInterests}
          onAdvance={handleAdvance}
          hideName={nameFromAuth}
        />
      );
    }
    if (step === 'vibe') {
      return <VibeStep values={vibe} onChange={setVibe} />;
    }
    // Both LLM + Voice pages reuse ConnectionsStep with a `mode`
    // prop. The component itself owns layout; the mode just toggles
    // which sections render. Verify panel is on `voice` only — that's
    // where Finish is gated, and the panel checks LLM + TTS together.
    if (step === 'llm') {
      return (
        <ConnectionsStep
          mode="llm"
          values={apiKeys}
          onChange={setApiKeys}
          validated={llmValidated}
          onValidatedChange={setLlmValidated}
          onCheckFailed={() => playLine('keys-wrong',
            "Hmm, those keys don't look right. Let's take another look.")}
          agentName={vibe.agent_name}
        />
      );
    }
    return (
      <ConnectionsStep
        mode="voice"
        values={apiKeys}
        onChange={setApiKeys}
        validated={voiceValidated}
        onValidatedChange={setVoiceValidated}
        onCheckFailed={() => playLine('keys-wrong',
          "Hmm, those keys don't look right. Let's take another look.")}
        agentName={vibe.agent_name}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, identity, vibe, interests, apiKeys, llmValidated, voiceValidated]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding"
      onKeyDown={onWizardKey}
      tabIndex={-1}
      // `layout` tracks the panel's intrinsic size (driven by the
      // currently-mounted step) and animates between values. The
      // bottom-anchored absolute positioning means height changes
      // grow upward — looks like the panel is breathing in/out as
      // taller/shorter steps land. `layoutTransition` would be the
      // right knob to override the spring per-axis if the default
      // ever feels wrong here.
      layout
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
          position: 'relative',
          zIndex: 1,
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Body — animated step content. Scrolls internally when the
            step's content exceeds the panel height (Connections step
            grew past the visible area once the agentic CLI section
            landed with its keyless status card + live model dropdown).
            The bottom action bar stays pinned outside this scroll
            region so Verify / Continue are always reachable. */}
        <div
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            padding: '20px 22px 14px',
          }}
        >
          {/* `popLayout` mode lets the new step mount BEFORE the old
              one finishes exiting (the exiting child gets absolutely
              positioned so it doesn't push the new one around). With
              `layout` on the panel above, the panel's height tracks
              the new step's natural size immediately instead of
              briefly collapsing while the old child unmounts in
              `mode="wait"`. The result: a smooth grow/shrink between
              step heights instead of the snap-then-pop effect. */}
          <AnimatePresence mode="popLayout" initial={false}>
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

        {/* Blocked-finish hint. Verification is passive now (no Verify
            button), so when Finish is disabled the user needs to know what
            the app is still waiting on. One quiet line, only on the final
            step, only while blocked. */}
        {isLastStep && !canFinish && (
          <div
            role="status"
            style={{
              flexShrink: 0,
              padding: '6px 18px 0',
              fontSize: 11,
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
            }}
          >
            {!hasName
              ? 'Waiting on: your name (back on the first step).'
              : missingKeyFields.length > 0
                ? `Waiting on: ${missingKeyFields.join(' · ')}.`
                : !llmValidated
                  ? 'Waiting on: the chat connection to check out (previous step).'
                  : 'Waiting on: the voice connection to check out above.'}
          </div>
        )}

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
          {/* Mute toggle — leftmost, present on every step (including
              the welcome screen, where the user might want to silence
              the welcome line itself before it lands). When muted, the
              wizard skips every Grace audio beat and the MetaHuman just
              stays on its last face frame for the duration. State is
              persisted to localStorage so a user who silenced one
              session doesn't get re-startled on next open. */}
          <button
            type="button"
            onClick={toggleMuted}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute onboarding' : 'Mute onboarding'}
            title={muted ? 'Unmute' : 'Mute'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              flexShrink: 0,
              borderRadius: 8,
              background: muted
                ? 'rgba(196, 68, 68, 0.10)'
                : 'transparent',
              border: muted
                ? '1px solid var(--accent-strong)'
                : '1px solid var(--glass-border)',
              color: muted ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition:
                'background 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              if (muted) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              if (muted) return;
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            {muted
              ? <VolumeX size={14} strokeWidth={2} />
              : <Volume2 size={14} strokeWidth={2} />}
          </button>

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

          {/* Skip setup — on the BYOK steps (LLM / voice), let the user finish
              without keys and configure later in Settings. Quiet secondary link
              sitting just left of the primary action. */}
          {(step === 'llm' || step === 'voice') && (
            <button
              type="button"
              onClick={handleSkipSetup}
              disabled={submitting}
              style={{ ...footerLinkStyle, flexShrink: 0 }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              Skip for now
            </button>
          )}

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
