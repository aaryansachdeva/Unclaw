// Settings — two-pane overlay. Category rail on the left (iPad Settings
// pattern); the selected category's content on the right. Same frosted
// slate material as the rest of Unclaw's chrome, same Plus Jakarta Sans,
// same warm-red accent reserved for moments of attention. Replaces the
// previous single-column scrolling blog-page layout.
//
// Categories: Chat (LLM), Voice (TTS), Agentic, Graphics, About.
// Each lives in its own React component below; the panel itself only
// owns layout, navigation, save/discard, and the cross-cutting state
// (draft / validation / live model fetch).
//
// Save flow stays unchanged: validateKeys() runs on Save, drops a banner
// on failure, persists via safeStorage on success. Graphics changes
// trigger the "Restart Unclaw" prompt that calls electronAPI.update.restart.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Check, AlertCircle, Loader2,
  MessageSquare, Mic, Sparkles, Sliders, Info,
  Eye, EyeOff, ExternalLink,
} from 'lucide-react';
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
  type KeyValidationResult,
  type LLMProviderId,
  type TtsProviderId,
} from '../services/apiKeys';
import { Dropdown } from './Onboarding/Dropdown';

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

type CategoryId = 'chat' | 'voice' | 'agentic' | 'graphics' | 'about';

interface CategoryMeta {
  id: CategoryId;
  label: string;
  hint: string;
  Icon: typeof MessageSquare;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'chat',     label: 'Chat',     hint: 'Which LLM talks to you',          Icon: MessageSquare },
  { id: 'voice',    label: 'Voice',    hint: 'How the character sounds',        Icon: Mic },
  { id: 'agentic',  label: 'Agentic',  hint: 'Escalation for tools + search',   Icon: Sparkles },
  { id: 'graphics', label: 'Graphics', hint: 'Character render quality',        Icon: Sliders },
  { id: 'about',    label: 'About',    hint: 'Version + diagnostics',           Icon: Info },
];

// ---------------------------------------------------------------------
// Shared context passed to each category pane. Keeps render call-sites
// terse and avoids prop-drilling 12 things into every pane component.
// ---------------------------------------------------------------------

interface PaneContext {
  draft: ApiKeysProfile;
  update: <K extends keyof ApiKeysProfile>(key: K, value: ApiKeysProfile[K]) => void;
  setProvider: (next: LLMProviderId | null) => void;
  liveModelsByProvider: Partial<Record<LLMProviderId, string[]>>;
  isProbingKey: boolean;
  graphicsChanged: boolean;
}

// ---------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------

