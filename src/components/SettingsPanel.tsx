// Settings, a character sheet, not a settings panel.
//
// Reshape from iPad two-pane (sidebar + form rows) into a single-surface
// composition with five facets at the top: MIND, VOICE, WILL, PRESENCE,
// ABOUT. Each facet is one composed beat (not a label/control grid).
// The point of this surface is to tune a 3D presence; the metaphor is
// a character sheet, not a database admin form.
//
// All state plumbing preserved: draft, validation, live model fetch,
// graphics restart prompt, BYOK key flow, Esc/click-outside, save bar
// only-when-dirty. Public props unchanged.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, AlertCircle, Loader2, Eye, EyeOff, ExternalLink, X,
  Search,
} from 'lucide-react';
import {
  CliProviderStatusCard,
  KEYLESS_CLI_PROVIDERS,
} from './CliProviderStatusCard';
import {
  DEFAULT_API_KEYS,
  LLM_PROVIDERS,
  fetchApiKeys,
  filterChatModels,
  getProvider,
  saveApiKeys,
  validateKeys,
  type ApiKeysProfile,
  type GraphicsQuality,
  type KeyValidationOutcome,
  type KeyValidationResult,
  type LLMProviderId,
  type TtsProviderId,
} from '../services/apiKeys';
import { Dropdown } from './Onboarding/Dropdown';
import { Slider } from './Onboarding/Slider';
import { TZ_CATALOG } from './Onboarding/IdentityStep';
import {
  fetchSettings,
  saveSettings,
  DEFAULT_VIBE,
  vibeWord,
  type UserSettings,
  type UserSchedule,
} from '../services/userSettings';
import logoUrl from '../assets/logo_lg.png';
import fotonLabsUrl from '../assets/fotonlabs.png';
import instagramUrl from '../assets/social-instagram.svg';
import tiktokUrl from '../assets/social-tiktok.svg';
import discordUrl from '../assets/social-discord.svg';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (next: ApiKeysProfile) => void;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'saving' }
  | { kind: 'saved'; graphicsChanged: boolean }
  | { kind: 'error'; message: string };

type FacetId = 'profile' | 'chat' | 'voice' | 'agentic' | 'graphics' | 'about';

// Fields that invalidate the cached /validate_keys result when changed.
//
// Model picks are NOT in this set: changing the chat or agentic model
// doesn't change auth state, so the CliProviderStatusCard (which reads
// from `validation`) should keep showing "ready" instead of flipping
// back to "probing" when the user just opens a model dropdown.
//
// Provider switches ARE in this set (for agentic at least), because
// the cached outcome is provider-specific. Without invalidating on
// agentic_provider change, switching from claude-code (validated
// ready) to codex leaves the stale claude-code outcome sitting in
// `validation.agentic`, the auto-probe's `validation?.agentic?.ok`
// short-circuit fires, codex never gets probed, and its model list
// stays empty. Same shape applies to chat-side llm_provider, except
// that one goes through `setProvider()` which calls `setValidation`
// directly so it doesn't need to be here.
const VALIDATION_INVALIDATING_FIELDS = new Set<keyof ApiKeysProfile>([
  'llm_api_key', 'agentic_api_key',
  'agentic_provider',
  'elevenlabs_api_key', 'tts_provider',
  'gemini_search_api_key',
  'kokoro_endpoint',
]);

interface FacetMeta {
  id: FacetId;
  label: string;
  Glyph: (props: { size?: number; active?: boolean }) => JSX.Element;
}

const FACETS: FacetMeta[] = [
  { id: 'profile',  label: 'Profile',  Glyph: GlyphProfile },
  { id: 'chat',     label: 'Chat',     Glyph: GlyphMind },
  { id: 'voice',    label: 'Voice',    Glyph: GlyphVoice },
  { id: 'agentic',  label: 'Agentic',  Glyph: GlyphWill },
  { id: 'graphics', label: 'Graphics', Glyph: GlyphPresence },
  { id: 'about',    label: 'About',    Glyph: GlyphAbout },
];

