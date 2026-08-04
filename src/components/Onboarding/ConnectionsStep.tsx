// Step 4, fully optional. BYOK: chat provider + model dropdowns,
// provider API key (cloud only), ElevenLabs voice key, and a separate
// Gemini key for Google Search grounding. Saved encrypted on this
// device via Electron safeStorage and passed through to soul on each
// /chat call (services/soulChat.ts handles the read).
//
// Three chat providers are supported, mirroring soul's `_select_provider`:
//   * Groq (cloud), needs API key
//   * OpenAI (cloud), needs API key
//   * Ollama (local daemon), no API key, model list discovered live
//                             from soul's GET /providers endpoint
//
// Gemini stays in the schema but ONLY for Google Search grounding,
// not as a chat provider, its key gets its own field below.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye, EyeOff, Search, ExternalLink, Zap,
  AlertCircle, CheckCircle2, Loader2, Download,
} from 'lucide-react';
import { StepHeader } from './StepHeader';
import { Dropdown } from './Dropdown';
import {
  CliProviderStatusCard,
  KEYLESS_CLI_PROVIDERS,
} from '../CliProviderStatusCard';
import {
  LLM_PROVIDERS,
  getProvider,
  missingRequiredKeyFields,
  modelSupportsTools,
  modelSupportsVision,
  isOptimizedLocalModel,
  validateKeys,
  filterChatModels,
  thinkingCapabilityFor,
  thinkingOptionsFor,
  normalizeThinkingValue,
  type ApiKeysProfile,
  type AgenticProvider,
  type KeyValidationResult,
  type LLMProviderId,
  type KokoroMode,
  type ThinkingEffort,
  type ThinkingCapability,
  type TtsProviderId,
} from '../../services/apiKeys';
import { fetchOllamaModels, type SoulProviderModel } from '../../services/providers';
import {
  fetchKokoroStatus,
  startKokoroInstall,
  labelForVoice,
  RECOMMENDED_VOICES,
  type KokoroStatus,
} from '../../services/kokoro';
import {
  fetchQwen3Status,
  startQwen3Install,
  RECOMMENDED_VOICES as QWEN3_VOICES,
  labelForVoice as labelForQwen3Voice,
  phaseLabel as qwen3PhaseLabel,
  INSTALL_PHASES as QWEN3_PHASES,
  type Qwen3Status,
  type Qwen3InstallPhase,
} from '../../services/qwen3';

interface Props {
  values: ApiKeysProfile;
  onChange: (next: ApiKeysProfile) => void;
  /** True when the values currently in `values` have been verified
   *  against the live provider APIs. Wizard owns this state so it can
   *  invalidate on every keystroke that mutates a relevant field. */
  validated: boolean;
  /** Called with `true` after a successful Check Keys round, or with
   *  `false` to explicitly invalidate (e.g. failed re-check). */
  onValidatedChange: (valid: boolean) => void;
  /** Fires when a Check Keys round completes with `ok=false`, the
   *  Wizard uses this to dispatch the "something's off with your keys"
   *  pre-gen audio line. Only called on actual check completion, never
   *  on the field-edit reset that also clears validation. */
  onCheckFailed?: () => void;
  /** Live name from the Vibe step. Currently unused for voice labels
   *  (the cloned voice always reads "Grace") but kept for future
   *  agent-name customizations elsewhere on the step. */
  agentName?: string | null;
  /** Which half of the configuration to render. The wizard splits
   *  this step into two pages so the user picks LLM + agentic on
   *  page 1 and voice + verify on page 2. Default 'all' shows the
   *  full single-page layout (back-compat). */
  mode?: 'llm' | 'voice' | 'all';
}

const FIELD_BASE: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  width: '100%',
  letterSpacing: '-0.005em',
  transition: 'border-color 0.16s var(--ease-out-quart), box-shadow 0.16s var(--ease-out-quart), background 0.16s var(--ease-out-quart)',
};

function applyFocus(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border-focus)';
  el.style.background = 'rgba(255, 255, 255, 0.06)';
  el.style.boxShadow = '0 0 0 3px rgba(196, 68, 68, 0.10)';
}
function applyBlur(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border)';
  el.style.background = 'rgba(255, 255, 255, 0.04)';
  el.style.boxShadow = 'none';
}