export function SettingsPanel({ open, onClose, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState<ApiKeysProfile>(DEFAULT_API_KEYS);
  const [original, setOriginal] = useState<ApiKeysProfile>(DEFAULT_API_KEYS);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [validation, setValidation] = useState<KeyValidationResult | null>(null);
  const [active, setActive] = useState<CategoryId>('chat');
  const [liveModelsByProvider, setLiveModelsByProvider] = useState<
    Partial<Record<LLMProviderId, string[]>>
  >({});
  const [isProbingKey, setIsProbingKey] = useState(false);

  // Hydrate on open + clear cached state so a discard + reopen starts fresh.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaveState({ kind: 'idle' });
    setValidation(null);
    setLiveModelsByProvider({});
    setActive('chat');
    void fetchApiKeys().then((profile) => {
      setDraft(profile);
      setOriginal(profile);
      setLoading(false);
    });
  }, [open]);

  // Esc closes (matches CustomizationOverlay convention).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(original),
    [draft, original],
  );
  const graphicsChanged = draft.graphics_quality !== original.graphics_quality;

  const update = useCallback(<K extends keyof ApiKeysProfile>(
    key: K, value: ApiKeysProfile[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setValidation(null);
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

  // Debounced live key probe — populates the model dropdown without
  // making the user click Save first. Skips Ollama (no key) + skips
  // re-probing the same provider when we already have a live list.
  useEffect(() => {
    if (!open || loading) return;
    const provider = draft.llm_provider;
    const key = (draft.llm_api_key || '').trim();
    if (!provider || provider === 'ollama' || !key) return;
    if (liveModelsByProvider[provider]?.length) return;
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
        })
        .catch(() => { /* surfaced on Save */ })
        .finally(() => setIsProbingKey(false));
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, draft.llm_provider, draft.llm_api_key]);

  const handleSave = useCallback(async () => {
    setSaveState({ kind: 'validating' });
    setValidation(null);
    try {
      const result = await validateKeys(draft);
      setValidation(result);
      if (!result.llm.ok || !result.tts.ok) {
        setSaveState({
          kind: 'error',
          message: result.llm.ok
            ? `TTS: ${result.tts.error ?? 'invalid'}`
            : `LLM: ${result.llm.error ?? 'invalid'}`,
        });
        return;
      }
    } catch (err) {
      setValidation(null);
      setSaveState({ kind: 'error', message: `validation failed: ${(err as Error).message}` });
      return;
    }
    setSaveState({ kind: 'saving' });
    try {
      const ok = await saveApiKeys(draft);
      if (!ok) {
        setSaveState({ kind: 'error', message: 'failed to save to disk' });
        return;
      }
      setOriginal(draft);
      setSaveState({ kind: 'saved', graphicsChanged });
      onSaved?.(draft);
    } catch (err) {
      setSaveState({ kind: 'error', message: `save failed: ${(err as Error).message}` });
    }
  }, [draft, graphicsChanged, onSaved]);

  const handleDiscard = useCallback(() => {
    if (!dirty) { onClose(); return; }
    setDraft(original);
    setSaveState({ kind: 'idle' });
    setValidation(null);
    onClose();
  }, [dirty, original, onClose]);

  const ctx: PaneContext = {
    draft, update, setProvider, liveModelsByProvider, isProbingKey, graphicsChanged,
  };

  const activeMeta = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0];

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
            transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
            style={SHELL_STYLE}
          >
            {/* Hairline edge highlight at the top of the panel — same
                detail the widget panels use. Reads as a real piece of
                glass catching ambient light. */}
            <span style={{
              position: 'absolute', top: 0, left: 16, right: 16, height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
              pointerEvents: 'none',
            }} />

            {loading ? (
              <div style={{ padding: 64, textAlign: 'center', color: 'var(--text-secondary)' }}>
                <Loader2 size={20} className="animate-spin" />
                <div style={{ marginTop: 10, fontSize: 12, letterSpacing: '0.04em' }}>
                  Loading settings…
                </div>
              </div>
            ) : (
              <div style={GRID_STYLE}>
                {/* LEFT RAIL — categories */}
                <aside style={RAIL_STYLE}>
                  <header style={RAIL_HEADER_STYLE}>
                    <div style={{
                      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.16em',
                      textTransform: 'uppercase', color: 'var(--text-ghost, #6e6862)',
                    }}>
                      Settings
                    </div>
                  </header>

                  <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px 12px' }}>
                    {CATEGORIES.map((cat) => {
                      const isActive = active === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setActive(cat.id)}
                          style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 12px 9px 14px',
                            borderRadius: 10,
                            background: isActive
                              ? 'rgba(196, 68, 68, 0.10)'
                              : 'transparent',
                            border: 'none',
                            color: isActive
                              ? 'var(--text-primary)'
                              : 'var(--text-secondary)',
                            fontFamily: 'inherit',
                            fontSize: 13,
                            letterSpacing: '-0.005em',
                            fontWeight: isActive ? 600 : 500,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'background 180ms var(--ease-out-quart), color 180ms var(--ease-out-quart)',
                          }}
                          onMouseEnter={(e) => {
                            if (isActive) return;
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                            e.currentTarget.style.color = 'var(--text-primary)';
                          }}
                          onMouseLeave={(e) => {
                            if (isActive) return;
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--text-secondary)';
                          }}
                        >
                          {/* Animated accent bar — Framer Motion's
                              layoutId makes it slide smoothly between
                              categories on change. The single source of
                              accent in the entire panel. */}
                          {isActive && (
                            <motion.span
                              layoutId="settings-active-bar"
                              transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                              style={{
                                position: 'absolute',
                                left: 0, top: 8, bottom: 8,
                                width: 2,
                                borderRadius: 1,
                                background: 'var(--accent, #c44444)',
                              }}
                            />
                          )}
                          <cat.Icon
                            size={15}
                            strokeWidth={1.8}
                            style={{
                              flexShrink: 0,
                              color: isActive ? 'var(--accent, #c44444)' : 'currentColor',
                              transition: 'color 180ms var(--ease-out-quart)',
                            }}
                          />
                          <span style={{ flex: 1 }}>{cat.label}</span>
                        </button>
                      );
                    })}
                  </nav>

                  {/* Close button anchored at the bottom of the rail so
                      it's reachable even when content scrolls. */}
                  <div style={{ marginTop: 'auto', padding: '8px 12px 12px' }}>
                    <button
                      type="button"
                      onClick={handleDiscard}
                      style={RAIL_CLOSE_STYLE}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }}
                    >
                      <X size={13} strokeWidth={2} />
                      <span>{dirty ? 'Discard & close' : 'Close'}</span>
                    </button>
                  </div>
                </aside>

                {/* RIGHT PANE — selected category */}
                <section style={PANE_STYLE}>
                  <header style={PANE_HEADER_STYLE}>
                    <div>
                      <div style={{
                        fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em',
                        color: 'var(--text-primary)',
                      }}>
                        {activeMeta.label}
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--text-secondary)', marginTop: 2,
                        letterSpacing: '-0.005em',
                      }}>
                        {activeMeta.hint}
                      </div>
                    </div>
                  </header>

                  <div style={PANE_BODY_STYLE}>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={active}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.20, ease: EASE_OUT_EXPO }}
                      >
                        {active === 'chat'     && <ChatPane     {...ctx} />}
                        {active === 'voice'    && <VoicePane    {...ctx} />}
                        {active === 'agentic'  && <AgenticPane  {...ctx} />}
                        {active === 'graphics' && <GraphicsPane {...ctx} />}
                        {active === 'about'    && <AboutPane    />}
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Sticky action bar — slides up from the bottom edge
                      when anything is dirty OR a save state is in play.
                      Echoes a Mac document "unsaved changes" pattern. */}
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
                          {saveState.kind === 'validating' ? 'Validating…'
                            : saveState.kind === 'saving' ? 'Saving…'
                            : 'Save changes'}
                        </button>
                      </motion.footer>
                    )}
                  </AnimatePresence>
                </section>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