interface PaneContext {
  draft: ApiKeysProfile;
  update: <K extends keyof ApiKeysProfile>(key: K, value: ApiKeysProfile[K]) => void;
  setProvider: (next: LLMProviderId | null) => void;
  liveModelsByProvider: Partial<Record<LLMProviderId, string[]>>;
  isProbingKey: boolean;
  graphicsChanged: boolean;
  /** Latest /validate_keys outcome, surfaced to facets that need to
   *  render keyless status (Claude Code subscription install + auth). */
  validation: KeyValidationResult | null;
  /** User identity + vibe + interests, loaded from /user_settings. Null
   *  while still loading. The Profile facet edits this; other facets
   *  may read it (e.g. agentName for hover labels). */
  profile: UserSettings | null;
  updateProfile: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

// =============================================================================
// Root
// =============================================================================

export function SettingsPanel({ open, onClose, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState<ApiKeysProfile>(DEFAULT_API_KEYS);
  const [original, setOriginal] = useState<ApiKeysProfile>(DEFAULT_API_KEYS);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [validation, setValidation] = useState<KeyValidationResult | null>(null);
  const [active, setActive] = useState<FacetId>('chat');
  const [liveModelsByProvider, setLiveModelsByProvider] = useState<
    Partial<Record<LLMProviderId, string[]>>
  >({});
  const [isProbingKey, setIsProbingKey] = useState(false);
  // User-settings draft (Profile facet). Loaded in parallel with apiKeys
  // on open; null while loading and if soul has no row yet. Save flow
  // is shared with apiKeys via the bottom action bar.
  const [profileDraft, setProfileDraft] = useState<UserSettings | null>(null);
  const [profileOriginal, setProfileOriginal] = useState<UserSettings | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaveState({ kind: 'idle' });
    setValidation(null);
    setLiveModelsByProvider({});
    setActive('profile');
    void Promise.all([
      fetchApiKeys(),
      fetchSettings().catch(() => null),
    ]).then(([keys, profile]) => {
      setDraft(keys);
      setOriginal(keys);
      setProfileDraft(profile);
      setProfileOriginal(profile);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const keysDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(original),
    [draft, original],
  );
  const profileDirty = useMemo(
    () => JSON.stringify(profileDraft) !== JSON.stringify(profileOriginal),
    [profileDraft, profileOriginal],
  );
  const dirty = keysDirty || profileDirty;
  const graphicsChanged = draft.graphics_quality !== original.graphics_quality;

  const update = useCallback(<K extends keyof ApiKeysProfile>(
    key: K, value: ApiKeysProfile[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (VALIDATION_INVALIDATING_FIELDS.has(key)) {
      setValidation(null);
    }
    if (saveState.kind === 'saved' || saveState.kind === 'error') {
      setSaveState({ kind: 'idle' });
    }
  }, [saveState]);

  const updateProfile = useCallback(<K extends keyof UserSettings>(
    key: K, value: UserSettings[K],
  ) => {
    setProfileDraft((prev) => {
      const base = prev ?? ({ name: '' } as UserSettings);
      return { ...base, [key]: value };
    });
    if (saveState.kind === 'saved' || saveState.kind === 'error') {
      setSaveState({ kind: 'idle' });
    }
  }, [saveState]);

  const setProvider = useCallback((next: LLMProviderId | null) => {
    setDraft((prev) => ({
      ...prev,
      llm_provider: next,
      llm_model: null,
      llm_api_key: null,
    }));
    setValidation(null);
    setSaveState({ kind: 'idle' });
  }, []);

  useEffect(() => {
    if (!open || loading) return;
    const provider = draft.llm_provider;
    if (!provider || provider === 'ollama') return;
    // Claude Code is keyless, probe on provider selection alone.
    // Every other provider needs a key in hand first.
    const key = (draft.llm_api_key || '').trim();
    if (!KEYLESS_CLI_PROVIDERS.has(provider) && !key) return;
    // Cache hit: don't re-probe, but DO synthesize a validation outcome
    // so keyless cards (Claude Code) don't sit at "probing" forever
    // when the user toggles back to a provider we've already verified.
    const cached = liveModelsByProvider[provider];
    if (cached?.length) {
      setValidation((prev) => ({
        ...(prev ?? { ok: false } as any),
        llm: { ok: true, models: cached },
      } as any));
      return;
    }
    const t = setTimeout(() => {
      setIsProbingKey(true);
      void validateKeys(draft)
        .then((res) => {
          if (res.llm.ok && res.llm.models && res.llm.models.length) {
            setLiveModelsByProvider((prev) => ({
              ...prev,
              [provider]: res.llm.models,
            }));
          }
          // For keyless providers, retain the outcome so the auth-status
          // card below the provider picker can render install/setup-token
          // guidance even when models came back empty.
          setValidation((prev) => ({
            ...(prev ?? { ok: false } as any),
            llm: res.llm,
          } as any));
        })
        .catch(() => { /* surfaced on save */ })
        .finally(() => setIsProbingKey(false));
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, draft.llm_provider, draft.llm_api_key]);

  // Mirror of the chat-side auto-probe, for the AGENTIC provider slot.
  // Claude Code is keyless on both sides, without this, picking it as
  // the agentic backend leaves the status card stuck at "probing"
  // because nothing ever fires validateKeys for it.
  useEffect(() => {
    if (!open || loading) return;
    if (!draft.agentic_enabled) return;
    const aprov = draft.agentic_provider;
    if (!aprov || aprov === 'ollama') return;
    const akey = (draft.agentic_api_key || '').trim();
    if (!KEYLESS_CLI_PROVIDERS.has(aprov) && !akey) return;
    // Already have a healthy result for this provider, don't re-probe.
    if (validation?.agentic?.ok) return;
    const t = setTimeout(() => {
      setIsProbingKey(true);
      void validateKeys(draft)
        .then((res) => {
          // Same pattern as the chat-side probe: when the agentic
          // response carries a model list (claude-code returns the
          // sonnet/opus/haiku catalog; future API providers may too),
          // stash it under the agentic provider's slot in
          // liveModelsByProvider so the agentic model dropdown
          // populates from the live source rather than a hardcoded list.
          if (aprov && res.agentic?.ok && (res.agentic as any).models?.length) {
            setLiveModelsByProvider((prev) => ({
              ...prev,
              [aprov]: (res.agentic as any).models,
            }));
          }
          setValidation((prev) => ({
            ...(prev ?? { ok: false } as any),
            ...(res.llm ? { llm: res.llm } : {}),
            ...(res.agentic ? { agentic: res.agentic } : {}),
          } as any));
        })
        .catch(() => { /* surfaced on save */ })
        .finally(() => setIsProbingKey(false));
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, draft.agentic_enabled, draft.agentic_provider, draft.agentic_api_key]);

  const handleSave = useCallback(async () => {
    // Only validate keys when keys actually changed, a profile-only
    // save (Profile facet) shouldn't pay the network round-trip nor
    // get blocked by a stale key issue from a previous session.
    if (keysDirty) {
      setSaveState({ kind: 'validating' });
      setValidation(null);
      try {
        const result = await validateKeys(draft);
        setValidation(result);
        if (!result.llm.ok || !result.tts.ok) {
          setSaveState({
            kind: 'error',
            message: result.llm.ok
              ? `Voice: ${result.tts.error ?? 'invalid'}`
              : `Chat: ${result.llm.error ?? 'invalid'}`,
          });
          return;
        }
      } catch (err) {
        setValidation(null);
        setSaveState({ kind: 'error', message: `Could not verify, ${(err as Error).message}` });
        return;
      }
    }
    setSaveState({ kind: 'saving' });
    try {
      if (keysDirty) {
        const ok = await saveApiKeys(draft);
        if (!ok) {
          setSaveState({ kind: 'error', message: 'Could not write keys to disk' });
          return;
        }
        setOriginal(draft);
        onSaved?.(draft);
      }
      if (profileDirty && profileDraft) {
        try {
          const saved = await saveSettings(profileDraft);
          setProfileOriginal(saved);
          setProfileDraft(saved);
        } catch (err) {
          setSaveState({ kind: 'error', message: `Profile save failed, ${(err as Error).message}` });
          return;
        }
      }
      setSaveState({ kind: 'saved', graphicsChanged });
    } catch (err) {
      setSaveState({ kind: 'error', message: `Save failed, ${(err as Error).message}` });
    }
  }, [draft, profileDraft, keysDirty, profileDirty, graphicsChanged, onSaved]);

  const handleDiscard = useCallback(() => {
    if (!dirty) { onClose(); return; }
    setDraft(original);
    setProfileDraft(profileOriginal);
    setSaveState({ kind: 'idle' });
    setValidation(null);
    onClose();
  }, [dirty, original, profileOriginal, onClose]);

  const ctx: PaneContext = {
    draft, update, setProvider, liveModelsByProvider, isProbingKey, graphicsChanged,
    validation, profile: profileDraft, updateProfile,
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="settings-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          style={SCRIM_STYLE}
          onClick={(e) => { if (e.target === e.currentTarget) handleDiscard(); }}
        >
          <motion.div
            key="settings-shell"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.34, ease: EASE_OUT_EXPO }}
            style={SHELL_STYLE}
          >
            <span style={HAIRLINE_TOP_STYLE} aria-hidden />

            {/* Close, anchored to the corner. Floats over everything so the
                user always has an exit hatch, no matter which facet they're in. */}
            <button
              type="button"
              aria-label="Close settings"
              onClick={handleDiscard}
              style={CLOSE_BTN_STYLE}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <X size={15} strokeWidth={2} />
            </button>

            {loading ? (
              <div style={LOADING_STYLE}>
                <Loader2 size={20} className="animate-spin" />
                <div style={{ marginTop: 10, fontSize: 12, letterSpacing: '0.04em' }}>
                  Opening…
                </div>
              </div>
            ) : (
              <>
                {/* HEADER. Neutral caps label sets the room without
                    pinning the panel to any particular agent identity.
                    Agents can be configured to any gender or persona;
                    the chrome stays a chrome label. The brand-signature
                    wordmark with the wide 0.62em tracking lives in the
                    About facet, where it's brand identity rather than
                    a claim about the agent. */}
                <header style={HEADER_STYLE}>
                  <div style={{
                    fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'var(--text-ghost)',
                  }}>
                    Settings
                  </div>
                </header>

                {/* FACET PICKER. Five wide pills, custom glyph + name. The
                    active one tints with ember-dim + animated underline
                    that slides via layoutId. Replaces the iPad sidebar. */}
                <nav style={FACET_NAV_STYLE} aria-label="Settings facets">
                  {FACETS.map((facet) => {
                    const isActive = active === facet.id;
                    return (
                      <button
                        key={facet.id}
                        type="button"
                        onClick={() => setActive(facet.id)}
                        style={{
                          ...facetPillStyle(isActive),
                        }}
                        onMouseEnter={(e) => {
                          if (isActive) return;
                          e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                        onMouseLeave={(e) => {
                          if (isActive) return;
                          e.currentTarget.style.color = 'var(--text-secondary)';
                        }}
                      >
                        <facet.Glyph size={16} active={isActive} />
                        <span>{facet.label}</span>
                        {isActive && (
                          <motion.span
                            layoutId="settings-facet-underline"
                            transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                            style={{
                              position: 'absolute',
                              left: 14, right: 14, bottom: 0,
                              height: 1.5,
                              borderRadius: 1,
                              background: 'var(--accent)',
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </nav>

                {/* BODY. Cross-fades between facets with a small vertical
                    settle. Padding is generous to give each composition
                    room to be itself rather than fight for screen real
                    estate. */}
                <div style={BODY_STYLE}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={active}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                    >
                      {active === 'profile'  && <ProfileFacet  {...ctx} />}
                      {active === 'chat'     && <ChatFacet     {...ctx} />}
                      {active === 'voice'    && <VoiceFacet    {...ctx} />}
                      {active === 'agentic'  && <AgenticFacet  {...ctx} />}
                      {active === 'graphics' && <GraphicsFacet {...ctx} />}
                      {active === 'about'    && <AboutFacet    />}
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* SAVE BAR. Same slide-up-from-bottom on dirty, same
                    primary glow + status chip pattern. The chrome that
                    earns its character is the body above; this bar is
                    a quiet executor. */}
                <AnimatePresence>
                  {(dirty || saveState.kind !== 'idle') && (
                    <motion.footer
                      key="settings-actionbar"
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                      style={ACTIONBAR_STYLE}
                    >
                      <StatusChip
                        saveState={saveState}
                        validation={validation}
                        onRestart={() => {
                          window.electronAPI?.update?.restart()
                            .catch(() => { /* main quits either way */ });
                        }}
                        onDismissSaved={() => setSaveState({ kind: 'idle' })}
                      />
                      <div style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={handleDiscard}
                        style={GHOST_BTN_STYLE}
                      >
                        {dirty ? 'Discard' : 'Close'}
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={!dirty || saveState.kind === 'validating' || saveState.kind === 'saving'}
                        style={{
                          ...PRIMARY_BTN_STYLE,
                          opacity: dirty && saveState.kind !== 'validating' && saveState.kind !== 'saving' ? 1 : 0.5,
                          cursor: dirty && saveState.kind !== 'validating' && saveState.kind !== 'saving' ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {saveState.kind === 'validating' ? 'Verifying…'
                          : saveState.kind === 'saving' ? 'Saving…'
                          : 'Save'}
                      </button>
                    </motion.footer>
                  )}
                </AnimatePresence>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// CHAT, LLM provider + model + key
// =============================================================================

function ChatFacet({ draft, update, setProvider, liveModelsByProvider, isProbingKey, validation }: PaneContext) {
  const info = getProvider(draft.llm_provider);
  return (
    <Composition
      eyebrow="the model that drives chat"
      title={info ? info.label : 'Pick a chat provider.'}
      tagline={info
        ? "Every reply runs through this provider's model."
        : 'Bring your own key to any of the supported providers. The choice steers tone as much as speed.'}
    >
      <Stack>
        <FieldStack label="Provider">
          <Dropdown
            value={draft.llm_provider ?? ''}
            onChange={(v) => setProvider((v as LLMProviderId) || null)}
            options={LLM_PROVIDERS.map((p) => ({ id: p.id, label: p.label }))}
            placeholder="Choose a provider"
          />
        </FieldStack>

        {info?.requiresApiKey && (
          <FieldStack label="Key">
            <SecretInput
              value={draft.llm_api_key ?? ''}
              onChange={(v) => update('llm_api_key', v || null)}
              placeholder={`paste your ${info.label} key`}
            />
          </FieldStack>
        )}

        {info && KEYLESS_CLI_PROVIDERS.has(info.id) && (
          <CliProviderStatusCard
            provider={info.id}
            outcome={validation?.llm ?? null}
            isProbing={isProbingKey}
          />
        )}

        {info && !info.dynamicModels && (() => {
          const provider = info.id;
          const rawLive = liveModelsByProvider[provider] ?? [];
          const live = filterChatModels(provider, rawLive);
          const entries = live.map((rawId) => ({
            id: `${provider}:${rawId}`,
            label: rawId,
          }));
          // CLI-subscription providers are keyless, placeholder shouldn't
          // ask for a key. The "sign in" message is provider-specific.
          const isKeyless = KEYLESS_CLI_PROVIDERS.has(provider);
          const noKey = !isKeyless && !draft.llm_api_key?.trim();
          const signInHint = (
            provider === 'claude-code' ? 'Sign in to Claude Code first'
            : provider === 'gemini-cli' ? 'Sign in to Gemini CLI first'
            : provider === 'codex' ? 'Sign in to Codex first'
            : 'Sign in via Terminal first'
          );
          const placeholder =
            noKey ? 'Enter your key first'
            : isProbingKey ? 'Verifying…'
            : entries.length === 0 ? (
                isKeyless ? signInHint : 'No chat models returned'
              )
            : 'Choose a model';
          return (
            <FieldStack
              label="Model"
              aside={
                isProbingKey
                  ? <InlineHint><Loader2 size={10} className="animate-spin" /> verifying</InlineHint>
                  : entries.length
                    ? <InlineHint>{entries.length} live from provider</InlineHint>
                    : undefined
              }
            >
              <Dropdown
                value={draft.llm_model ?? ''}
                onChange={(id) => update('llm_model', id || null)}
                options={entries}
                placeholder={placeholder}
                disabled={entries.length === 0}
                searchable
              />
            </FieldStack>
          );
        })()}

        {info?.dynamicModels && (
          <FieldStack
            label="Model"
            aside={<InlineHint>local Ollama tag</InlineHint>}
          >
            <input
              type="text"
              placeholder="ollama:gemma3:4b-it-qat"
              value={draft.llm_model ?? ''}
              onChange={(e) => update('llm_model', e.target.value || null)}
              style={NATIVE_INPUT_STYLE}
            />
          </FieldStack>
        )}

        <GroundingSection draft={draft} update={update} />
      </Stack>
    </Composition>
  );
}

// Gemini Search key + grounding toggle, rendered at the end of the
// Chat facet. Mirrors the onboarding Connections block: hidden entirely
// when the chat provider IS Gemini (chat model grounds natively).
// Lives in Chat (not Agentic) because grounding is part of how the
// chat reply itself gets the live context, even with escalation off.
function GroundingSection({
  draft, update,
}: {
  draft: ApiKeysProfile;
  update: <K extends keyof ApiKeysProfile>(key: K, value: ApiKeysProfile[K]) => void;
}) {
  const isGeminiNativeChat = (
    draft.llm_provider === 'gemini' || draft.llm_provider === 'gemini-cli'
  );
  if (isGeminiNativeChat) {
    return (
      <FieldStack label="Google Search">
        <div style={{
          padding: '10px 12px',
          background: 'rgba(255, 255, 255, 0.025)',
          border: '1px solid var(--glass-border)',
          borderRadius: 10,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}>
          <Search size={11} strokeWidth={2} aria-hidden
            style={{ opacity: 0.7, marginTop: 3, flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>
              Grounding is built in
            </span>
            <span style={{
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              lineHeight: 1.45,
              letterSpacing: '0.005em',
            }}>
              Your Gemini chat provider grounds replies in live web
              sources natively. No separate key needed.
            </span>
          </div>
        </div>
      </FieldStack>
    );
  }
  const hasKey = !!draft.gemini_search_api_key?.trim();
  return (
    <>
      <FieldStack
        label="Gemini key (Google Search)"
        aside={<InlineHint>optional</InlineHint>}
      >
        <SecretInput
          value={draft.gemini_search_api_key ?? ''}
          onChange={(v) => update('gemini_search_api_key', v || null)}
          placeholder="AIza…"
        />
      </FieldStack>
      <FieldStack
        label="Grounded search"
        aside={hasKey ? undefined : <InlineHint>add a key to enable</InlineHint>}
      >
        <Lever
          on={draft.grounding_search_enabled && hasKey}
          onChange={(v) => update('grounding_search_enabled', v)}
          onLabel="On"
          offLabel="Off"
        />
      </FieldStack>
    </>
  );
}

// =============================================================================
// VOICE, TTS
// =============================================================================

function VoiceFacet({ draft, update }: PaneContext) {
  return (
    <Composition
      eyebrow="the voice that speaks replies"
      title={ttsHeadline(draft.tts_provider)}
      tagline="ElevenLabs renders in the cloud with high realism. Supertonic, Kokoro and Qwen3 run on your machine, no key required."
      sigil={<Voiceprint />}
    >
      <Stack>
        <FieldStack label="Engine">
          <Dropdown
            value={draft.tts_provider}
            onChange={(v) => update('tts_provider', v as TtsProviderId)}
            options={[
              { id: 'elevenlabs', label: 'ElevenLabs (cloud, realistic)' },
              { id: 'supertonic', label: 'Supertonic-3 (local, 31 languages, ~5× realtime)' },
              { id: 'kokoro',     label: 'Kokoro (local, open-weight)' },
            ]}
            placeholder="Choose an engine"
          />
        </FieldStack>

        {draft.tts_provider === 'elevenlabs' && (
          <>
            <FieldStack label="ElevenLabs key">
              <SecretInput
                value={draft.elevenlabs_api_key ?? ''}
                onChange={(v) => update('elevenlabs_api_key', v || null)}
                placeholder="paste your ElevenLabs key"
              />
            </FieldStack>
            <FieldStack
              label="Voice ID"
              aside={<InlineHint>defaults to the Grace clone</InlineHint>}
            >
              <input
                type="text"
                placeholder="zmcVlqmyk3Jpn5AVYcAL"
                value={draft.elevenlabs_voice ?? ''}
                onChange={(e) => update('elevenlabs_voice', e.target.value || null)}
                style={NATIVE_INPUT_STYLE}
              />
            </FieldStack>
          </>
        )}

        {draft.tts_provider === 'kokoro' && (
          <FieldStack label="Voice file" aside={<InlineHint>shipped with the runtime</InlineHint>}>
            <input
              type="text"
              placeholder="grace_kokoro"
              value={draft.kokoro_voice ?? ''}
              onChange={(e) => update('kokoro_voice', e.target.value || null)}
              style={NATIVE_INPUT_STYLE}
            />
          </FieldStack>
        )}

        {draft.tts_provider === 'qwen3' && (
          <FieldStack label="Voice file" aside={<InlineHint>shipped with the runtime</InlineHint>}>
            <input
              type="text"
              placeholder="grace_qwen3"
              value={draft.qwen3_voice ?? ''}
              onChange={(e) => update('qwen3_voice', e.target.value || null)}
              style={NATIVE_INPUT_STYLE}
            />
          </FieldStack>
        )}

        {draft.tts_provider === 'supertonic' && (
          <FieldStack
            label="Voice"
            aside={
              <InlineHint>
                F1-F5 / M1-M5 built-in, or a Voice-Builder clone (e.g. grace)
              </InlineHint>
            }
          >
            <input
              type="text"
              placeholder="grace"
              value={draft.supertonic_voice ?? ''}
              onChange={(e) =>
                update('supertonic_voice', e.target.value || null)
              }
              style={NATIVE_INPUT_STYLE}
            />
          </FieldStack>
        )}
      </Stack>
    </Composition>
  );
}

function ttsHeadline(p: TtsProviderId): string {
  switch (p) {
    case 'elevenlabs': return 'ElevenLabs.';
    case 'supertonic': return 'Supertonic-3, local.';
    case 'kokoro':     return 'Kokoro, local.';
    case 'qwen3':      return 'Qwen3-TTS (disabled).';
  }
}

// =============================================================================
// AGENTIC, escalation backend + key + model
// =============================================================================

function AgenticFacet({ draft, update, validation, isProbingKey, liveModelsByProvider }: PaneContext) {
  const backends: { id: LLMProviderId; label: string; tag: string }[] = [
    { id: 'openai',      label: 'OpenAI',          tag: 'Responses API' },
    { id: 'anthropic',   label: 'Anthropic',       tag: 'Messages API' },
    { id: 'gemini',      label: 'Gemini',          tag: 'functionDeclarations' },
    { id: 'deepseek',    label: 'DeepSeek',        tag: 'OpenAI-compat tool loop' },
    { id: 'claude-code', label: 'Claude Code CLI', tag: 'Pro/Max subscription' },
    { id: 'gemini-cli',  label: 'Gemini CLI',      tag: 'Free tier or Pro' },
    { id: 'codex',       label: 'Codex CLI',       tag: 'ChatGPT subscription' },
    { id: 'ollama',      label: 'Local',           tag: 'reuses chat model' },
  ];
  const meta: Record<string, { url: string; keyPh: string; modelPh: string }> = {
    openai:    { url: 'https://platform.openai.com/api-keys',         keyPh: 'sk-…',     modelPh: 'gpt-5.4-mini' },
    anthropic: { url: 'https://console.anthropic.com/settings/keys', keyPh: 'sk-ant-…', modelPh: 'claude-opus-4-7' },
    gemini:    { url: 'https://aistudio.google.com/apikey',          keyPh: 'AIza…',    modelPh: 'gemini-2.5-flash' },
    deepseek:  { url: 'https://platform.deepseek.com/api_keys',     keyPh: 'sk-…',     modelPh: 'deepseek-v4-flash' },
  };
  const m = meta[draft.agentic_provider] ?? meta.openai;
  const isKeylessCli = KEYLESS_CLI_PROVIDERS.has(draft.agentic_provider);
  const isLocal = draft.agentic_provider === 'ollama';
  const needsApiKey = !isKeylessCli && !isLocal;
  return (
    <Composition
      eyebrow="escalation for tools, search, and code"
      title={draft.agentic_enabled ? 'Escalation on.' : 'Escalation off.'}
      tagline={draft.agentic_enabled
        ? 'Chat hands off to a bigger model when a question wants tools, web search, or browsing.'
        : 'Conversational only. Every reply comes from the chat model, nothing else.'}
    >
      <Stack>
        <Lever
          on={draft.agentic_enabled}
          onChange={(v) => update('agentic_enabled', v)}
          onLabel="On"
          offLabel="Off"
        />

        {draft.agentic_enabled && (
          <>
            <FieldStack label="Backend">
              <BackendGrid
                options={backends}
                value={draft.agentic_provider}
                onChange={(v) => update('agentic_provider', v)}
              />
            </FieldStack>

            {needsApiKey && (
              <>
                <FieldStack label="Key">
                  <SecretInput
                    value={draft.agentic_api_key ?? ''}
                    onChange={(v) => update('agentic_api_key', v || null)}
                    placeholder={m.keyPh}
                  />
                </FieldStack>
                <FieldStack label="Model">
                  <input
                    type="text"
                    placeholder={m.modelPh}
                    value={draft.agentic_model ?? ''}
                    onChange={(e) => update('agentic_model', e.target.value || null)}
                    style={NATIVE_INPUT_STYLE}
                  />
                </FieldStack>
              </>
            )}

            {isKeylessCli && (() => {
              // Same architecture as the chat facet's model dropdown:
              // model list comes from liveModelsByProvider, populated
              // by the agentic auto-probe when a CLI provider is
              // selected. Single render handles all three CLIs.
              const aprov = draft.agentic_provider;
              const rawLive = liveModelsByProvider[aprov] ?? [];
              const entries = rawLive.map((rawId) => ({
                id: `${aprov}:${rawId}`,
                label: rawId,
              }));
              const placeholder =
                isProbingKey ? 'Verifying…'
                : entries.length === 0 ? 'Sign in via Terminal first'
                : 'Choose a model';
              return (
                <>
                  <CliProviderStatusCard
                    provider={aprov as LLMProviderId}
                    outcome={validation?.agentic ?? validation?.llm ?? null}
                    isProbing={isProbingKey}
                  />
                  <FieldStack
                    label="Model"
                    aside={
                      isProbingKey
                        ? <InlineHint><Loader2 size={10} className="animate-spin" /> verifying</InlineHint>
                        : entries.length
                          ? <InlineHint>{entries.length} live from CLI</InlineHint>
                          : undefined
                    }
                  >
                    <Dropdown
                      value={draft.agentic_model ?? ''}
                      onChange={(id) => update('agentic_model', id || null)}
                      options={entries}
                      placeholder={placeholder}
                      disabled={entries.length === 0}
                    />
                  </FieldStack>
                </>
              );
            })()}
          </>
        )}
      </Stack>
    </Composition>
  );
}

// =============================================================================
// GRAPHICS, render quality preset
// =============================================================================

function GraphicsFacet({ draft, update, graphicsChanged }: PaneContext) {
  const tiers: { id: GraphicsQuality; label: string; copy: string; rings: number }[] = [
    { id: 'low',    label: 'Low',    copy: '50% backbuffer. Stays cool on a laptop.',         rings: 2 },
    { id: 'medium', label: 'Medium', copy: '75% backbuffer. Richer subsurface scattering.',   rings: 3 },
    { id: 'high',   label: 'High',   copy: '100% backbuffer. Desktop GPU recommended.',       rings: 4 },
  ];
  return (
    <Composition
      eyebrow="how the character renders"
      title={graphicsHeadline(draft.graphics_quality)}
      tagline="Three render presets. Lower draws less from the GPU; higher gives finer skin and shadow."
    >
      <PresenceTiles
        tiers={tiers}
        value={draft.graphics_quality}
        onChange={(v) => update('graphics_quality', v)}
      />
      {graphicsChanged && (
        <div style={{
          marginTop: 18,
          fontSize: 11.5,
          color: 'var(--accent)',
          letterSpacing: '0.01em',
        }}>
          Restart Unclaw to apply.
        </div>
      )}
    </Composition>
  );
}

function graphicsHeadline(q: GraphicsQuality): string {
  switch (q) {
    case 'low':    return 'Low.';
    case 'medium': return 'Medium.';
    case 'high':   return 'High.';
  }
}

// =============================================================================
// PROFILE, identity + assistant name + vibe + interests
// =============================================================================
//
// All personalization fields the onboarding wizard collects, surfaced
// here for post-onboarding edit. Shape mirrors the wizard's three steps
// (Identity / Vibe / Interests) collapsed into a single scrollable
// composition. Writes go through the shared save bar, hitting
// /user_settings via saveSettings, same endpoint the wizard uses.

const HOBBY_SUGGESTIONS = [
  'code', 'music', 'sports', 'art', 'gaming',
  'reading', 'fitness', 'design', 'cooking', 'travel',
];

const SCHEDULE_LABELS: Record<UserSchedule, string> = {
  early_bird: 'Early bird',
  night_owl:  'Night owl',
  mixed:      'Mixed',
};

function ProfileFacet({ profile, updateProfile }: PaneContext) {
  if (!profile) {
    return (
      <Composition
        eyebrow="you + the agent"
        title="No profile saved yet."
        tagline="Run onboarding from the welcome screen to set this up. After that, every field is editable here."
      >
        <span />
      </Composition>
    );
  }
  const interests = profile.interests ?? [];
  const notes = profile.notes ?? '';
  const notesLeft = 500 - notes.length;
  const showNotesCount = notes.length > 440;
  const toggleHobby = (tag: string) => {
    const has = interests.includes(tag);
    updateProfile(
      'interests',
      has ? interests.filter((t) => t !== tag) : [...interests, tag],
    );
  };
  return (
    <Composition
      eyebrow="you + the agent"
      title={`Hello, ${profile.name || 'there'}.`}
      tagline="Everything from your first run, here so you can change your mind. Saves go to the same encrypted store on this Mac."
    >
      <Stack>
        <FieldStack label="Your name">
          <input
            type="text"
            value={profile.name ?? ''}
            onChange={(e) => updateProfile('name', e.target.value)}
            placeholder="Your name"
            style={NATIVE_INPUT_STYLE}
          />
        </FieldStack>

        <FieldStack
          label="Agent name"
          aside={<InlineHint>defaults to Grace</InlineHint>}
        >
          <input
            type="text"
            value={profile.agent_name ?? ''}
            onChange={(e) => updateProfile('agent_name', e.target.value || null)}
            placeholder="Grace"
            style={NATIVE_INPUT_STYLE}
          />
        </FieldStack>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <FieldStack label="City">
              <input
                type="text"
                value={profile.city ?? ''}
                onChange={(e) => updateProfile('city', e.target.value || null)}
                placeholder="San Francisco"
                style={NATIVE_INPUT_STYLE}
              />
            </FieldStack>
          </div>
          <div style={{ flex: 1.3 }}>
            <FieldStack label="Timezone">
              <Dropdown
                value={profile.timezone ?? ''}
                onChange={(v) => updateProfile('timezone', v || null)}
                options={TZ_CATALOG.map(({ id, label }) => ({ id, label }))}
                placeholder="Pick a timezone"
                searchable
              />
            </FieldStack>
          </div>
        </div>

        <FieldStack
          label="Vibe"
          aside={<InlineHint>how the agent speaks</InlineHint>}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            rowGap: 14,
            columnGap: 22,
            padding: '10px 12px',
            background: 'rgba(255, 255, 255, 0.025)',
            border: '1px solid var(--glass-border)',
            borderRadius: 10,
          }}>
            <Slider
              value={profile.vibe_formality ?? DEFAULT_VIBE.vibe_formality}
              onChange={(v) => updateProfile('vibe_formality', v)}
              leftLabel="Casual"  rightLabel="Formal"
              caption="Formality"
              word={vibeWord('formality', profile.vibe_formality)}
            />
            <Slider
              value={profile.vibe_humor ?? DEFAULT_VIBE.vibe_humor}
              onChange={(v) => updateProfile('vibe_humor', v)}
              leftLabel="Dry"     rightLabel="Playful"
              caption="Humor"
              word={vibeWord('humor', profile.vibe_humor)}
            />
            <Slider
              value={profile.vibe_directness ?? DEFAULT_VIBE.vibe_directness}
              onChange={(v) => updateProfile('vibe_directness', v)}
              leftLabel="Gentle"  rightLabel="Blunt"
              caption="Directness"
              word={vibeWord('directness', profile.vibe_directness)}
            />
            <Slider
              value={profile.vibe_verbosity ?? DEFAULT_VIBE.vibe_verbosity}
              onChange={(v) => updateProfile('vibe_verbosity', v)}
              leftLabel="Brief"   rightLabel="Thorough"
              caption="Verbosity"
              word={vibeWord('verbosity', profile.vibe_verbosity)}
            />
          </div>
        </FieldStack>

        <FieldStack label="Hobbies">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {HOBBY_SUGGESTIONS.map((tag) => {
              const active = interests.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleHobby(tag)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: active
                      ? '1px solid var(--accent-strong)'
                      : '1px solid var(--glass-border)',
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 11.5,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    letterSpacing: '0.005em',
                    transition: 'all 0.15s var(--ease-out-quart)',
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </FieldStack>

        <FieldStack label="Sleep schedule">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['early_bird', 'night_owl', 'mixed'] as UserSchedule[]).map((key) => {
              const active = profile.schedule === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateProfile('schedule', active ? null : key)}
                  style={{
                    flex: 1,
                    padding: '9px 10px',
                    borderRadius: 10,
                    border: active
                      ? '1px solid var(--accent-strong)'
                      : '1px solid var(--glass-border)',
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    transition: 'all 0.15s var(--ease-out-quart)',
                  }}
                >
                  {SCHEDULE_LABELS[key]}
                </button>
              );
            })}
          </div>
        </FieldStack>

        <FieldStack
          label="Anything else"
          aside={showNotesCount ? (
            <InlineHint>
              <span style={{ color: notesLeft < 0 ? 'var(--accent)' : undefined }}>
                {notesLeft}
              </span>
            </InlineHint>
          ) : undefined}
        >
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => updateProfile('notes', e.target.value.slice(0, 500) || null)}
            placeholder="Favorite shows, current project, allergies, anything…"
            maxLength={500}
            style={{
              ...NATIVE_INPUT_STYLE,
              resize: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.45,
            }}
          />
        </FieldStack>
      </Stack>
    </Composition>
  );
}

// =============================================================================
// ABOUT
// =============================================================================

function AboutFacet() {
  const version = (import.meta as { env?: Record<string, string | undefined> })
    .env?.VITE_APP_VERSION ?? '0.0.0';
  return (
    <Composition
      eyebrow="about the app"
      title="A presence, not a tool."
      tagline="An AI companion that breathes between words. Local-first, embodied, and yours."
    >
      {/* Brand signature: logo + version. The wordmark text was
          redundant once the logo got large enough to read on its own.
          Logo bumped to 120px since it's the sole brand element now. */}
      <div style={{
        marginTop: 24,
        marginBottom: 28,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 10,
      }}>
        <img
          src={logoUrl}
          alt="Unclaw"
          draggable={false}
          style={{
            width: 120,
            height: 120,
            objectFit: 'contain',
            opacity: 0.95,
            filter: 'drop-shadow(0 4px 18px rgba(0, 0, 0, 0.42))',
            userSelect: 'none',
          }}
        />
        <div style={{
          fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
          fontSize: 11.5,
          letterSpacing: '0.04em',
          color: 'var(--text-ghost)',
        }}>
          v{version}
        </div>
      </div>

      {/* Labels stripped per design pass; values stand on their own.
          Foton Labs logo + the two links stack as a clean credit block.
          "Get in touch" routes to the Discord invite, not email. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
        <img
          src={fotonLabsUrl}
          alt="Foton Labs"
          draggable={false}
          style={{
            // Logo is a 1332x206 wordmark, render at 28px for a clear
            // credit line. 75% opacity keeps it from competing with the
            // Unclaw mark above while still reading at a glance.
            height: 28,
            width: 'auto',
            objectFit: 'contain',
            opacity: 0.75,
            userSelect: 'none',
            marginBottom: 4,
          }}
        />
        <LinkText href="https://unclaw.io">
          unclaw.io <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
        </LinkText>
        <LinkText href="https://discord.com/invite/BZmVm4cCXH">
          Get in touch <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
        </LinkText>
      </div>

      {/* Social row pinned to the bottom-center of the About facet.
          marginTop: auto eats the remaining vertical space so the row
          sits at the footer of the scroll viewport (the Composition
          article has minHeight:100% so this trick actually has room). */}
      <div style={{
        marginTop: 'auto',
        paddingTop: 32,
        display: 'flex',
        gap: 18,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <SocialIcon href="https://discord.com/invite/BZmVm4cCXH" label="Discord" src={discordUrl} />
        <SocialIcon href="https://www.instagram.com/foton.labs/" label="Instagram" src={instagramUrl} />
        <SocialIcon href="https://www.tiktok.com/@foton.labs" label="TikTok" src={tiktokUrl} />
      </div>
    </Composition>
  );
}

function SocialIcon({ href, label, src }: { href: string; label: string; src: string }) {
  // Brand-color SVGs flattened to monochrome white via filter chain:
  // brightness(0) → solid black, invert(1) → solid white, opacity dims.
  // Hover bumps opacity so it reads as interactive without color shift.
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        window.electronAPI?.authOpenExternal?.(href);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        cursor: 'pointer',
        opacity: 0.55,
        transition: 'opacity 0.16s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.95'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.55'; }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          width: 18,
          height: 18,
          objectFit: 'contain',
          filter: 'brightness(0) invert(1)',
          userSelect: 'none',
        }}
      />
    </a>
  );
}

function AboutLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 14,
      fontSize: 13,
      color: 'var(--text-primary)',
      letterSpacing: '-0.005em',
    }}>
      <span style={{
        minWidth: 64,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--text-ghost)',
      }}>
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

// =============================================================================
// Composition primitives
// =============================================================================

function Composition({
  eyebrow, title, tagline, sigil, children,
}: {
  eyebrow: string;
  title: string;
  tagline: string;
  sigil?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Eyebrow + title + tagline form a small editorial header. The
          eyebrow is the small-caps voice from the boot screen; the
          title is the lede; the tagline is one sentence. Sigil
          (optional decoration) floats top-right. */}
      <header style={{
        position: 'relative',
        paddingTop: 6,
        paddingBottom: 22,
      }}>
        {sigil && (
          <div style={{ position: 'absolute', top: 0, right: 0 }}>
            {sigil}
          </div>
        )}
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-ghost)',
        }}>
          {eyebrow}
        </div>
        <h2 style={{
          margin: '8px 0 6px',
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: 'var(--text-primary)',
        }}>
          {title}
        </h2>
        <p style={{
          margin: 0,
          fontSize: 13,
          color: 'var(--text-secondary)',
          letterSpacing: '-0.005em',
          lineHeight: 1.5,
          maxWidth: 460,
        }}>
          {tagline}
        </p>
      </header>
      {children}
    </article>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  // Vertical stack with breathing rhythm. Not a 2-col grid; each
  // field gets its full width and its label sits above it. Reads
  // editorial, not Excel-formy.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {children}
    </div>
  );
}

function FieldStack({
  label, aside, children,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 8,
        gap: 12,
      }}>
        <span style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-ghost)',
        }}>
          {label}
        </span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function InlineHint({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 10.5,
      color: 'var(--text-secondary)',
      letterSpacing: '0.01em',
    }}>
      {children}
    </span>
  );
}

function LinkText({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        window.electronAPI?.authOpenExternal?.(href);
      }}
      style={{
        color: 'var(--accent)',
        textDecoration: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11.5,
        letterSpacing: '0.005em',
      }}
    >
      {children}
    </a>
  );
}

function SecretInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type={reveal ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{
          ...NATIVE_INPUT_STYLE,
          paddingRight: 36,
          fontFamily: reveal
            ? '"SF Mono", ui-monospace, Menlo, monospace'
            : 'inherit',
          fontSize: reveal ? 12 : 13,
          // The 0.22em tracking is for evenly-spaced password dots, it
          // shouldn't apply to the placeholder text (was rendering the
          // placeholder as "p a s t e   y o u r   G r o q   k e y").
          // Only kick in when there's an actual obscured value.
          letterSpacing: reveal || !value ? '0.01em' : '0.22em',
        }}
      />
      <button
        type="button"
        onClick={() => setReveal((v) => !v)}
        aria-label={reveal ? 'Hide key' : 'Show key'}
        title={reveal ? 'Hide key' : 'Show key'}
        style={{
          position: 'absolute',
          right: 8, top: '50%',
          transform: 'translateY(-50%)',
          width: 26, height: 26,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        {reveal ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
      </button>
    </div>
  );
}

// =============================================================================
// Will-facet specific: Lever + BackendGrid
// =============================================================================

function Lever({
  on, onChange, onLabel, offLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  // A wider horizontal lever, not the iOS switch. Two halves: OFF on
  // the left, ON on the right. The active half tints with ember-dim
  // and the inactive half stays neutral. Reads more like a physical
  // switch on a piece of equipment than a generic UI toggle.
  return (
    <div
      role="group"
      aria-label="Escalation"
      style={{
        display: 'inline-flex',
        padding: 3,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid var(--glass-border)',
        borderRadius: 10,
        gap: 0,
      }}
    >
      <LeverHalf active={!on} accent={false} onClick={() => onChange(false)}>{offLabel}</LeverHalf>
      <LeverHalf active={on}  accent={true}  onClick={() => onChange(true)}>{onLabel}</LeverHalf>
    </div>
  );
}

function LeverHalf({
  active, accent, onClick, children,
}: {
  active: boolean;
  accent: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 16px',
        background: active
          ? (accent ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)')
          : 'transparent',
        color: active && accent ? '#fff' : 'var(--text-primary)',
        border: 'none',
        borderRadius: 7,
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        minWidth: 64,
        transition: 'background var(--duration-fast) var(--ease-out-quart), color var(--duration-fast) var(--ease-out-quart)',
      }}
    >
      {children}
    </button>
  );
}

function BackendGrid({
  options, value, onChange,
}: {
  options: { id: LLMProviderId; label: string; tag: string }[];
  value: LLMProviderId;
  onChange: (v: LLMProviderId) => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: 8,
    }}>
      {options.map((opt) => {
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 3,
              padding: '11px 14px',
              background: isActive
                ? 'rgba(196, 68, 68, 0.12)'
                : 'rgba(255, 255, 255, 0.025)',
              border: `1px solid ${isActive ? 'rgba(196, 68, 68, 0.40)' : 'var(--glass-border)'}`,
              borderRadius: 10,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'background var(--duration-fast) var(--ease-out-quart), border-color var(--duration-fast) var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              if (isActive) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
            }}
            onMouseLeave={(e) => {
              if (isActive) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em' }}>
              {opt.label}
            </span>
            <span style={{
              fontSize: 10.5,
              color: 'var(--text-secondary)',
              letterSpacing: '0.005em',
            }}>
              {opt.tag}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// Presence-facet specific: three tiles with concentric-ring glyphs
// =============================================================================

function PresenceTiles({
  tiers, value, onChange,
}: {
  tiers: { id: GraphicsQuality; label: string; copy: string; rings: number }[];
  value: GraphicsQuality;
  onChange: (v: GraphicsQuality) => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 10,
    }}>
      {tiers.map((tier) => {
        const isActive = value === tier.id;
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => onChange(tier.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 10,
              padding: '18px 16px 16px',
              background: isActive
                ? 'rgba(196, 68, 68, 0.10)'
                : 'rgba(255, 255, 255, 0.025)',
              border: `1px solid ${isActive ? 'rgba(196, 68, 68, 0.34)' : 'var(--glass-border)'}`,
              borderRadius: 12,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'background var(--duration-base) var(--ease-out-quart), border-color var(--duration-base) var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              if (isActive) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
            }}
            onMouseLeave={(e) => {
              if (isActive) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
            }}
          >
            <ConcentricRings count={tier.rings} active={isActive} />
            <span style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              marginTop: 4,
            }}>
              {tier.label}
            </span>
            <span style={{
              fontSize: 11.5,
              color: 'var(--text-secondary)',
              letterSpacing: '-0.005em',
              lineHeight: 1.45,
            }}>
              {tier.copy}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConcentricRings({ count, active }: { count: number; active: boolean }) {
  // A small iris of N concentric circles. Reads as "more detail at
  // higher tier" without literally drawing 3 character renderings.
  const rings = Array.from({ length: count }, (_, i) => i + 1);
  const accent = active ? 'rgba(196, 68, 68, 0.9)' : 'rgba(255, 255, 255, 0.32)';
  return (
    <svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden>
      {rings.map((r, i) => (
        <circle
          key={r}
          cx={0} cy={0}
          r={2 + i * 3.5}
          fill="none"
          stroke={i === rings.length - 1 ? accent : 'rgba(255, 255, 255, 0.18)'}
          strokeWidth={i === rings.length - 1 ? 1.5 : 0.8}
        />
      ))}
      <circle cx={0} cy={0} r={1.2} fill={accent} />
    </svg>
  );
}

// =============================================================================
// Voice-facet decoration: a static voiceprint
// =============================================================================

function Voiceprint() {
  // Six vertical bars of varying height that read as a frozen
  // moment of a waveform. Sits in the top-right of the Voice
  // composition header as a single visual that hints at what the
  // facet is for, without animating and stealing the eye.
  const heights = [10, 18, 24, 16, 28, 12];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 30 }}>
      {heights.map((h, i) => (
        <span key={i} style={{
          width: 3,
          height: h,
          borderRadius: 1.5,
          background: i === 2 || i === 4
            ? 'rgba(196, 68, 68, 0.55)'
            : 'rgba(255, 255, 255, 0.28)',
        }} />
      ))}
    </div>
  );
}

// =============================================================================
// Facet glyphs (custom inline SVG, not stock icons)
// =============================================================================

function GlyphMind({ size = 16, active }: { size?: number; active?: boolean }) {
  // A small orbit echoing the boot screen, hinting at thought + cycles.
  const c = active ? 'var(--accent)' : 'currentColor';
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden>
      <circle cx={0} cy={0} r={6} fill="none" stroke={c} strokeWidth={1} opacity={0.45} />
      <path d="M 6 0 A 6 6 0 0 1 0 6" fill="none" stroke={c} strokeWidth={1.4} strokeLinecap="round" />
      <circle cx={6} cy={0} r={1.4} fill={c} />
    </svg>
  );
}

function GlyphVoice({ size = 16, active }: { size?: number; active?: boolean }) {
  // Three vertical bars of varying height. Reads as a voice waveform.
  const c = active ? 'var(--accent)' : 'currentColor';
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden>
      <rect x={-7} y={-3} width={2} height={6} rx={1} fill={c} />
      <rect x={-2} y={-7} width={2} height={14} rx={1} fill={c} />
      <rect x={3}  y={-5} width={2} height={10} rx={1} fill={c} />
    </svg>
  );
}

function GlyphWill({ size = 16, active }: { size?: number; active?: boolean }) {
  // A branching curve. Reads as "decision / handoff", which is what
  // agentic escalation actually does. Geometry shifted up 2.5 so the
  // visual content centers in the viewBox; previous coords (y in [-2, 7])
  // pushed the glyph into the lower half and read as off-center next
  // to the other facet icons.
  const c = active ? 'var(--accent)' : 'currentColor';
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden>
      <path d="M -7 4.5 Q -7 -4.5 0 -4.5 L 7 -4.5"
            fill="none" stroke={c} strokeWidth={1.4} strokeLinecap="round" />
      <path d="M -7 4.5 Q -7 1.5 -2 1.5 L 7 1.5"
            fill="none" stroke={c} strokeWidth={1.4} strokeLinecap="round" opacity={0.55} />
      <circle cx={7} cy={-4.5} r={1.4} fill={c} />
    </svg>
  );
}

function GlyphPresence({ size = 16, active }: { size?: number; active?: boolean }) {
  // A small iris (3 concentric rings). Matches the Presence facet's
  // tile glyphs so the picker and content speak the same visual.
  const c = active ? 'var(--accent)' : 'currentColor';
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden>
      <circle cx={0} cy={0} r={7} fill="none" stroke={c} strokeWidth={1} opacity={0.4} />
      <circle cx={0} cy={0} r={4.5} fill="none" stroke={c} strokeWidth={1} opacity={0.7} />
      <circle cx={0} cy={0} r={1.6} fill={c} />
    </svg>
  );
}

function GlyphProfile({ size = 16, active }: { size?: number; active?: boolean }) {
  // A small portrait: head circle + shoulders arc. Reads as "you"
  // without using the stock lucide User icon, matching the custom
  // glyph language of the other facets.
  const c = active ? 'var(--accent)' : 'currentColor';
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden>
      <circle cx={0} cy={-3.5} r={3} fill="none" stroke={c} strokeWidth={1.4} />
      <path d="M -6 7 Q -6 1 0 1 Q 6 1 6 7"
            fill="none" stroke={c} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

function GlyphAbout({ size = 16, active }: { size?: number; active?: boolean }) {
  // A simple lowercase 'i' set inside a frame. Reads as info without
  // looking like the stock Lucide Info circle.
  const c = active ? 'var(--accent)' : 'currentColor';
  return (
    <svg width={size} height={size} viewBox="-10 -10 20 20" aria-hidden>
      <rect x={-7} y={-7} width={14} height={14} rx={3} fill="none" stroke={c} strokeWidth={1} opacity={0.55} />
      <circle cx={0} cy={-3} r={1.2} fill={c} />
      <rect x={-1} y={0} width={2} height={6} rx={1} fill={c} />
    </svg>
  );
}

// =============================================================================
// Status chip (unchanged from previous; cohesive with the rest of the app)
// =============================================================================

function StatusChip({
  saveState, validation, onRestart, onDismissSaved,
}: {
  saveState: SaveState;
  validation: KeyValidationResult | null;
  onRestart: () => void;
  onDismissSaved: () => void;
}) {
  if (saveState.kind === 'error') {
    return (
      <span style={{ ...CHIP_BASE, background: 'rgba(196, 68, 68, 0.12)', borderColor: 'rgba(196, 68, 68, 0.35)', color: '#f1b5b5' }}>
        <AlertCircle size={12} strokeWidth={2} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
          {saveState.message}
        </span>
      </span>
    );
  }
  if (saveState.kind === 'saved' && saveState.graphicsChanged) {
    return (
      <span style={{
        ...CHIP_BASE,
        background: 'rgba(196, 68, 68, 0.10)',
        borderColor: 'rgba(196, 68, 68, 0.30)',
        color: 'var(--text-primary)',
      }}>
        <Check size={12} strokeWidth={2} style={{ color: 'var(--accent)' }} />
        <span>Saved. Restart Unclaw to apply.</span>
        <button type="button" onClick={onRestart} style={INLINE_ACTION_STYLE}>
          Restart now
        </button>
        <button type="button" onClick={onDismissSaved} style={{ ...INLINE_ACTION_STYLE, color: 'var(--text-secondary)' }}>
          Later
        </button>
      </span>
    );
  }
  if (saveState.kind === 'saved') {
    return (
      <span style={{ ...CHIP_BASE, background: 'rgba(140, 191, 138, 0.10)', borderColor: 'rgba(140, 191, 138, 0.28)', color: '#bfdcbe' }}>
        <Check size={12} strokeWidth={2} />
        <span>Saved.</span>
      </span>
    );
  }
  if (saveState.kind === 'validating' || saveState.kind === 'saving') {
    return (
      <span style={{ ...CHIP_BASE, background: 'transparent', borderColor: 'rgba(255, 255, 255, 0.10)', color: 'var(--text-secondary)' }}>
        <Loader2 size={12} className="animate-spin" />
        <span>{saveState.kind === 'validating' ? 'Verifying keys' : 'Saving'}</span>
      </span>
    );
  }
  if (validation && (validation.llm?.ok || validation.tts?.ok)) {
    // The auto-probe in the chat facet writes a partial validation
    // object (llm only, no tts). Render each side independently so a
    // partial result doesn't crash on `undefined.ok`.
    const parts: string[] = [];
    if (validation.llm) parts.push(`Chat ${validation.llm.ok ? '✓' : '✗'}`);
    if (validation.tts) parts.push(`Voice ${validation.tts.ok ? '✓' : '✗'}`);
    return (
      <span style={{ ...CHIP_BASE, background: 'transparent', borderColor: 'rgba(255, 255, 255, 0.10)', color: 'var(--text-secondary)' }}>
        Last check: {parts.join(' · ')}
      </span>
    );
  }
  return null;
}

// =============================================================================
// Styles
// =============================================================================

const SCRIM_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  // Lighter veil now (was 28% / 8px). The shell carries enough of its
  // own contrast at alpha 0.94 that the scrim only needs to hint at
  // depth, not darken the stream. Blur is still useful so the bright
  // bokeh from the character doesn't bleed sharp edges into the shell.
  background: 'rgba(6, 6, 8, 0.16)',
  backdropFilter: 'blur(6px) saturate(1.0)',
  WebkitBackdropFilter: 'blur(6px) saturate(1.0)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '28px 20px',
  fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
};

const SHELL_STYLE: React.CSSProperties = {
  position: 'relative',
  width: 'min(620px, 100%)',
  height: 'min(580px, calc(100vh - 56px))',
  borderRadius: 18,
  // Warm coal (28,24,26) with saturate(1.0) — saturate ≥ 1.05 pulls
  // the navy ambient of the stream UP through the shell's 6% alpha
  // window and re-tints the panel blue, which is exactly the "AI
  // looking blue" complaint. Holding saturate at 1.0 + bumping alpha
  // to 0.94 keeps the surface warm-neutral.
  background: 'rgba(28, 24, 26, 0.94)',
  backdropFilter: 'blur(48px) saturate(1.0)',
  WebkitBackdropFilter: 'blur(48px) saturate(1.0)',
  border: '1px solid rgba(255, 255, 255, 0.10)',
  boxShadow: 'var(--shadow-panel-ground, 0 24px 56px -14px rgba(0, 0, 0, 0.58))',
  color: 'var(--text-primary, #f0f1f5)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const HAIRLINE_TOP_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0, left: 22, right: 22, height: 1,
  background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.18), transparent)',
  pointerEvents: 'none',
};