export function ConnectionsStep({
  values,
  onChange,
  validated,
  onValidatedChange,
  onCheckFailed,
  agentName,
  mode = 'all',
}: Props) {
  const showLlm = mode === 'all' || mode === 'llm';
  const showVoice = mode === 'all' || mode === 'voice';
  // Verify panel is on both 'llm' and 'voice' pages now (and the
  // legacy 'all' mode). Each page verifies its own scope:
  //   * llm page  → LLM provider key (and agentic key when on)
  //   * voice page → TTS provider readiness (key or local install)
  //   * all       → both, single panel
  const showVerify = mode === 'all' || mode === 'llm' || mode === 'voice';
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showElevenKey, setShowElevenKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  // Ollama models come from soul's /providers (live /api/tags scan),
  // not the static catalog, `null` = not fetched yet, `[]` = soul
  // unreachable or no models pulled.
  const [ollamaModels, setOllamaModels] = useState<SoulProviderModel[] | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);

  // Transport-level probe failure (soul offline, etc.), surfaced in the
  // status rail. Distinct from a provider rejecting a key.
  const [probeError, setProbeError] = useState<string | null>(null);
  // Fire the "keys look wrong" voice line at most once per visit; the
  // passive probe would otherwise nag on every keystroke of a bad key.
  const failLatchRef = useRef(false);

  // Live model lists per provider, populated from soul's /validate_keys
  // probe (which now returns the provider's /v1/models output). Lets the
  // dropdown swap from the baked catalog to the user's actual accessible
  // models the moment their key validates, same pattern SettingsPanel
  // uses. Keyed by provider so toggling providers preserves any list the
  // user already verified this session.
  const [liveModelsByProvider, setLiveModelsByProvider] = useState<
    Partial<Record<LLMProviderId, string[]>>
  >({});

  // Latest validation outcome (chat + tts + agentic + gemini_search),
  // refreshed on auto-probes as well as the explicit Check button.
  // Drives the CliProviderStatusCard rendering for keyless CLI
  // providers on both the chat side (LLM section) and agentic side
  // (AgenticSection). Independent of `check.result` so the card stays
  // current even after the user opens the step without pressing Check.
  const [liveValidation, setLiveValidation] = useState<KeyValidationResult | null>(null);
  // Accumulated per-model thinking capabilities, merged from every
  // validation's `thinking_caps` (chat + agentic). Keyed by bare model id.
  // Drives the capability-gated thinking selectors below without the
  // frontend hardcoding any model lists. See soul/providers/_thinking.py.
  const [thinkingCapsByModel, setThinkingCapsByModel] = useState<
    Record<string, ThinkingCapability>
  >({});
  const mergeThinkingCaps = (res: KeyValidationResult) => {
    const add = {
      ...(res.llm?.thinking_caps ?? {}),
      ...(res.agentic?.thinking_caps ?? {}),
    };
    if (Object.keys(add).length) {
      setThinkingCapsByModel((prev) => ({ ...prev, ...add }));
    }
  };
  // True while ANY auto-probe is in flight (chat-side OR agentic-side).
  // The card shows "Checking for X" during this window so the user sees
  // motion instead of a stale state when switching providers.
  const [isAutoProbing, setIsAutoProbing] = useState(false);

  const provider = getProvider(values.llm_provider);

  // THE probe. Verification here is ambient: there is no Verify button.
  // Any setup-relevant edit schedules one debounced /validate_keys call
  // (the endpoint probes every scope in one round trip anyway), and the
  // status rail + the Wizard's finish gate derive from the result. This
  // replaced two scoped auto-probes plus two per-page "Verify" buttons
  // that all hit the same endpoint; the user was pressing a button to
  // learn something the app already knew.
  //
  // Keyless CLI providers (claude-code, gemini-cli, codex) probe on
  // selection alone; keyed providers wait for a key; Ollama is probed
  // separately via fetchOllamaModels (a local daemon scan, not a key).
  const llmConfigured =
    !!values.llm_provider && values.llm_provider !== 'ollama'
    && (KEYLESS_CLI_PROVIDERS.has(values.llm_provider) || !!(values.llm_api_key || '').trim());
  const agenticConfigured =
    values.agentic_enabled
    && !!values.agentic_provider && values.agentic_provider !== 'ollama'
    && (KEYLESS_CLI_PROVIDERS.has(values.agentic_provider) || !!(values.agentic_api_key || '').trim());
  const voiceConfigured =
    values.tts_provider === 'elevenlabs'
      ? !!(values.elevenlabs_api_key || '').trim()
      : !!values.tts_provider;
  const shouldProbe =
    (showLlm && (llmConfigured || agenticConfigured)) || (showVoice && voiceConfigured);

  useEffect(() => {
    if (!shouldProbe) return;
    const t = setTimeout(() => {
      setIsAutoProbing(true);
      void validateKeys(values).then((res) => {
        mergeThinkingCaps(res);
        setProbeError(null);
        // Live model lists for whichever providers answered with one.
        const pid = values.llm_provider;
        if (pid && res.llm.ok && res.llm.models?.length) {
          setLiveModelsByProvider((prev) => ({ ...prev, [pid]: res.llm.models }));
        }
        const aprov = values.agentic_provider;
        const agenticModels = (res.agentic as { models?: string[] } | undefined)?.models;
        if (aprov && res.agentic?.ok && agenticModels?.length) {
          setLiveModelsByProvider((prev) => ({ ...prev, [aprov]: agenticModels }));
        }
        setLiveValidation(res);
      }).catch((err) => {
        setProbeError(err instanceof Error ? err.message : 'Could not reach the local engine');
      }).finally(() => setIsAutoProbing(false));
    }, 700);
    return () => clearTimeout(t);
    // The union of setup-relevant fields for both pages; on a given page
    // the other page's fields never change, so no spurious fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values.llm_provider, values.llm_api_key,
    values.agentic_enabled, values.agentic_provider, values.agentic_api_key,
    values.grounding_search_enabled, values.gemini_search_api_key,
    values.tts_provider, values.elevenlabs_api_key,
    values.kokoro_mode, values.kokoro_endpoint,
  ]);

  // Fetch Ollama models when the user picks the Ollama provider. If
  // the first attempt returns nothing (race with soul's reachable
  // probe, daemon briefly slow, etc.), retry once after 800ms before
  // giving up, soul's startup probe takes ~300ms and the cache fills
  // a hair later. Without this retry the wizard locks into the "No
  // Ollama models found" placeholder even when models ARE installed.
  // Best-effort throughout: if soul stays offline we render the empty
  // state and the dropdown invites the user to pull a model.
  useEffect(() => {
    if (provider?.id !== 'ollama') return;
    let cancelled = false;
    setOllamaLoading(true);
    const attempt = async (): Promise<void> => {
      const list = await fetchOllamaModels();
      if (cancelled) return;
      if (list.length > 0) {
        setOllamaModels(list);
        return;
      }
      // First attempt empty, wait + retry once. Avoids the empty
      // state when the only cause was timing.
      await new Promise(r => setTimeout(r, 800));
      if (cancelled) return;
      const retry = await fetchOllamaModels();
      if (cancelled) return;
      setOllamaModels(retry);
    };
    attempt().finally(() => { if (!cancelled) setOllamaLoading(false); });
    return () => { cancelled = true; };
  }, [provider?.id]);

  // Model dropdown options. Cloud providers use the static catalog; Ollama
  // uses whatever soul reports as locally installed.
  const models = useMemo(() => {
    if (provider?.dynamicModels) {
      return (ollamaModels ?? []).map((m) => {
        // Stack the chips the model deserves. "Optimized" means we've
        // validated tool calling + thinking + size floor end-to-end.
        // "Vision" means the family accepts image input.
        const badges: string[] = [];
        if (isOptimizedLocalModel(m.id)) badges.push('Optimized');
        if (modelSupportsVision(m.id))   badges.push('Vision');
        return {
          id: m.id,
          label: m.tag ?? m.label ?? m.id,
          hint: m.size_gb ? `${m.size_gb} GB` : undefined,
          badges: badges.length > 0 ? badges : undefined,
        };
      });
    }
    // Live-only model list. No baked fallback, once the user's key
    // validates, soul returns the provider's own /v1/models output and
    // we render it directly (filtered to chat-capable ids). Empty list
    // until validation lands → the dropdown stays disabled with a
    // helpful placeholder downstream.
    const pid = provider?.id;
    if (!pid) return [];
    const rawLive = liveModelsByProvider[pid] ?? [];
    return filterChatModels(pid, rawLive).map((rawId) => {
      const fullId = `${pid}:${rawId}`;
      const badges: string[] = [];
      if (modelSupportsVision(fullId)) badges.push('Vision');
      return {
        id: fullId,
        label: rawId,
        hint: undefined as string | undefined,
        badges: badges.length > 0 ? badges : undefined,
      };
    });
  }, [provider, ollamaModels, liveModelsByProvider]);

  const setProvider = (id: LLMProviderId | '') => {
    if (!id) {
      // No provider → chat has no tools, so local agentic can't run.
      // Coerce agentic_provider back to cloud OpenAI.
      onChange({
        ...values,
        llm_provider: null,
        llm_model: null,
        agentic_provider: 'openai',
      });
      return;
    }
    const next = getProvider(id);
    // Snap the model to the first option for the new provider so the
    // {provider, model} pair stays consistent. Ollama starts blank
    // until the live fetch resolves; setOllamaLoading drives the UI.
    let nextModel: string | null = null;
    if (next?.dynamicModels) {
      nextModel = ollamaModels?.[0]?.id ?? null;
    } else {
      nextModel = next?.models[0]?.id ?? null;
    }
    // If the new {provider, model} pair can't host local agentic
    // (cloud chat, or sub-1B / non-tools-family local), coerce the
    // agentic backend back to cloud so the wizard can't end up in an
    // unrunnable state where local-agentic is selected but chat
    // doesn't support tools.
    const canRunLocal = id === 'ollama' && modelSupportsTools(nextModel);
    onChange({
      ...values,
      llm_provider: id,
      llm_model: nextModel,
      // Wipe the old key when switching to a no-key provider, leaving
      // it on disk would be surprising.
      llm_api_key: next?.requiresApiKey ? values.llm_api_key : null,
      agentic_provider: canRunLocal ? values.agentic_provider : 'openai',
    });
  };

  const setModel = (modelId: string) => {
    const next = modelId || null;
    // Same coercion as setProvider: if the new model can't host local
    // agentic, flip agentic_provider back to cloud.
    const canRunLocal = values.llm_provider === 'ollama' && modelSupportsTools(next);
    onChange({
      ...values,
      llm_model: next,
      agentic_provider: canRunLocal ? values.agentic_provider : 'openai',
    });
  };

  const setLlmKey = (key: string) => {
    onChange({ ...values, llm_api_key: key || null });
  };

  const setElevenKey = (key: string) => {
    onChange({ ...values, elevenlabs_api_key: key || null });
  };

  const setGeminiSearchKey = (key: string) => {
    onChange({ ...values, gemini_search_api_key: key || null });
  };

  const setGrounding = (enabled: boolean) => {
    onChange({ ...values, grounding_search_enabled: enabled });
  };

  // Grounding now stands on its own Gemini key (separate from the chat
  // provider), so the toggle is "active" whenever a key is set rather
  // than tied to the active LLM provider.
  const groundingActive = !!values.gemini_search_api_key;

  // When chat provider IS Gemini (API or CLI), Google Search grounding
  // is already part of the chat response natively, no separate
  // gemini_search_api_key needed. Replace the field + toggle with a
  // short notice; server-side `_effective_gemini_search_key` reuses the
  // llm_api_key so non-Gemini agentic providers still get web_search.
  const isGeminiNativeChat = (
    values.llm_provider === 'gemini'
    || values.llm_provider === 'gemini-cli'
  );

  // Live validation: which required keys are still missing? Drives the
  // inline "you still need…" panel below + the Wizard's Finish gate.
  // Recomputed on every keystroke (cheap; just a few field reads).
  // Filtered by mode so the LLM page only flags LLM/agentic gaps and
  // the voice page only flags voice gaps.
  const allMissing = missingRequiredKeyFields(values);
  const missing = allMissing.filter((field) => {
    if (mode === 'all') return true;
    // Any "X key for agentic" string from missingRequiredKeyFields
    // (label varies per backend: OpenAI / Anthropic / Gemini / DeepSeek).
    const isAgenticKeyField = field.endsWith(' key for agentic');
    const isLlmField = field === 'LLM provider'
      || field === 'Model'
      || field === 'Agentic model'
      || isAgenticKeyField
      || field === 'Tools-capable Ollama chat model'
      || field === 'Gemini API key for grounded search'
      || (field.endsWith(' API key') && field !== 'ElevenLabs API key');
    return mode === 'llm' ? isLlmField : !isLlmField;
  });

  // Any setup-relevant edit makes the last probe stale: drop it (the rail
  // falls back to "checking") so a half-typed key can never ride a green
  // state into Finish during the debounce window. The probe effect above
  // repopulates within ~a second.
  const scopeFields = mode === 'llm' ? [
    values.llm_provider,
    values.llm_model,
    values.llm_api_key,
    values.agentic_enabled,
    values.agentic_provider,
    values.agentic_use_same_as_chat,
    values.agentic_model,
    values.agentic_api_key,
    values.grounding_search_enabled,
    values.gemini_search_api_key,
  ] : mode === 'voice' ? [
    values.elevenlabs_api_key,
    values.tts_provider,
    values.kokoro_mode,
    values.kokoro_endpoint,
  ] : [
    values.llm_provider,
    values.llm_model,
    values.llm_api_key,
    values.elevenlabs_api_key,
    values.tts_provider,
    values.kokoro_mode,
    values.kokoro_endpoint,
    values.agentic_enabled,
    values.agentic_provider,
    values.agentic_use_same_as_chat,
    values.agentic_model,
    values.agentic_api_key,
    values.grounding_search_enabled,
    values.gemini_search_api_key,
  ];
  useEffect(() => {
    setLiveValidation(null);
    setProbeError(null);
    if (validated) onValidatedChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, scopeFields);

  // The finish gate, derived continuously from the latest probe. Same
  // pass criteria the old Verify button used; the only change is WHO
  // presses the button (nobody).
  const llmOk = !!liveValidation?.llm?.ok
    && (!values.agentic_enabled || (liveValidation?.agentic?.ok ?? false))
    && (!values.grounding_search_enabled || (liveValidation?.gemini_search?.ok ?? false));
  const voiceOk = liveValidation?.tts?.ok ?? liveValidation?.elevenlabs?.ok ?? false;
  const scopeOk = mode === 'llm' ? llmOk
                : mode === 'voice' ? voiceOk
                : (llmOk && voiceOk);
  useEffect(() => {
    if (scopeOk !== validated) onValidatedChange(scopeOk);
    // A definitive failure (probe answered, scope fully configured, not
    // ok) gets the spoken nudge once per visit.
    if (!scopeOk && liveValidation && shouldProbe && !failLatchRef.current) {
      failLatchRef.current = true;
      onCheckFailed?.();
    }
    if (scopeOk) failLatchRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeOk, liveValidation]);

  // Header copy keyed off mode, same panel reused on both wizard
  // pages, with whatever's relevant to that page.
  const headerTitle = mode === 'voice'
    ? 'Pick a voice.'
    : mode === 'llm'
      ? 'Pick a chat model.'
      : 'Bring your own keys.';
  const headerSubtitle = mode === 'voice'
    ? 'Voice provider for the assistant. Local options run on your GPU; ElevenLabs is cloud.'
    : mode === 'llm'
      ? 'Provider and model for chat. Anything stored is encrypted on this device.'
      : 'Pick a chat provider and a voice. Anything stored is encrypted on this device.';

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      <div style={{ width: 180, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader
          title={headerTitle}
          subtitle={headerSubtitle}
        />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {showLlm && (
        <>
        {/* Provider + Model on one row. Model collapses to the placeholder
            when no provider is selected. */}
        <div style={{ display: 'flex', gap: 12 }}>
          <FieldLabel
            text="LLM provider"
            style={{ flex: 1 }}
          >
            <Dropdown
              value={values.llm_provider ?? ''}
              onChange={(v) => setProvider((v as LLMProviderId) || '')}
              placeholder="Choose…"
              options={LLM_PROVIDERS.map((p) => ({ id: p.id, label: p.label }))}
            />
          </FieldLabel>

          <FieldLabel
            text="Model"
            style={{ flex: 1.2 }}
            trailing={provider?.dynamicModels && ollamaLoading ? (
              <span style={{
                fontSize: 10,
                color: 'var(--text-secondary)',
                fontWeight: 500,
                letterSpacing: '0.04em',
              }}>scanning…</span>
            ) : null}
          >
            <Dropdown
              value={values.llm_model ?? ''}
              onChange={setModel}
              disabled={!provider || models.length === 0}
              placeholder={
                !provider
                  ? 'Pick a provider first'
                  : provider.dynamicModels && models.length === 0
                    ? (ollamaLoading
                        ? 'Looking for installed models…'
                        : 'No Ollama models found, run `ollama pull <name>`')
                    : provider.requiresApiKey && !values.llm_api_key?.trim()
                      ? 'Enter your key first'
                      : models.length === 0
                        ? (provider.id === 'claude-code'
                            ? 'Sign in via Terminal first'
                            : 'Verifying key…')
                        : 'Choose a model'
              }
              options={models.map((m) => ({
                id: m.id,
                label: m.label,
                hint: m.hint,
                badges: (m as { badges?: ReadonlyArray<string> }).badges,
              }))}
              searchable
            />
          </FieldLabel>
        </div>

        {/* API key, only for cloud providers. Ollama runs locally on
            the user's machine via the daemon at localhost:11434, so no
            key is needed. */}
        {provider?.requiresApiKey && (
          <FieldLabel text={`${provider.label} API key`}>
            <SecretInput
              value={values.llm_api_key ?? ''}
              onChange={setLlmKey}
              placeholder={`Paste your ${provider.label} key`}
              visible={showLlmKey}
              onToggleVisible={() => setShowLlmKey((v) => !v)}
              autoComplete="off"
            />
          </FieldLabel>
        )}

        {/* Chat thinking lever, capability-gated by the selected model
            (graded -> Off/Low/Medium/High, binary -> Off/On, none ->
            hidden). Caps come from soul's _thinking resolver via
            /validate_keys, so no model lists are hardcoded here. Default
            'none' keeps conversational chat snappy; the agentic tier has
            its own lever inside AgenticSection. */}
        {(() => {
          const cap = thinkingCapabilityFor(values.llm_model, thinkingCapsByModel);
          if (!cap) return null;
          return (
            <FieldLabel text="Chat thinking">
              <Dropdown
                value={normalizeThinkingValue(cap, values.chat_thinking_effort)}
                onChange={(v) => onChange({
                  ...values,
                  chat_thinking_effort: (v as ThinkingEffort) || 'none',
                })}
                options={thinkingOptionsFor(cap)}
              />
            </FieldLabel>
          );
        })()}

        <AgenticSection
          values={values}
          onChange={onChange}
          liveModelsByProvider={liveModelsByProvider}
          liveValidation={liveValidation}
          isAutoProbing={isAutoProbing}
          thinkingCapsByModel={thinkingCapsByModel}
        />

        {/* Gemini Search key, sits alongside the chat provider since
            it's the path that turns on live web grounding. Only used
            when grounding is enabled; the chat path stays whatever the
            user picked above. Hidden entirely when the chat provider
            IS Gemini (chat model grounds responses natively via Google
            Search; a separate key would be redundant). */}
        {isGeminiNativeChat ? (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(255, 255, 255, 0.025)',
              border: '1px solid var(--glass-border)',
              borderRadius: 10,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <Search
              size={11}
              strokeWidth={2}
              aria-hidden
              style={{ opacity: 0.7, marginTop: 3, flexShrink: 0 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                Google Search grounding (built in)
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  letterSpacing: '0.005em',
                  lineHeight: 1.45,
                }}
              >
                Your Gemini chat provider grounds replies in live web
                sources natively, no separate key needed.
              </span>
            </div>
          </div>
        ) : (
          <>
            <FieldLabel text="Gemini API key (Google Search, optional)">
              <SecretInput
                value={values.gemini_search_api_key ?? ''}
                onChange={setGeminiSearchKey}
                placeholder="AIza…"
                visible={showGeminiKey}
                onToggleVisible={() => setShowGeminiKey((v) => !v)}
                autoComplete="off"
              />
            </FieldLabel>

            <Toggle
              value={values.grounding_search_enabled}
              onChange={setGrounding}
              icon={<Search size={11} strokeWidth={2} aria-hidden style={{ opacity: 0.7 }} />}
              title="Google Search grounding"
              helper={
                groundingActive
                  ? 'When the assistant needs live data, it cites web sources via Gemini. Free tier: 500 grounded requests/day.'
                  : 'Add a Gemini key above to enable. Lets the assistant cite live web sources for time-sensitive questions.'
              }
              dimWhen={!groundingActive}
            />
          </>
        )}
        </>
        )}

        {showVoice && (
        <>
        <VoiceSection
          values={values}
          onChange={onChange}
          showElevenKey={showElevenKey}
          onToggleElevenKey={() => setShowElevenKey((v) => !v)}
          agentName={agentName}
        />
        </>
        )}

        {/* Check-keys bar. Three states:
              1. Missing required fields    -> show the Required panel.
              2. Fields complete, not yet
                 verified                   -> show "Check keys" button.
              3. Verification result        -> show per-row outcomes
                                                + a "Check again" button
                                                so the user can re-verify
                                                after editing.
            The Wizard's Finish button is gated on `validated` (set when
            both rows come back ok), so this block is the user's only
            path forward once they've reached this step. */}
        {showVerify && (missing.length > 0 ? (
          <div
            role="status"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              background: 'rgba(196, 68, 68, 0.06)',
              border: '1px solid rgba(196, 68, 68, 0.22)',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}
          >
            <AlertCircle
              size={14}
              strokeWidth={2}
              aria-hidden
              style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }}
            />
            <span>
              <strong style={{ fontWeight: 600 }}>Required to finish:</strong>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>
                {missing.join(' · ')}
              </span>
            </span>
          </div>
        ) : (
          <StatusRail
            scope={mode}
            probing={isAutoProbing}
            probeError={probeError}
            result={liveValidation}
            providerLabel={provider?.label ?? 'Chat'}
            agenticEnabled={values.agentic_enabled}
            agenticProvider={values.agentic_provider}
            groundingEnabled={values.grounding_search_enabled}
            ttsProvider={values.tts_provider}
            anythingConfigured={shouldProbe}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Status rail. The passive replacement for the old per-page "Verify"
// buttons: one quiet row per configured connection, each going green as
// the background probe confirms it. Nothing here is clickable because
// nothing here needs the user; the probe runs itself on every edit.
// ---------------------------------------------------------------------

type RailState = 'checking' | 'ok' | 'fail' | 'idle';

function StatusRail({
  scope, probing, probeError, result, providerLabel,
  agenticEnabled, agenticProvider, groundingEnabled, ttsProvider,
  anythingConfigured,
}: {
  scope: 'llm' | 'voice' | 'all';
  probing: boolean;
  probeError: string | null;
  result: KeyValidationResult | null;
  providerLabel: string;
  agenticEnabled: boolean;
  agenticProvider: AgenticProvider;
  groundingEnabled: boolean;
  ttsProvider?: string;
  anythingConfigured: boolean;
}) {
  type Row = { label: string; state: RailState; detail?: string };
  const rowFor = (
    label: string,
    outcome: { ok: boolean; error?: string } | undefined | null,
  ): Row => {
    if (outcome) {
      return outcome.ok
        ? { label, state: 'ok' }
        : { label, state: 'fail', detail: outcome.error ?? 'not working yet' };
    }
    return probing
      ? { label, state: 'checking' }
      : { label, state: 'idle' };
  };

  const rows: Row[] = [];
  if (scope !== 'voice') {
    rows.push(rowFor(providerLabel, result?.llm));
    if (agenticEnabled) {
      rows.push(rowFor(
        agenticProvider === 'ollama' ? 'Agentic (Ollama)' : 'Agentic',
        result?.agentic,
      ));
    }
    if (groundingEnabled) {
      rows.push(rowFor('Web search (Gemini)', result?.gemini_search));
    }
  }
  if (scope !== 'llm') {
    const voiceLabel =
      ttsProvider === 'kokoro' ? 'Kokoro'
      : ttsProvider === 'supertonic' ? 'Supertonic'
      : ttsProvider === 'qwen3' ? 'Qwen3'
      : 'ElevenLabs';
    rows.push(rowFor(voiceLabel, result?.tts ?? result?.elevenlabs));
  }

  const allOk = rows.length > 0 && rows.every((r) => r.state === 'ok');
  const anyFail = !!probeError || rows.some((r) => r.state === 'fail');

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '10px 14px',
        background: allOk
          ? 'rgba(96, 178, 96, 0.06)'
          : 'rgba(255, 255, 255, 0.025)',
        border: allOk
          ? '1px solid rgba(96, 178, 96, 0.30)'
          : anyFail
            ? '1px solid rgba(196, 68, 68, 0.30)'
            : '1px solid var(--glass-border)',
        borderRadius: 10,
        transition: 'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
      }}
    >
      {probeError && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4, padding: '4px 0',
        }}>
          <AlertCircle size={13} strokeWidth={2} aria-hidden
            style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
          <span>{probeError}</span>
        </div>
      )}
      {!anythingConfigured && rows.every((r) => r.state === 'idle') ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
          Connections check themselves as you fill this in.
        </div>
      ) : rows.map((r) => (
        <div
          key={r.label}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4, padding: '4px 0',
          }}
        >
          {r.state === 'ok' ? (
            <CheckCircle2 size={13} strokeWidth={2} aria-hidden
              style={{ flexShrink: 0, marginTop: 1, color: '#7fc97f' }} />
          ) : r.state === 'fail' ? (
            <AlertCircle size={13} strokeWidth={2} aria-hidden
              style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
          ) : r.state === 'checking' ? (
            <Loader2 size={13} strokeWidth={2.2} aria-hidden
              style={{ flexShrink: 0, marginTop: 1, color: 'var(--text-secondary)', animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <span aria-hidden style={{
              flexShrink: 0, width: 13, height: 13, marginTop: 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.22)' }} />
            </span>
          )}
          <span style={{ minWidth: 0 }}>
            <strong style={{ fontWeight: 600 }}>{r.label}</strong>
            <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
              {r.state === 'ok' ? 'connected'
                : r.state === 'fail' ? (r.detail ?? 'not working yet')
                : r.state === 'checking' ? 'checking\u2026'
                : 'waiting for details'}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Field building blocks
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Voice section, TTS provider picker.
//
// Two top-level options:
//   * ElevenLabs (cloud)  , needs a BYOK API key, ~real-time, paid
//   * Kokoro (local, free), open-weight 82M-param model; either soul
//                            downloads + runs it in-process, OR the
//                            user has Kokoro running elsewhere and
//                            hands us a URL.
//
// When Kokoro is picked, a sub-radio toggles between:
//   * Recommended , soul downloads model + voices on demand (~325MB
//                    one-time), runs inference locally; no setup beyond
//                    a single Install button.
//   * Custom      , user provides an OpenAI-compat endpoint URL
//                    (e.g. their own kokoro-fastapi). soul forwards
//                    every TTS call to that server.
//
// Voice picker lists Kokoro's pre-trained voices. Polled live from the
// soul-side install state; falls back to a curated list while loading.
// ---------------------------------------------------------------------

function VoiceSection({
  values,
  onChange,
  showElevenKey,
  onToggleElevenKey,
  agentName,
}: {
  values: ApiKeysProfile;
  onChange: (next: ApiKeysProfile) => void;
  showElevenKey: boolean;
  onToggleElevenKey: () => void;
  /** User's chosen assistant name from the Vibe step. Drives the
   *  `grace_kokoro` label ("Aria (offline)" instead of "Grace"). */
  agentName?: string | null;
}) {
  // Kokoro install snapshot from soul. Refetched on mount + while
  // a download is in flight; cached otherwise. Null until the first
  // fetch returns (or stays null when soul is unreachable).
  const [kokoro, setKokoro] = useState<KokoroStatus | null>(null);
  const pollRef = useRef<number | null>(null);

  // Poll loop, only active when Kokoro is the chosen provider AND
  // we're in recommended mode. Custom-endpoint users don't need
  // install state. The interval is rebuilt whenever those conditions
  // change so a switch from custom→recommended kicks off a fresh
  // status fetch.
  useEffect(() => {
    if (values.tts_provider !== 'kokoro') return;
    if (values.kokoro_mode !== 'recommended') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await fetchKokoroStatus();
        if (cancelled) return;
        setKokoro(s);
        if (s.state === 'downloading') {
          pollRef.current = window.setTimeout(tick, 1500);
        }
      } catch {
        // Soul might still be loading models; try again.
        if (!cancelled) pollRef.current = window.setTimeout(tick, 3000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollRef.current !== null) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [values.tts_provider, values.kokoro_mode]);

  const handleInstallClick = async () => {
    try {
      const s = await startKokoroInstall();
      setKokoro(s);
      // Kick the polling loop immediately so the progress bar moves
      // even on the first 1.5 s tick after Install was clicked.
      const tick = async () => {
        try {
          const next = await fetchKokoroStatus();
          setKokoro(next);
          if (next.state === 'downloading') {
            pollRef.current = window.setTimeout(tick, 1000);
          }
        } catch { /* transient, outer effect will retry */ }
      };
      void tick();
    } catch (err) {
      console.warn('[kokoro] install failed', err);
    }
  };

  const setTtsProvider = (id: TtsProviderId) => {
    onChange({ ...values, tts_provider: id });
  };
  const setKokoroMode = (m: KokoroMode) => {
    onChange({ ...values, kokoro_mode: m });
  };
  const setKokoroEndpoint = (url: string) => {
    onChange({ ...values, kokoro_endpoint: url || null });
  };
  const setKokoroVoice = (id: string) => {
    onChange({ ...values, kokoro_voice: id || null });
  };

  // Voice options. Soul-reported installed voices first; otherwise
  // the curated catalog so the dropdown isn't empty before install
  // completes. The cloned Grace voice always reads "Grace" regardless
  // of the user's chosen agent name, the agent_name customization
  // is for the chat persona, not the underlying voice asset.
  const voiceOptions = useMemo(() => {
    const ids = (kokoro?.voices && kokoro.voices.length > 0)
      ? kokoro.voices
      : RECOMMENDED_VOICES.map((v) => v.id);
    return ids.map((id) => ({
      id,
      label: id === 'grace_kokoro' ? 'Grace' : labelForVoice(id),
    }));
  }, [kokoro?.voices]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Provider picker, single row at the top of the section. */}
      <FieldLabel text="Voice provider">
        <Dropdown
          value={values.tts_provider}
          onChange={(v) => setTtsProvider(v as TtsProviderId)}
          options={[
            { id: 'elevenlabs', label: 'ElevenLabs' },
            { id: 'supertonic', label: 'Supertonic-3' },
            { id: 'kokoro',     label: 'Kokoro' },
            { id: 'qwen3',      label: 'Qwen3 (local)' },
          ]}
        />
      </FieldLabel>

      {/* ElevenLabs branch, original BYOK key field. */}
      {values.tts_provider === 'elevenlabs' && (
        <FieldLabel
          text="ElevenLabs API key"
        >
          <SecretInput
            value={values.elevenlabs_api_key ?? ''}
            onChange={(v) => onChange({ ...values, elevenlabs_api_key: v || null })}
            placeholder="sk_…"
            visible={showElevenKey}
            onToggleVisible={onToggleElevenKey}
            autoComplete="off"
          />
        </FieldLabel>
      )}

      {/* Supertonic branch: built-in voices + Grace clone (auto-fetched
          from R2 on first synth via supertonic_runtime._EXTRA_VOICES).
          No install panel — the ~290 KB voice JSON downloads lazily
          inside the first chat turn. */}
      {values.tts_provider === 'supertonic' && (
        <FieldLabel text="Voice">
          <Dropdown
            value={values.supertonic_voice ?? 'grace'}
            onChange={(id) =>
              onChange({ ...values, supertonic_voice: id || null })}
            options={[
              { id: 'grace', label: 'Grace (cloned)' },
              { id: 'F1', label: 'F1 (built-in)' },
              { id: 'F2', label: 'F2 (built-in)' },
              { id: 'F3', label: 'F3 (built-in)' },
              { id: 'F4', label: 'F4 (built-in)' },
              { id: 'F5', label: 'F5 (built-in)' },
              { id: 'M1', label: 'M1 (built-in)' },
              { id: 'M2', label: 'M2 (built-in)' },
              { id: 'M3', label: 'M3 (built-in)' },
              { id: 'M4', label: 'M4 (built-in)' },
              { id: 'M5', label: 'M5 (built-in)' },
            ]}
          />
        </FieldLabel>
      )}

      {/* Kokoro branch, mode picker + install panel / endpoint
          input + voice dropdown. */}
      {values.tts_provider === 'kokoro' && (
        <>
          <KokoroModePicker
            mode={values.kokoro_mode}
            onChange={setKokoroMode}
          />
          {values.kokoro_mode === 'recommended' && (
            <KokoroInstallPanel
              status={kokoro}
              onInstall={handleInstallClick}
            />
          )}
          {values.kokoro_mode === 'custom' && (
            <FieldLabel
              text="Kokoro endpoint URL"
            >
              <input
                type="url"
                value={values.kokoro_endpoint ?? ''}
                onChange={(e) => setKokoroEndpoint(e.target.value)}
                placeholder="http://localhost:8880"
                spellCheck={false}
                autoComplete="off"
                style={FIELD_BASE}
                onFocus={(e) => applyFocus(e.target)}
                onBlur={(e) => applyBlur(e.target)}
              />
            </FieldLabel>
          )}
          <FieldLabel text="Voice">
            <Dropdown
              value={values.kokoro_voice ?? ''}
              onChange={setKokoroVoice}
              placeholder="Pick a voice"
              options={voiceOptions}
            />
          </FieldLabel>
        </>
      )}

      {/* Qwen3 branch, install panel (multi-stage) + voice dropdown.
          No mode picker since v1 is local-only; we may add a custom
          endpoint variant later (mirrored on Kokoro's pattern). */}
      {values.tts_provider === 'qwen3' && (
        <Qwen3Section
          values={values}
          onChange={onChange}
          agentName={agentName}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Kokoro mode picker, radio-style toggle between "recommended" and
// "custom endpoint". Two cards, side by side; the active one gets
// the accent border.
// ---------------------------------------------------------------------

function KokoroModePicker({
  mode,
  onChange,
}: {
  mode: KokoroMode;
  onChange: (m: KokoroMode) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
      }}
    >
      <ModeCard
        active={mode === 'recommended'}
        onClick={() => onChange('recommended')}
        title="Recommended"
        body="Download Kokoro and run it locally. ~325 MB one time, no API cost."
      />
      <ModeCard
        active={mode === 'custom'}
        onClick={() => onChange('custom')}
        title="My own endpoint"
        body="I have Kokoro running elsewhere. Point soul at the URL."
      />
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        padding: '10px 12px',
        borderRadius: 10,
        background: active ? 'var(--accent-dim)' : 'rgba(255, 255, 255, 0.025)',
        border: active
          ? '1px solid var(--accent-strong)'
          : '1px solid var(--glass-border)',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        boxShadow: active
          ? '0 0 14px -6px rgba(196, 68, 68, 0.45)'
          : 'none',
        transition: 'all 0.18s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.borderColor = 'var(--glass-border-focus)';
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.borderColor = 'var(--glass-border)';
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em' }}>
        {title}
      </span>
      <span style={{
        fontSize: 11.5,
        color: 'var(--text-secondary)',
        lineHeight: 1.4,
        letterSpacing: '0.005em',
      }}>
        {body}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------
// Kokoro install panel, three states tied to the soul-side state
// machine:
//   * status null / state idle   → show Install button (~325 MB)
//   * state downloading           → progress bar with bytes_done/total
//   * state installed             → green tick + the model version
//   * state error                 → error message + Retry button
// ---------------------------------------------------------------------

function KokoroInstallPanel({
  status,
  onInstall,
}: {
  status: KokoroStatus | null;
  onInstall: () => void;
}) {
  // Conservative defaults while we wait for the first /status response.
  const state = status?.state ?? 'idle';
  const error = status?.error ?? null;
  const progress = status?.progress;

  const pct = progress && progress.bytes_total > 0
    ? Math.min(100, Math.max(0, (progress.bytes_done / progress.bytes_total) * 100))
    : 0;

  const showInstallButton = state === 'idle' || state === 'error';
  const headerColor =
    state === 'installed' ? '#7fc97f'
    : state === 'error' ? 'var(--accent)'
    : 'var(--text-secondary)';

  let header: string;
  if (state === 'installed') header = 'Kokoro is installed and ready.';
  else if (state === 'downloading')
    header = progress?.phase === 'voices'
      ? 'Downloading voices…'
      : 'Downloading Kokoro model…';
  else if (state === 'error') header = 'Install failed.';
  else header = 'Kokoro is not installed yet.';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        background: state === 'installed'
          ? 'rgba(96, 178, 96, 0.06)'
          : 'rgba(255, 255, 255, 0.025)',
        border: state === 'installed'
          ? '1px solid rgba(96, 178, 96, 0.32)'
          : '1px solid var(--glass-border)',
        borderRadius: 10,
        transition: 'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {state === 'installed' ? (
          <CheckCircle2 size={15} strokeWidth={2} aria-hidden color="#7fc97f" />
        ) : state === 'error' ? (
          <AlertCircle size={15} strokeWidth={2} aria-hidden color="var(--accent)" />
        ) : (
          <Download size={15} strokeWidth={2} aria-hidden color={headerColor} />
        )}
        <span style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          fontWeight: 500,
          flex: 1,
        }}>
          {header}
        </span>
        {showInstallButton && (
          <button
            type="button"
            onClick={onInstall}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 10,
              border: 'none',
              background: '#ffffff',
              color: 'rgba(20, 20, 20, 0.92)',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: '0.005em',
              cursor: 'pointer',
              boxShadow:
                '0 4px 14px -4px rgba(196, 68, 68, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)',
              transition: 'transform 0.12s var(--ease-out-quart), box-shadow 0.18s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <Download size={13} strokeWidth={2.2} />
            {state === 'error' ? 'Retry install' : 'Install Kokoro (~325 MB)'}
          </button>
        )}
      </div>

      {state === 'downloading' && progress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{
            position: 'relative',
            width: '100%',
            height: 6,
            background: 'rgba(255, 255, 255, 0.06)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              width: `${pct}%`,
              background: 'var(--accent)',
              borderRadius: 3,
              transition: 'width 0.25s var(--ease-out-quart)',
            }} />
          </div>
          <span style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            letterSpacing: '0.01em',
          }}>
            {Math.round(pct)}% · {formatBytes(progress.bytes_done)} of {formatBytes(progress.bytes_total)}
          </span>
        </div>
      )}

      {state === 'error' && error && (
        <span style={{
          fontSize: 11.5,
          color: 'var(--accent)',
          lineHeight: 1.4,
        }}>
          {error}
        </span>
      )}

      {state === 'installed' && status?.model_version && (
        <span style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          letterSpacing: '0.01em',
        }}>
          Model version {status.model_version}, {status.voices.length} voices available.
        </span>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}