// ---------------------------------------------------------------------
// Status chip — sits in the action bar, summarizes save/validation state.
// Special case: when saveState is 'saved' AND graphics changed, expands
// into a restart prompt (the only place where the chip can carry action).
// ---------------------------------------------------------------------

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
        <span>Saved. Restart Unclaw to apply graphics quality.</span>
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
        <span>{saveState.kind === 'validating' ? 'Verifying keys…' : 'Saving…'}</span>
      </span>
    );
  }
  if (validation && (validation.llm.ok || validation.tts.ok)) {
    return (
      <span style={{ ...CHIP_BASE, background: 'transparent', borderColor: 'rgba(255, 255, 255, 0.10)', color: 'var(--text-secondary)' }}>
        Last check: LLM {validation.llm.ok ? '✓' : '✗'} · TTS {validation.tts.ok ? '✓' : '✗'}
      </span>
    );
  }
  return null;
}


// ---------------------------------------------------------------------
// Chat pane
// ---------------------------------------------------------------------

function ChatPane({ draft, update, setProvider, liveModelsByProvider, isProbingKey }: PaneContext) {
  const info = getProvider(draft.llm_provider);
  return (
    <Group>
      <Row label="Provider" hint="Where chat completions come from.">
        <select
          value={draft.llm_provider ?? ''}
          onChange={(e) => setProvider((e.target.value || null) as LLMProviderId | null)}
          style={NATIVE_SELECT_STYLE}
        >
          <option value="">Pick a provider…</option>
          {LLM_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </Row>

      {info?.requiresApiKey && (
        <Row
          label="API key"
          hint={(
            <>
              Encrypted on this device.{' '}
              <LinkText href={info.signupUrl}>
                Get a key <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
              </LinkText>
            </>
          )}
        >
          <SecretInput
            value={draft.llm_api_key ?? ''}
            onChange={(v) => update('llm_api_key', v || null)}
            placeholder="paste your key"
          />
        </Row>
      )}

      {info && !info.dynamicModels && (() => {
        // Live-only model list. Soul returns the provider's own /v1/models
        // (filtered by filterChatModels) on the validate_keys probe; no
        // baked catalog. Until a key validates we render a disabled
        // dropdown with a helpful placeholder.
        const provider = info.id;
        const rawLive = liveModelsByProvider[provider] ?? [];
        const live = filterChatModels(provider, rawLive);
        const entries = live.map((rawId) => ({
          id: `${provider}:${rawId}`,
          label: rawId,
        }));
        const noKey = !draft.llm_api_key?.trim();
        const placeholder =
          noKey ? 'Enter your key first'
          : isProbingKey ? 'Verifying key…'
          : entries.length === 0 ? 'No chat models returned'
          : 'Pick a model…';
        return (
          <Row
            label="Model"
            hint={
              isProbingKey
                ? <InlineHint><Loader2 size={10} className="animate-spin" /> verifying…</InlineHint>
                : entries.length
                  ? <InlineHint>{entries.length} from provider</InlineHint>
                  : noKey
                    ? <InlineHint>after key validates</InlineHint>
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
          </Row>
        );
      })()}

      {info?.dynamicModels && (
        <Row label="Model" hint="Tag of a locally-pulled Ollama model.">
          <input
            type="text"
            placeholder="e.g. ollama:gemma3:4b-it-qat"
            value={draft.llm_model ?? ''}
            onChange={(e) => update('llm_model', e.target.value || null)}
            style={NATIVE_INPUT_STYLE}
          />
        </Row>
      )}
    </Group>
  );
}


// ---------------------------------------------------------------------
// Voice pane
// ---------------------------------------------------------------------

function VoicePane({ draft, update }: PaneContext) {
  return (
    <Group>
      <Row label="Provider" hint="Which TTS engine renders the character's voice.">
        <select
          value={draft.tts_provider}
          onChange={(e) => update('tts_provider', e.target.value as TtsProviderId)}
          style={NATIVE_SELECT_STYLE}
        >
          <option value="elevenlabs">ElevenLabs (cloud)</option>
          <option value="kokoro">Kokoro (local, open-weight)</option>
          <option value="qwen3">Qwen3-TTS (local, larger)</option>
        </select>
      </Row>

      {draft.tts_provider === 'elevenlabs' && (
        <>
          <Row
            label="ElevenLabs key"
            hint={
              <LinkText href="https://elevenlabs.io/app/settings/api-keys">
                Get a key <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
              </LinkText>
            }
          >
            <SecretInput
              value={draft.elevenlabs_api_key ?? ''}
              onChange={(v) => update('elevenlabs_api_key', v || null)}
              placeholder="paste your key"
            />
          </Row>
          <Row label="Voice ID" hint="Defaults to the Grace clone.">
            <input
              type="text"
              placeholder="zmcVlqmyk3Jpn5AVYcAL"
              value={draft.elevenlabs_voice ?? ''}
              onChange={(e) => update('elevenlabs_voice', e.target.value || null)}
              style={NATIVE_INPUT_STYLE}
            />
          </Row>
        </>
      )}

      {draft.tts_provider === 'kokoro' && (
        <Row label="Voice" hint="Voice file shipped with the Kokoro runtime.">
          <input
            type="text"
            placeholder="grace_kokoro"
            value={draft.kokoro_voice ?? ''}
            onChange={(e) => update('kokoro_voice', e.target.value || null)}
            style={NATIVE_INPUT_STYLE}
          />
        </Row>
      )}

      {draft.tts_provider === 'qwen3' && (
        <Row label="Voice" hint="Voice file shipped with the Qwen3-TTS runtime.">
          <input
            type="text"
            placeholder="grace_qwen3"
            value={draft.qwen3_voice ?? ''}
            onChange={(e) => update('qwen3_voice', e.target.value || null)}
            style={NATIVE_INPUT_STYLE}
          />
        </Row>
      )}
    </Group>
  );
}


// ---------------------------------------------------------------------
// Agentic pane
// ---------------------------------------------------------------------

function AgenticPane({ draft, update }: PaneContext) {
  const meta: Record<string, { label: string; url: string; keyPh: string; modelPh: string }> = {
    openai:    { label: 'OpenAI',    url: 'https://platform.openai.com/api-keys',         keyPh: 'sk-…',     modelPh: 'gpt-5.4-mini' },
    anthropic: { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', keyPh: 'sk-ant-…', modelPh: 'claude-opus-4-7' },
    gemini:    { label: 'Google',    url: 'https://aistudio.google.com/apikey',          keyPh: 'AIza…',    modelPh: 'gemini-2.5-flash' },
  };
  const m = meta[draft.agentic_provider] ?? meta.openai;
  return (
    <Group>
      <Row
        label="Enable escalation"
        hint="Lets the character hand off to a smarter model for tools, web search, and code."
      >
        <Toggle
          checked={draft.agentic_enabled}
          onChange={(v) => update('agentic_enabled', v)}
        />
      </Row>

      {draft.agentic_enabled && (
        <>
          <Row label="Backend" hint="Which provider runs the escalation tool loop.">
            <select
              value={draft.agentic_provider}
              onChange={(e) => update('agentic_provider', e.target.value as LLMProviderId)}
              style={NATIVE_SELECT_STYLE}
            >
              <option value="openai">OpenAI (Responses API)</option>
              <option value="anthropic">Anthropic Claude (Messages API)</option>
              <option value="gemini">Google Gemini (functionDeclarations)</option>
              <option value="ollama">Ollama (local, reuses chat model)</option>
            </select>
          </Row>

          {draft.agentic_provider !== 'ollama' && (
            <>
              <Row
                label={`${m.label} key`}
                hint={
                  <LinkText href={m.url}>
                    Get a key <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
                  </LinkText>
                }
              >
                <SecretInput
                  value={draft.agentic_api_key ?? ''}
                  onChange={(v) => update('agentic_api_key', v || null)}
                  placeholder={m.keyPh}
                />
              </Row>
              <Row label="Model" hint="Provider's model id (no `provider:` prefix needed).">
                <input
                  type="text"
                  placeholder={m.modelPh}
                  value={draft.agentic_model ?? ''}
                  onChange={(e) => update('agentic_model', e.target.value || null)}
                  style={NATIVE_INPUT_STYLE}
                />
              </Row>
            </>
          )}
        </>
      )}
    </Group>
  );
}


// ---------------------------------------------------------------------
// Graphics pane
// ---------------------------------------------------------------------

function GraphicsPane({ draft, update, graphicsChanged }: PaneContext) {
  // Card-style selector — three options, each a full row with a label,
  // description, and a check mark on the active one. Larger touch
  // surface than a select; matches iOS Settings' Display & Brightness
  // appearance picker.
  const options: { id: GraphicsQuality; label: string; copy: string }[] = [
    { id: 'low',    label: 'Low',    copy: 'Default. Renders at 50% backbuffer; fits laptops on battery.' },
    { id: 'medium', label: 'Medium', copy: '75% backbuffer + richer subsurface scattering.' },
    { id: 'high',   label: 'High',   copy: 'Full backbuffer + max shadow res. Desktop GPUs recommended.' },
  ];
  return (
    <Group>
      {options.map((opt) => {
        const active = draft.graphics_quality === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => update('graphics_quality', opt.id)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              width: '100%',
              padding: '14px 14px',
              borderRadius: 12,
              background: active ? 'rgba(196, 68, 68, 0.10)' : 'rgba(255, 255, 255, 0.025)',
              border: `1px solid ${active ? 'rgba(196, 68, 68, 0.32)' : 'var(--glass-border, rgba(255,255,255,0.10))'}`,
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              fontSize: 13,
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'background 180ms var(--ease-out-quart), border-color 180ms var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              if (active) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'var(--glass-border-focus, rgba(255,255,255,0.18))';
            }}
            onMouseLeave={(e) => {
              if (active) return;
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)';
              e.currentTarget.style.borderColor = 'var(--glass-border, rgba(255,255,255,0.10))';
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: 9,
              border: `1.5px solid ${active ? 'var(--accent)' : 'rgba(255, 255, 255, 0.18)'}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, marginTop: 1,
              transition: 'border-color 180ms var(--ease-out-quart)',
            }}>
              {active && (
                <span style={{
                  width: 9, height: 9, borderRadius: 5,
                  background: 'var(--accent)',
                }} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, letterSpacing: '-0.005em' }}>{opt.label}</div>
              <div style={{
                fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3,
                letterSpacing: '-0.005em', lineHeight: 1.45,
              }}>
                {opt.copy}
              </div>
            </div>
          </button>
        );
      })}
      {graphicsChanged && (
        <div style={{
          marginTop: 4, fontSize: 11.5, color: 'var(--accent)',
          letterSpacing: '0.01em',
        }}>
          Restart Unclaw to apply.
        </div>
      )}
    </Group>
  );
}


// ---------------------------------------------------------------------
// About pane
// ---------------------------------------------------------------------

function AboutPane() {
  // Pulls version from package.json via Vite's import.meta.env, with a
  // graceful fallback. Could surface more diagnostics later (soul build,
  // UE build, soulSupervisor pid) without changing the layout.
  const version = (import.meta as { env?: Record<string, string | undefined> })
    .env?.VITE_APP_VERSION ?? '1.0.10';
  return (
    <Group>
      <Row label="Version">
        <span style={{
          fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
          fontSize: 12.5, color: 'var(--text-primary)',
          letterSpacing: '0.02em',
        }}>
          {version}
        </span>
      </Row>
      <Row label="Made by">
        <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>Foton Labs</span>
      </Row>
      <Row label="Website">
        <LinkText href="https://unclaw.app">
          unclaw.app <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
        </LinkText>
      </Row>
      <Row label="Feedback">
        <LinkText href="mailto:hi@fotonlabs.com">
          hi@fotonlabs.com <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
        </LinkText>
      </Row>
    </Group>
  );
}


// ---------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------

function Group({ children }: { children: React.ReactNode }) {
  // List container with iOS-style internal hairline dividers between
  // rows. We rely on adjacent-sibling selectors via inline children
  // wrapping; the simpler approach is a top-border on every Row except
  // the first, which a Group naturally provides via `:first-child`.
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'rgba(255, 255, 255, 0.025)',
      border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.10))',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

function Row({
  label, hint, children,
}: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(160px, 220px) 1fr',
      gap: 16,
      alignItems: 'center',
      padding: '12px 16px',
      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: 'var(--text-primary)', letterSpacing: '-0.005em',
        }}>
          {label}
        </div>
        {hint && (
          <div style={{
            fontSize: 11, color: 'var(--text-secondary)', marginTop: 2,
            letterSpacing: '-0.005em', lineHeight: 1.45,
          }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: '100%', maxWidth: 280 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function InlineHint({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10.5, color: 'var(--text-secondary)',
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
        color: 'var(--accent, #c44444)',
        textDecoration: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {children}
    </a>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  // iOS-style switch. Same accent restraint as the rest of the panel —
  // the warm-red appears only on the on-state track. Off-state is the
  // neutral glass border.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 40, height: 24,
        borderRadius: 12,
        background: checked ? 'var(--accent, #c44444)' : 'rgba(255, 255, 255, 0.10)',
        border: '1px solid ' + (checked ? 'rgba(255, 200, 190, 0.35)' : 'rgba(255, 255, 255, 0.12)'),
        cursor: 'pointer',
        padding: 0,
        transition: 'background 220ms var(--ease-out-quart), border-color 220ms var(--ease-out-quart)',
      }}
    >
      <motion.span
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
        style={{
          position: 'absolute',
          top: 2, left: 2,
          width: 18, height: 18,
          borderRadius: 9,
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
        }}
      />
    </button>
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
          paddingRight: 34,
          fontFamily: reveal
            ? '"SF Mono", ui-monospace, Menlo, monospace'
            : 'inherit',
          fontSize: reveal ? 12 : 12.5,
          letterSpacing: reveal ? '0.01em' : '0.18em',
        }}
      />
      <button
        type="button"
        onClick={() => setReveal((v) => !v)}
        aria-label={reveal ? 'Hide key' : 'Show key'}
        title={reveal ? 'Hide key' : 'Show key'}
        style={{
          position: 'absolute',
          right: 6, top: '50%',
          transform: 'translateY(-50%)',
          width: 24, height: 24,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        {reveal ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
      </button>
    </div>
  );
}


// ---------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------

const SCRIM_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(8, 10, 14, 0.58)',
  backdropFilter: 'blur(20px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '36px 24px',
  fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
};

const SHELL_STYLE: React.CSSProperties = {
  position: 'relative',
  width: 'min(780px, 100%)',
  height: 'min(560px, calc(100vh - 72px))',
  borderRadius: 18,
  background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.72))',
  backdropFilter: 'blur(40px) saturate(1.7)',
  WebkitBackdropFilter: 'blur(40px) saturate(1.7)',
  border: '1px solid rgba(255, 255, 255, 0.10)',
  boxShadow: [
    '0 1px 0 rgba(255, 255, 255, 0.06) inset',
    '0 30px 70px -16px rgba(0, 0, 0, 0.62)',
    '0 14px 32px -10px rgba(0, 0, 0, 0.45)',
  ].join(', '),
  color: 'var(--text-primary, #f0f1f5)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '208px 1fr',
  height: '100%',
  minHeight: 0,
};

const RAIL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(0, 0, 0, 0.18)',
  borderRight: '1px solid rgba(255, 255, 255, 0.06)',
  minHeight: 0,
};

const RAIL_HEADER_STYLE: React.CSSProperties = {
  padding: '20px 20px 14px',
};

const RAIL_CLOSE_STYLE: React.CSSProperties = {
  width: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 8,
  padding: '8px 12px',
  background: 'transparent',
  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.10))',
  borderRadius: 8,
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  fontSize: 11.5,
  letterSpacing: '0.01em',
  cursor: 'pointer',
  transition: 'background 180ms var(--ease-out-quart), color 180ms var(--ease-out-quart)',
};

const PANE_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  position: 'relative',
};

const PANE_HEADER_STYLE: React.CSSProperties = {
  padding: '22px 26px 16px',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
};

const PANE_BODY_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '4px 26px 96px',
};

const ACTIONBAR_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0, right: 0, bottom: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 18px 14px',
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'linear-gradient(to top, rgba(20, 24, 32, 0.72), rgba(20, 24, 32, 0.30))',
  backdropFilter: 'blur(20px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
};

const NATIVE_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.10))',
  borderRadius: 8,
  color: 'var(--text-primary, #f0f1f5)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  outline: 'none',
  letterSpacing: '-0.005em',
  transition: 'border-color 0.16s var(--ease-out-quart), background 0.16s var(--ease-out-quart)',
};

const NATIVE_SELECT_STYLE: React.CSSProperties = {
  ...NATIVE_INPUT_STYLE,
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  cursor: 'pointer',
  // Custom chevron via background-image — kept inline so the file has
  // no CSS-side dependency on a class that might drift.
  backgroundImage:
    'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\'><path d=\'M1 1L5 5L9 1\' stroke=\'rgba(255,255,255,0.55)\' stroke-width=\'1.4\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: 28,
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
  transition: 'background 0.16s var(--ease-out-quart), border-color 0.16s var(--ease-out-quart)',
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
  boxShadow: '0 4px 14px -4px rgba(196, 68, 68, 0.55)',
};