const CLOSE_BTN_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 12, right: 12,
  width: 26, height: 26,
  borderRadius: 7,
  background: 'transparent',
  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.10))',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
  transition: 'background var(--duration-fast) var(--ease-out-quart), color var(--duration-fast) var(--ease-out-quart)',
};

const LOADING_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
};

const HEADER_STYLE: React.CSSProperties = {
  padding: '16px 22px 8px',
};

const FACET_NAV_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: '0 18px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
};

function facetPillStyle(isActive: boolean): React.CSSProperties {
  return {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '10px 13px 12px',
    background: 'transparent',
    border: 'none',
    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: isActive ? 600 : 500,
    letterSpacing: '-0.005em',
    cursor: 'pointer',
    transition: 'color var(--duration-fast) var(--ease-out-quart)',
  };
}

const BODY_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '16px 22px 84px',
};

const ACTIONBAR_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0, right: 0, bottom: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 18px 11px',
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  // De-blued gradient: was (20, 24, 32), now matches the shell's warm
  // coal. saturate(1.0) (was 1.5) prevents the action bar from boosting
  // the stream's navy at exactly the moment the user is focused on it
  // (where the AI-tinted look was most noticeable).
  background: 'linear-gradient(to top, rgba(22, 18, 20, 0.86), rgba(22, 18, 20, 0.38))',
  backdropFilter: 'blur(20px) saturate(1.0)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.0)',
};