// ---------------------------------------------------------------------
// Agentic features section. Lives on the LLM page next to the chat
// model. Two backends:
//
//   * Cloud (OpenAI), runs the Responses API loop with gpt-5.4-mini /
//                      -nano. Multi-step browser + memory + web search.
//                      Requires an OpenAI key (or chat's key if chat is
//                      already OpenAI).
//   * Local (Ollama), runs a Chat-Completions tool loop on the SAME
//                      Ollama model the user picked for chat. No
//                      OpenAI key needed; no cloud round-trip. Only
//                      offered when chat is a tools-capable Ollama
//                      model (see `modelSupportsTools`).
//
// Nested states (cloud branch):
//   1. Toggle off (default) , escalation disabled.
//   2. Toggle on + chat is OpenAI, "Use same as chat" checkbox; when
//                                    checked, reuse chat model + key.
//   3. Toggle on + chat is NOT OpenAI, OpenAI key field + agentic
//                                        model dropdown.
//
// Local branch: no model dropdown, no key field, the chat-tier model
// runs both roles.
// ---------------------------------------------------------------------

const AGENTIC_OPENAI_MODELS: ReadonlyArray<{ id: string; label: string; hint?: string }> = [
  { id: 'openai:gpt-5.4-mini',  label: 'GPT-5.4 Mini',  hint: 'recommended' },
  { id: 'openai:gpt-5.4-nano',  label: 'GPT-5.4 Nano',  hint: 'cheapest' },
];

function AgenticSection({
  values,
  onChange,
  liveModelsByProvider,
  liveValidation,
  isAutoProbing,
  thinkingCapsByModel,
}: {
  values: ApiKeysProfile;
  onChange: (next: ApiKeysProfile) => void;
  liveModelsByProvider: Partial<Record<LLMProviderId, string[]>>;
  liveValidation: KeyValidationResult | null;
  isAutoProbing: boolean;
  thinkingCapsByModel: Record<string, ThinkingCapability>;
}) {
  const [showKey, setShowKey] = useState(false);

  const setEnabled = (b: boolean) => {
    onChange({ ...values, agentic_enabled: b });
  };
  const setBackend = (p: AgenticProvider) => {
    onChange({ ...values, agentic_provider: p });
  };
  const setUseSame = (b: boolean) => {
    onChange({ ...values, agentic_use_same_as_chat: b });
  };
  const setModel = (id: string) => {
    onChange({ ...values, agentic_model: id || null });
  };
  const setKey = (k: string) => {
    onChange({ ...values, agentic_api_key: k || null });
  };

  // Whether the chat provider is OpenAI, "use same as chat" is
  // only meaningful in that case (escalation needs an OpenAI model
  // either way; if chat is already OpenAI we can borrow its key).
  const chatIsOpenAI = values.llm_provider === 'openai';
  // Local-agentic eligibility: chat must be Ollama AND on a tools-
  // capable model (param-count gated). When false, the backend picker
  // is hidden and `agentic_provider` is force-coerced to 'openai' by
  // the parent's setProvider/setModel callbacks.
  const canRunLocal = values.llm_provider === 'ollama' && modelSupportsTools(values.llm_model);
  const isLocal = values.agentic_provider === 'ollama' && canRunLocal;
  // Effective "reuse chat" state. Even if user toggled the checkbox,
  // it only takes effect when chat IS OpenAI AND we're on the cloud
  // agentic path.
  const effectiveReuse = !isLocal && values.agentic_use_same_as_chat && chatIsOpenAI;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: '12px 14px',
      borderRadius: 10,
      border: '1px solid var(--glass-border)',
      background: 'rgba(255, 255, 255, 0.025)',
    }}>
      <Toggle
        value={values.agentic_enabled}
        onChange={setEnabled}
        icon={<Zap size={11} strokeWidth={2} aria-hidden style={{ opacity: 0.7 }} />}
        title="Enable agentic features"
        helper={values.agentic_enabled
          ? (isLocal
              ? 'Lets the assistant browse, search, and use tools for harder questions. Runs locally on your Ollama model, no API key.'
              : 'Lets the assistant browse, search, and use tools for harder questions. Uses an OpenAI model for the agentic loop.')
          : (canRunLocal
              ? 'Off by default. Turn on for live web search, page-reading, and multi-step research. Runs locally on your Ollama model, or pick OpenAI.'
              : 'Off by default. Turn on for live web search, page-reading, and multi-step research. Needs an OpenAI key.')}
        dimWhen={!values.agentic_enabled}
      />

      {values.agentic_enabled && (
        <>
          {/* Backend picker. Mirrors SettingsPanel's AgenticFacet, all
              cloud APIs + the 3 CLI-subscription providers + Local
              Ollama (only when chat is also Ollama + tools-capable).
              CLI providers (claude-code/gemini-cli/codex) are keyless;
              detailed sign-in lives in Settings → Agentic, this picker
              just exposes them so users know the option exists. */}
          <FieldLabel text="Agentic backend">
            <Dropdown
              value={values.agentic_provider}
              onChange={(v) => setBackend((v as AgenticProvider) || 'openai')}
              options={[
                { id: 'openai',      label: 'OpenAI',           hint: 'Responses API' },
                { id: 'anthropic',   label: 'Anthropic Claude', hint: 'Messages API' },
                { id: 'gemini',      label: 'Google Gemini',    hint: 'functionDeclarations' },
                { id: 'deepseek',    label: 'DeepSeek',         hint: 'OpenAI-compat tool loop' },
                { id: 'glm',         label: 'GLM (Zhipu)',      hint: 'OpenAI-compat tool loop' },
                { id: 'claude-code', label: 'Claude Code CLI',  hint: 'Pro/Max subscription' },
                { id: 'gemini-cli',  label: 'Gemini CLI',       hint: 'Free tier or Pro' },
                { id: 'codex',       label: 'Codex CLI',        hint: 'ChatGPT subscription' },
                ...(canRunLocal
                  ? [{ id: 'ollama', label: 'Local (Ollama)', hint: 'no API key' }]
                  : []),
              ]}
            />
          </FieldLabel>

          {!isLocal && chatIsOpenAI && (
            <Toggle
              value={values.agentic_use_same_as_chat}
              onChange={setUseSame}
              icon={null}
              title="Use the same model as conversational"
              helper={values.agentic_use_same_as_chat
                ? "Reuses your chat model + key. Simpler, but the conversational pick may be too small for tool-use."
                : "Pick a separate (likely larger) model for agentic work. Recommended."}
            />
          )}

          {/* CLI providers (claude-code / gemini-cli / codex) are
              keyless. Full install + OAuth flow lives in the shared
              CliProviderStatusCard: detect status, render the right
              install/sign-in command, copy + Open-in-Terminal buttons.
              Plus a live model dropdown populated from the agentic
              auto-probe's response. Same UX as Settings, no follow-up
              trip needed after onboarding. */}
          {KEYLESS_CLI_PROVIDERS.has(values.agentic_provider) && (() => {
            const aprov = values.agentic_provider;
            const rawLive = liveModelsByProvider[aprov] ?? [];
            const entries = rawLive.map((rawId) => ({
              id: `${aprov}:${rawId}`,
              label: rawId,
            }));
            const placeholder =
              isAutoProbing ? 'Verifying...'
              : entries.length === 0 ? 'Sign in via Terminal first'
              : 'Choose a model';
            return (
              <>
                <CliProviderStatusCard
                  provider={aprov}
                  outcome={liveValidation?.agentic ?? liveValidation?.llm ?? null}
                  isProbing={isAutoProbing}
                />
                <FieldLabel text="Agentic model">
                  <Dropdown
                    value={values.agentic_model ?? ''}
                    onChange={setModel}
                    options={entries}
                    placeholder={placeholder}
                    disabled={entries.length === 0}
                  />
                </FieldLabel>
              </>
            );
          })()}

          {!isLocal
            && values.agentic_provider !== 'claude-code'
            && values.agentic_provider !== 'gemini-cli'
            && values.agentic_provider !== 'codex'
            && !effectiveReuse
            && (() => {
            // Per-provider key + model copy. Each provider's escalation
            // runner in soul accepts the user's agentic_api_key directly;
            // the only differences are the placeholder + signup URL.
            const provider = values.agentic_provider;
            const meta: Record<string, { label: string; url: string; keyPh: string; modelPh: string }> = {
              openai:    { label: 'OpenAI',    url: 'https://platform.openai.com/api-keys',         keyPh: 'sk-…',     modelPh: 'gpt-5.4-mini' },
              anthropic: { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', keyPh: 'sk-ant-…', modelPh: 'claude-opus-4-7' },
              gemini:    { label: 'Google',    url: 'https://aistudio.google.com/apikey',          keyPh: 'AIza…',    modelPh: 'gemini-2.5-flash' },
              deepseek:  { label: 'DeepSeek',  url: 'https://platform.deepseek.com/api_keys',     keyPh: 'sk-…',     modelPh: 'deepseek-v4-flash' },
            };
            const m = meta[provider] ?? meta.openai;
            const isOpenAI = provider === 'openai';
            return (
              <>
                <FieldLabel
                  text="Agentic model"
                >
                  {isOpenAI ? (
                    <Dropdown
                      value={values.agentic_model ?? ''}
                      onChange={setModel}
                      placeholder="Choose a model"
                      options={AGENTIC_OPENAI_MODELS.map((mm) => ({
                        id: mm.id, label: mm.label, hint: mm.hint,
                      }))}
                    />
                  ) : (
                    // Anthropic + Gemini live-model fetch isn't wired into
                    // the agentic dropdown yet; for now accept a free-text
                    // model id. Users can paste any model their key allows
                    // (claude-opus-4-7, gemini-2.5-pro, etc.).
                    <input
                      type="text"
                      placeholder={m.modelPh}
                      value={values.agentic_model ?? ''}
                      onChange={(e) => setModel(e.target.value)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 10,
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        padding: '10px 12px',
                        outline: 'none',
                        width: '100%',
                      }}
                    />
                  )}
                </FieldLabel>

                {(!chatIsOpenAI || !isOpenAI) && (
                  <FieldLabel text={`${m.label} API key`}>
                    <SecretInput
                      value={values.agentic_api_key ?? ''}
                      onChange={setKey}
                      placeholder={m.keyPh}
                      visible={showKey}
                      onToggleVisible={() => setShowKey((v) => !v)}
                      autoComplete="off"
                    />
                  </FieldLabel>
                )}
              </>
            );
          })()}

          {/* Agentic thinking lever, capability-gated by the effective
              agentic model (the chat model when reusing/local, else the
              picked agentic model). Caps come from soul's _thinking
              resolver via /validate_keys — no hardcoded model lists. */}
          {(() => {
            const agModel = (isLocal || effectiveReuse)
              ? values.llm_model : values.agentic_model;
            const cap = thinkingCapabilityFor(agModel, thinkingCapsByModel);
            if (!cap) return null;
            return (
              <FieldLabel text="Agentic thinking">
                <Dropdown
                  value={normalizeThinkingValue(cap, values.agentic_thinking_effort)}
                  onChange={(v) => onChange({
                    ...values,
                    agentic_thinking_effort: (v as ThinkingEffort) || 'medium',
                  })}
                  options={thinkingOptionsFor(cap)}
                />
              </FieldLabel>
            );
          })()}
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// Qwen3 section, provider branch UI for Qwen3-TTS.
//
// Self-contained: polls /tts/qwen3/status on its own (different cadence
// from VoiceSection's Kokoro polling), drives /tts/qwen3/install, and
// renders the install panel + voice picker. Soul does the actual work
// (uv venv + dep install + model download + voice download); the
// renderer just shows progress and handles state transitions.
// ---------------------------------------------------------------------

function Qwen3Section({
  values,
  onChange,
  agentName,
}: {
  values: ApiKeysProfile;
  onChange: (next: ApiKeysProfile) => void;
  agentName?: string | null;
}) {
  const [status, setStatus] = useState<Qwen3Status | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (values.tts_provider !== 'qwen3') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await fetchQwen3Status();
        if (cancelled) return;
        setStatus(s);
        // Tighten the cadence while a download is in flight, drop to
        // a slow heartbeat once installed (so we still notice if the
        // service crashes externally).
        const next = s.state === 'downloading' ? 1500 : 30_000;
        pollRef.current = window.setTimeout(tick, next);
      } catch {
        if (!cancelled) pollRef.current = window.setTimeout(tick, 3000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollRef.current !== null) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [values.tts_provider]);

  const handleInstall = async () => {
    try {
      const s = await startQwen3Install();
      setStatus(s);
      const tick = async () => {
        try {
          const next = await fetchQwen3Status();
          setStatus(next);
          if (next.state === 'downloading') {
            pollRef.current = window.setTimeout(tick, 1500);
          }
        } catch { /* outer effect retries */ }
      };
      void tick();
    } catch (err) {
      console.warn('[qwen3] install failed', err);
    }
  };

  const setVoice = (id: string) => {
    onChange({ ...values, qwen3_voice: id || null });
  };

  // Voice catalogue. Soul-reported installed voices first, curated
  // list as fallback. The cloned Grace voice always reads "Grace"
  // (no dynamic agent-name override, no "offline" suffix).
  const voiceOptions = useMemo(() => {
    const ids = (status?.voices && status.voices.length > 0)
      ? status.voices
      : QWEN3_VOICES.map((v) => v.id);
    return ids.map((id) => ({
      id,
      label: id === 'grace_qwen3' ? 'Grace' : labelForQwen3Voice(id),
    }));
  }, [status?.voices]);

  return (
    <>
      <Qwen3InstallPanel status={status} onInstall={handleInstall} />
      <FieldLabel text="Voice">
        <Dropdown
          value={values.qwen3_voice ?? ''}
          onChange={setVoice}
          placeholder="Pick a voice"
          options={voiceOptions}
        />
      </FieldLabel>
    </>
  );
}


function Qwen3InstallPanel({
  status,
  onInstall,
}: {
  status: Qwen3Status | null;
  onInstall: () => void;
}) {
  const state = status?.state ?? 'idle';
  const error = status?.error ?? null;
  const progress = status?.progress;

  const showInstallButton = state === 'idle' || state === 'error';

  // Pre-flight gates. Surface these before the user can hit Install
  // so a too-small disk or a saturated GPU produces a clear "no" up
  // front, not a 4 GB-in cliff failure.
  const diskOk = (status?.free_disk_gb ?? 0) >= (status?.min_free_disk_gb ?? 0);
  const vramOk = (status?.free_vram_gb ?? 0) >= (status?.min_free_vram_gb ?? 0);
  const installBlocked = !diskOk || !vramOk;

  // Stage progress, figure out which phases have completed already.
  // Soul reports the CURRENT phase; we mark all earlier phases done.
  const currentPhaseIdx = progress
    ? QWEN3_PHASES.indexOf(progress.phase as Qwen3InstallPhase)
    : -1;

  const pct = progress && progress.bytes_total > 0
    ? Math.min(100, Math.max(0, (progress.bytes_done / progress.bytes_total) * 100))
    : 0;

  let header: string;
  if (state === 'installed') header = 'Qwen3-TTS is installed and ready.';
  else if (state === 'downloading') header = 'Setting up Qwen3-TTS…';
  else if (state === 'error') header = 'Install failed.';
  else header = 'Qwen3-TTS is not installed yet.';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        background: state === 'installed'
          ? 'rgba(96, 178, 96, 0.06)'
          : 'rgba(255, 255, 255, 0.025)',
        border: state === 'installed'
          ? '1px solid rgba(96, 178, 96, 0.32)'
          : '1px solid var(--glass-border)',
        borderRadius: 10,
        transition: 'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {state === 'installed' ? (
          <CheckCircle2 size={15} strokeWidth={2} aria-hidden color="#7fc97f" />
        ) : state === 'error' ? (
          <AlertCircle size={15} strokeWidth={2} aria-hidden color="var(--accent)" />
        ) : (
          <Download size={15} strokeWidth={2} aria-hidden color="var(--text-secondary)" />
        )}
        <span style={{
          fontSize: 13,
          color: 'var(--text-primary)',
          fontWeight: 500,
          flex: 1,
        }}>
          {header}
        </span>
        {showInstallButton && (
          <button
            type="button"
            onClick={onInstall}
            disabled={installBlocked}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 10,
              border: 'none',
              background: installBlocked ? 'rgba(255,255,255,0.08)' : '#ffffff',
              color: installBlocked
                ? 'var(--text-ghost)'
                : 'rgba(20, 20, 20, 0.92)',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: '0.005em',
              cursor: installBlocked ? 'not-allowed' : 'pointer',
              boxShadow: installBlocked
                ? 'none'
                : '0 4px 14px -4px rgba(196, 68, 68, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)',
              transition: 'transform 0.12s var(--ease-out-quart)',
            }}
            onMouseEnter={(e) => {
              if (installBlocked) return;
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              if (installBlocked) return;
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            title={installBlocked
              ? 'Free up disk / GPU memory and try again'
              : 'Downloads ~5 GB and sets up an isolated Python environment'}
          >
            <Download size={13} strokeWidth={2.2} />
            {state === 'error' ? 'Retry install' : 'Install Qwen3-TTS'}
          </button>
        )}
      </div>

      {/* Pre-flight gate warnings, render under the header when the
          checks fail, so the user sees WHY the Install button is
          disabled. Each row tells them how much they have and how
          much is needed. */}
      {showInstallButton && installBlocked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!diskOk && (
            <span style={{ fontSize: 11, color: 'var(--accent)' }}>
              Need {status?.min_free_disk_gb} GB free disk;
              {' '}only {status?.free_disk_gb} GB available.
            </span>
          )}
          {!vramOk && (
            <span style={{ fontSize: 11, color: 'var(--accent)' }}>
              Need {status?.min_free_vram_gb} GB free GPU memory;
              {' '}only {status?.free_vram_gb} GB available. Close UE
              / other GPU apps and re-check.
            </span>
          )}
        </div>
      )}

      {/* Stage list during install. Each phase gets a row; the active
          one shows the bar + detail line, finished ones get a check,
          pending ones stay dimmed. ~5 rows max, fits without scroll. */}
      {state === 'downloading' && progress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {QWEN3_PHASES.map((phase, idx) => {
            const isActive = idx === currentPhaseIdx;
            const isDone = idx < currentPhaseIdx;
            const isPending = idx > currentPhaseIdx;
            return (
              <div
                key={phase}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  opacity: isPending ? 0.45 : 1,
                  transition: 'opacity 0.18s var(--ease-out-quart)',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11.5,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isActive ? 500 : 400,
                }}>
                  {isDone ? (
                    <CheckCircle2 size={11} strokeWidth={2.4} color="#7fc97f" />
                  ) : isActive ? (
                    <Loader2
                      size={11}
                      strokeWidth={2.4}
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                  ) : (
                    <span style={{
                      width: 11, height: 11, borderRadius: '50%',
                      border: '1px solid var(--glass-border)',
                      flexShrink: 0,
                    }} />
                  )}
                  <span style={{ flex: 1 }}>{qwen3PhaseLabel(phase)}</span>
                </div>

                {/* Per-stage progress bar + detail, only for the
                    active stage. The detail line is the live log
                    tail soul forwards from the underlying tool
                    (uv, snapshot_download). */}
                {isActive && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    marginLeft: 19,
                  }}>
                    {progress.bytes_total > 0 && (
                      <div style={{
                        position: 'relative',
                        width: '100%',
                        height: 4,
                        background: 'rgba(255, 255, 255, 0.06)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          width: `${pct}%`,
                          background: 'var(--accent)',
                          borderRadius: 2,
                          transition: 'width 0.25s var(--ease-out-quart)',
                        }} />
                      </div>
                    )}
                    {progress.detail && (
                      <span style={{
                        fontSize: 10.5,
                        color: 'var(--text-ghost)',
                        letterSpacing: '0.005em',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'monospace',
                      }}>
                        {progress.detail}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {state === 'error' && error && (
        <span style={{
          fontSize: 11.5,
          color: 'var(--accent)',
          lineHeight: 1.4,
        }}>
          {error}
        </span>
      )}

      {state === 'installed' && status && (
        <span style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          letterSpacing: '0.01em',
        }}>
          {status.voices.length} voice{status.voices.length === 1 ? '' : 's'} available
          {status.service_running ? ' · service running' : ' · service starts on first chat'}.
        </span>
      )}
    </div>
  );
}