const NATIVE_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.10))',
  borderRadius: 10,
  color: 'var(--text-primary, #f0f1f5)',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
  letterSpacing: '-0.005em',
  transition: 'border-color var(--duration-fast) var(--ease-out-quart), background var(--duration-fast) var(--ease-out-quart)',
};

const NATIVE_SELECT_STYLE: React.CSSProperties = {
  ...NATIVE_INPUT_STYLE,
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  cursor: 'pointer',
  backgroundImage:
    'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\'><path d=\'M1 1L5 5L9 1\' stroke=\'rgba(255,255,255,0.55)\' stroke-width=\'1.4\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 30,
};

const CHIP_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid transparent',
  fontSize: 11.5,
  letterSpacing: '-0.005em',
  fontWeight: 500,
};

const INLINE_ACTION_STYLE: React.CSSProperties = {
  marginLeft: 6,
  padding: '4px 10px',
  background: 'rgba(196, 68, 68, 0.42)',
  border: '1px solid rgba(255, 200, 190, 0.28)',
  borderRadius: 6,
  color: 'rgba(255, 255, 255, 0.95)',
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
};

const GHOST_BTN_STYLE: React.CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.12))',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 12,
  letterSpacing: '-0.005em',
  cursor: 'pointer',
  transition: 'background var(--duration-fast) var(--ease-out-quart), border-color var(--duration-fast) var(--ease-out-quart)',
};

const PRIMARY_BTN_STYLE: React.CSSProperties = {
  padding: '8px 18px',
  background: 'var(--accent, #c44444)',
  border: '1px solid rgba(255, 200, 190, 0.42)',
  borderRadius: 8,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '-0.005em',
  cursor: 'pointer',
  boxShadow: 'var(--shadow-button-glow, 0 4px 14px -4px rgba(196, 68, 68, 0.55))',
  animation: 'settings-save-pulse 0.85s var(--ease-out-expo) both',
};