function FieldLabel({
  text,
  children,
  style,
  trailing,
}: {
  text: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  trailing?: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        minWidth: 0,
        ...style,
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          // Matches the shared onboarding eyebrow (onboardingKit FieldLabel):
          // 11/700 uppercase. The 700 weight carries the legibility that the
          // old 11/500 lacked while staying cleaner than a 12/500 label.
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-secondary)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        <span>{text}</span>
        {trailing}
      </span>
      {children}
    </label>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
  visible,
  onToggleVisible,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  visible: boolean;
  onToggleVisible: () => void;
  autoComplete?: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        style={{
          ...FIELD_BASE,
          paddingRight: 38,
          // Keep system font in both states, masked dots look clean
          // in the inherit family, and switching to monospace bled into
          // the placeholder text and made it read mechanical.
        }}
        onFocus={(e) => applyFocus(e.target)}
        onBlur={(e) => applyBlur(e.target)}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        aria-label={visible ? 'Hide key' : 'Show key'}
        style={{
          position: 'absolute',
          top: '50%',
          right: 8,
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          padding: 6,
          color: 'var(--text-ghost)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          transition: 'color 0.15s var(--ease-out-quart), background 0.15s var(--ease-out-quart)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-ghost)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {visible ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
      </button>
    </div>
  );
}

function Toggle({
  value,
  onChange,
  icon,
  title,
  helper,
  dimWhen,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
  title: string;
  helper: string;
  /** When true, render the row at reduced opacity to communicate that
   *  the toggle has no effect right now (e.g. grounding without Gemini
   *  selected). Still clickable, the user can pre-set it. */
  dimWhen?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: value ? 'rgba(196, 68, 68, 0.06)' : 'rgba(255, 255, 255, 0.025)',
        border: value
          ? '1px solid var(--accent-strong)'
          : '1px solid var(--glass-border)',
        borderRadius: 10,
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        fontSize: 12.5,
        cursor: 'pointer',
        textAlign: 'left',
        opacity: dimWhen ? 0.62 : 1,
        boxShadow: value ? '0 0 14px -8px rgba(196, 68, 68, 0.55)' : 'none',
        transition: 'all 0.18s var(--ease-out-quart)',
      }}
    >
      {/* Switch track */}
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: 30,
          height: 18,
          flexShrink: 0,
          borderRadius: 999,
          background: value ? 'var(--accent)' : 'rgba(255, 255, 255, 0.14)',
          transition: 'background 0.18s var(--ease-out-quart)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 14 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
            transition: 'left 0.18s var(--ease-out-quart)',
          }}
        />
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
          {icon}
          {title}
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            letterSpacing: '0.005em',
            lineHeight: 1.45,
          }}
        >
          {helper}
        </span>
      </span>
    </button>
  );
}
