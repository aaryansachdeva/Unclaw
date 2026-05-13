// Step 4 — fully optional. BYOK: chat provider + model dropdowns,
// provider API key (cloud only), ElevenLabs voice key, and a separate
// Gemini key for Google Search grounding. Saved encrypted on this
// device via Electron safeStorage and passed through to soul on each
// /chat call (services/soulChat.ts handles the read).
//
// Three chat providers are supported, mirroring soul's `_select_provider`:
//   * Groq (cloud) — needs API key
//   * OpenAI (cloud) — needs API key
//   * Ollama (local daemon) — no API key, model list discovered live
//                             from soul's GET /providers endpoint
//
// Gemini stays in the schema but ONLY for Google Search grounding,
// not as a chat provider — its key gets its own field below.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye, EyeOff, Search, ExternalLink, Zap,
  AlertCircle, CheckCircle2, ShieldCheck, Loader2, Download,
} from 'lucide-react';
import { StepHeader } from './StepHeader';
import { Dropdown } from './Dropdown';
import {
  LLM_PROVIDERS,
  getProvider,
  missingRequiredKeyFields,
  modelSupportsTools,
  validateKeys,
  type ApiKeysProfile,
  type AgenticProvider,
  type KeyValidationResult,
  type LLMProviderId,
  type KokoroMode,
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
  /** Fires when a Check Keys round completes with `ok=false` — the
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
  // not the static catalog — `null` = not fetched yet, `[]` = soul
  // unreachable or no models pulled.
  const [ollamaModels, setOllamaModels] = useState<SoulProviderModel[] | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);

  // "Check keys" state machine. `result` is the latest server response;
  // `state` distinguishes idle (button shown) / checking (spinner) /
  // done (per-key icons rendered). When the user edits any key field,
  // result gets cleared and the Wizard's `validated` flips back to
  // false — they have to re-check before they can finish.
  const [check, setCheck] = useState<{
    state: 'idle' | 'checking' | 'done';
    result: KeyValidationResult | null;
    /** Surfaces transport-level failures (soul offline, etc.) above
     *  the per-key results. */
    networkError: string | null;
  }>({ state: 'idle', result: null, networkError: null });

  const provider = getProvider(values.llm_provider);

  // Fetch Ollama models once on mount AND any time the user picks the
  // Ollama provider, so newly-pulled models appear without a wizard
  // remount. Best-effort: if soul is offline we just show an empty list.
  useEffect(() => {
    if (provider?.id !== 'ollama') return;
    let cancelled = false;
    setOllamaLoading(true);
    fetchOllamaModels()
      .then((list) => { if (!cancelled) setOllamaModels(list); })
      .finally(() => { if (!cancelled) setOllamaLoading(false); });
    return () => { cancelled = true; };
  }, [provider?.id]);

  // Model dropdown options. Cloud providers use the static catalog; Ollama
  // uses whatever soul reports as locally installed.
  const models = useMemo(() => {
    if (provider?.dynamicModels) {
      return (ollamaModels ?? []).map((m) => ({
        id: m.id,
        label: m.tag ?? m.label ?? m.id,
        hint: m.size_gb ? `${m.size_gb} GB` : undefined,
      }));
    }
    return provider?.models ?? [];
  }, [provider, ollamaModels]);

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
      // Wipe the old key when switching to a no-key provider — leaving
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

  // Live validation: which required keys are still missing? Drives the
  // inline "you still need…" panel below + the Wizard's Finish gate.
  // Recomputed on every keystroke (cheap; just a few field reads).
  // Filtered by mode so the LLM page only flags LLM/agentic gaps and
  // the voice page only flags voice gaps.
  const allMissing = missingRequiredKeyFields(values);
  const missing = allMissing.filter((field) => {
    if (mode === 'all') return true;
    const isLlmField = field === 'LLM provider'
      || field === 'Model'
      || field === 'Agentic model'
      || field === 'OpenAI key for agentic'
      || field === 'Tools-capable Ollama chat model'
      || field === 'Gemini API key for grounded search'
      || (field.endsWith(' API key') && field !== 'ElevenLabs API key');
    return mode === 'llm' ? isLlmField : !isLlmField;
  });

  // Reset check-result + invalidate the Wizard's "validated" flag any
  // time a setup-relevant field changes. Without this, the user could
  // pass Verify, then change a key, then Finish with stale validation.
  // Each page invalidates only when ITS OWN scope's fields change —
  // editing the voice provider doesn't invalidate the LLM verify.
  useEffect(() => {
    setCheck((prev) =>
      prev.state === 'idle' && prev.result === null
        ? prev
        : { state: 'idle', result: null, networkError: null });
    if (validated) onValidatedChange(false);
    // Watch only the fields THIS scope cares about. The full union
    // is still listed for `mode === 'all'` (legacy single-page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, mode === 'llm' ? [
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
  ]);

  const handleCheckKeys = async () => {
    setCheck({ state: 'checking', result: null, networkError: null });
    try {
      const result = await validateKeys(values);
      setCheck({ state: 'done', result, networkError: null });
      // Compute scope-relevant ok. The /validate_keys call always
      // probes everything (cheap; one round trip), but each page's
      // pass criterion is local: LLM page passes when LLM probes
      // (and agentic, when enabled) succeed; voice page passes
      // when TTS readiness succeeds.
      const llmOk = result.llm.ok
        && (!values.agentic_enabled || (result.agentic?.ok ?? true))
        && (!values.grounding_search_enabled || (result.gemini_search?.ok ?? true));
      const voiceOk = result.tts?.ok ?? result.elevenlabs?.ok ?? false;
      const scopeOk = mode === 'llm' ? llmOk
                    : mode === 'voice' ? voiceOk
                    : (llmOk && voiceOk);
      onValidatedChange(scopeOk);
      if (!scopeOk) onCheckFailed?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'check failed';
      setCheck({ state: 'done', result: null, networkError: message });
      onValidatedChange(false);
    }
  };

  // Header copy keyed off mode — same panel reused on both wizard
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
            trailing={provider ? (
              <SignupLink href={provider.signupUrl} />
            ) : null}
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
              disabled={!provider || (provider.dynamicModels && models.length === 0)}
              placeholder={
                !provider
                  ? 'Pick a provider first'
                  : provider.dynamicModels && models.length === 0
                    ? (ollamaLoading
                        ? 'Looking for installed models…'
                        : 'No Ollama models found, run `ollama pull <name>`')
                    : 'Choose a model'
              }
              options={models.map((m) => ({
                id: m.id,
                label: m.label,
                hint: m.hint,
              }))}
            />
          </FieldLabel>
        </div>

        {/* API key — only for cloud providers. Ollama runs locally on
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

        <AgenticSection values={values} onChange={onChange} />
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

        {/* Gemini Search key — separate from the chat provider. Only
            used when grounding is enabled; the chat path stays whatever
            the user picked above (Groq / OpenAI / Ollama). Optional. */}
        <FieldLabel
          text="Gemini API key (Google Search, optional)"
          trailing={
            <SignupLink href="https://aistudio.google.com/apikey" />
          }
        >
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
          <CheckKeysBar
            check={check}
            providerLabel={provider?.label ?? 'LLM'}
            onCheck={handleCheckKeys}
            scope={mode}
            agenticEnabled={values.agentic_enabled}
            groundingEnabled={values.grounding_search_enabled}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Check-keys bar — orchestrates the three render states (idle / checking
// / done) for the validation block. Pulled out as a sub-component so the
// main step body stays focused on the form fields.
// ---------------------------------------------------------------------

function CheckKeysBar({
  check,
  providerLabel,
  onCheck,
  scope = 'all',
  agenticEnabled = false,
  groundingEnabled = false,
}: {
  check: {
    state: 'idle' | 'checking' | 'done';
    result: KeyValidationResult | null;
    networkError: string | null;
  };
  providerLabel: string;
  onCheck: () => void | Promise<void>;
  /** Which result rows to render. `'llm'` shows the LLM provider
   *  (and Agentic when enabled); `'voice'` shows the TTS row;
   *  `'all'` shows both. Pass-through from ConnectionsStep's mode. */
  scope?: 'llm' | 'voice' | 'all';
  /** When true AND scope includes LLM, render an Agentic row from
   *  result.agentic. When the soul-side probe lands, this row will
   *  show the OpenAI-key check outcome. */
  agenticEnabled?: boolean;
  /** When true AND scope includes LLM, render a Web-search (Gemini)
   *  row from result.gemini_search. */
  groundingEnabled?: boolean;
}) {
  const checking = check.state === 'checking';
  const result = check.result;
  // "Pending" = the user hasn't done the gating action yet. Drives
  // the panel's accent halo + the button's white-primary CTA styling
  // so this row reads as "you need to do this next" instead of as a
  // quiet utility bar tucked under the form.
  const pending = check.state === 'idle' && !result;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px',
        background: result?.ok
          ? 'rgba(96, 178, 96, 0.06)'
          : pending
            ? 'rgba(196, 68, 68, 0.06)'
            : 'rgba(255, 255, 255, 0.025)',
        border: result?.ok
          ? '1px solid rgba(96, 178, 96, 0.32)'
          : pending
            ? '1px solid var(--accent-strong)'
            : '1px solid var(--glass-border)',
        borderRadius: 10,
        // Soft accent glow in pending state — pulls the eye to the
        // gating action without going full-blown attention-grabbing
        // (no animation, no flashing colors). Disappears once the
        // user has either verified or failed a check.
        boxShadow: pending
          ? '0 0 18px -6px rgba(196, 68, 68, 0.45)'
          : 'none',
        transition: 'background 0.18s var(--ease-out-quart), border-color 0.18s var(--ease-out-quart), box-shadow 0.18s var(--ease-out-quart)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          <ShieldCheck
            size={15}
            strokeWidth={2}
            aria-hidden
            color={
              result?.ok
                ? '#7fc97f'
                : pending
                  ? 'var(--accent)'
                  : 'var(--text-secondary)'
            }
          />
          {result?.ok
            ? 'Verified'
            : check.state === 'done'
              ? 'Couldn’t verify all'
              : 'Verify to finish'}
        </span>
        <button
          type="button"
          onClick={() => { void onCheck(); }}
          disabled={checking}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            // Two presentations:
            //   * Pending → white primary CTA matching the Finish
            //     button's weight, with an accent shadow so it reads
            //     as "do this next, then you can finish".
            //   * Done (re-check) → quieter glass pill, since the
            //     gating action has already happened once.
            padding: pending ? '9px 18px' : '7px 14px',
            borderRadius: 10,
            border: pending
              ? 'none'
              : '1px solid var(--glass-border-focus)',
            background: pending
              ? '#ffffff'
              : checking
                ? 'rgba(255, 255, 255, 0.04)'
                : 'rgba(255, 255, 255, 0.08)',
            color: pending
              ? 'rgba(20, 20, 20, 0.92)'
              : 'var(--text-primary)',
            fontFamily: 'inherit',
            fontSize: pending ? 13 : 12,
            fontWeight: pending ? 600 : 500,
            letterSpacing: '0.005em',
            cursor: checking ? 'wait' : 'pointer',
            opacity: checking ? 0.7 : 1,
            boxShadow: pending
              ? '0 4px 14px -4px rgba(196, 68, 68, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)'
              : 'none',
            transition: 'background 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart), transform 0.12s var(--ease-out-quart)',
          }}
          onMouseEnter={(e) => {
            if (checking) return;
            if (pending) {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow =
                '0 6px 18px -4px rgba(196, 68, 68, 0.55), 0 2px 6px rgba(0, 0, 0, 0.30)';
            } else {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
            }
          }}
          onMouseLeave={(e) => {
            if (checking) return;
            if (pending) {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow =
                '0 4px 14px -4px rgba(196, 68, 68, 0.45), 0 2px 6px rgba(0, 0, 0, 0.25)';
            } else {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }
          }}
        >
          {checking ? (
            <Loader2
              size={13}
              strokeWidth={2.2}
              aria-hidden
              style={{ animation: 'spin 0.8s linear infinite' }}
            />
          ) : null}
          {checking
            ? 'Verifying…'
            : check.state === 'done'
              ? 'Verify again'
              : 'Verify'}
        </button>
      </div>

      {/* Network/transport error — distinct from per-key validation
          failures. Shown above the row results so the user can tell
          "soul is offline" apart from "ElevenLabs rejected this key". */}
      {check.networkError && (
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            paddingTop: 2,
          }}
        >
          <AlertCircle size={12} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{check.networkError}</span>
        </div>
      )}

      {/* Per-key result rows. Only rendered after a check completes,
          and only the rows relevant to the current scope. */}
      {result && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            paddingTop: 4,
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            marginTop: 4,
          }}
        >
          {(scope === 'all' || scope === 'llm') && (
            <KeyResultRow
              label={providerLabel}
              outcome={result.llm}
            />
          )}
          {(scope === 'all' || scope === 'llm') && agenticEnabled && (
            <KeyResultRow
              label="Agentic (OpenAI)"
              outcome={result.agentic ?? { ok: false, error: 'not probed yet' }}
            />
          )}
          {(scope === 'all' || scope === 'llm') && groundingEnabled && (
            <KeyResultRow
              label="Web search (Gemini)"
              outcome={result.gemini_search ?? { ok: false, error: 'not probed yet' }}
            />
          )}
          {(scope === 'all' || scope === 'voice') && (
            <KeyResultRow
              label={
                result.tts?.provider === 'kokoro' ? 'Kokoro'
                : result.tts?.provider === 'qwen3' ? 'Qwen3-TTS'
                : 'ElevenLabs'
              }
              outcome={result.tts ?? result.elevenlabs}
            />
          )}
        </div>
      )}
    </div>
  );
}

function KeyResultRow({
  label,
  outcome,
}: {
  label: string;
  outcome: { ok: boolean; error?: string };
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        fontSize: 12,
        color: 'var(--text-primary)',
        lineHeight: 1.4,
        padding: '4px 0',
      }}
    >
      {outcome.ok ? (
        <CheckCircle2 size={13} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 1, color: '#7fc97f' }} />
      ) : (
        <AlertCircle size={13} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
      )}
      <span style={{ minWidth: 0 }}>
        <strong style={{ fontWeight: 600 }}>{label}</strong>
        {outcome.ok ? (
          <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>working</span>
        ) : (
          <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
            {outcome.error ?? 'failed'}
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------
// Field building blocks
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Voice section — TTS provider picker.
//
// Two top-level options:
//   * ElevenLabs (cloud)   — needs a BYOK API key, ~real-time, paid
//   * Kokoro (local, free) — open-weight 82M-param model; either soul
//                            downloads + runs it in-process, OR the
//                            user has Kokoro running elsewhere and
//                            hands us a URL.
//
// When Kokoro is picked, a sub-radio toggles between:
//   * Recommended  — soul downloads model + voices on demand (~325MB
//                    one-time), runs inference locally; no setup beyond
//                    a single Install button.
//   * Custom       — user provides an OpenAI-compat endpoint URL
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

  // Poll loop — only active when Kokoro is the chosen provider AND
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
        } catch { /* transient — outer effect will retry */ }
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
  // of the user's chosen agent name — the agent_name customization
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
      {/* Provider picker — single row at the top of the section. */}
      <FieldLabel text="Voice provider">
        <Dropdown
          value={values.tts_provider}
          onChange={(v) => setTtsProvider(v as TtsProviderId)}
          options={[
            { id: 'elevenlabs', label: 'ElevenLabs' },
            { id: 'kokoro',     label: 'Kokoro' },
            { id: 'qwen3',      label: 'Qwen3-TTS' },
          ]}
        />
      </FieldLabel>

      {/* ElevenLabs branch — original BYOK key field. */}
      {values.tts_provider === 'elevenlabs' && (
        <FieldLabel
          text="ElevenLabs API key"
          trailing={
            <SignupLink href="https://elevenlabs.io/app/settings/api-keys" />
          }
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

      {/* Kokoro branch — mode picker + install panel / endpoint
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

      {/* Qwen3 branch — install panel (multi-stage) + voice dropdown.
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
// Kokoro mode picker — radio-style toggle between "recommended" and
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
// Kokoro install panel — three states tied to the soul-side state
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
//   * Cloud (OpenAI) — runs the Responses API loop with gpt-5.4-mini /
//                      -nano. Multi-step browser + memory + web search.
//                      Requires an OpenAI key (or chat's key if chat is
//                      already OpenAI).
//   * Local (Ollama) — runs a Chat-Completions tool loop on the SAME
//                      Ollama model the user picked for chat. No
//                      OpenAI key needed; no cloud round-trip. Only
//                      offered when chat is a tools-capable Ollama
//                      model (see `modelSupportsTools`).
//
// Nested states (cloud branch):
//   1. Toggle off (default)  — escalation disabled.
//   2. Toggle on + chat is OpenAI — "Use same as chat" checkbox; when
//                                    checked, reuse chat model + key.
//   3. Toggle on + chat is NOT OpenAI — OpenAI key field + agentic
//                                        model dropdown.
//
// Local branch: no model dropdown, no key field — the chat-tier model
// runs both roles.
// ---------------------------------------------------------------------

const AGENTIC_OPENAI_MODELS: ReadonlyArray<{ id: string; label: string; hint?: string }> = [
  { id: 'openai:gpt-5.4-mini',  label: 'GPT-5.4 Mini',  hint: 'recommended' },
  { id: 'openai:gpt-5.4-nano',  label: 'GPT-5.4 Nano',  hint: 'cheapest' },
];

function AgenticSection({
  values,
  onChange,
}: {
  values: ApiKeysProfile;
  onChange: (next: ApiKeysProfile) => void;
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

  // Whether the chat provider is OpenAI — "use same as chat" is
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
              ? 'Lets the assistant browse, search, and use tools for harder questions. Runs locally on your Ollama model — no API key.'
              : 'Lets the assistant browse, search, and use tools for harder questions. Uses an OpenAI model for the agentic loop.')
          : (canRunLocal
              ? 'Off by default. Turn on for live web search, page-reading, and multi-step research. Runs locally on your Ollama model — or pick OpenAI.'
              : 'Off by default. Turn on for live web search, page-reading, and multi-step research. Needs an OpenAI key.')}
        dimWhen={!values.agentic_enabled}
      />

      {values.agentic_enabled && (
        <>
          {canRunLocal && (
            <FieldLabel text="Agentic backend">
              <Dropdown
                value={values.agentic_provider}
                onChange={(v) => setBackend((v as AgenticProvider) || 'openai')}
                options={[
                  { id: 'ollama', label: 'Local (Ollama)',   hint: 'no API key' },
                  { id: 'openai', label: 'Cloud (OpenAI)',   hint: 'needs key' },
                ]}
              />
            </FieldLabel>
          )}

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

          {!isLocal && !effectiveReuse && (
            <FieldLabel
              text="Agentic model"
              trailing={!chatIsOpenAI ? (
                <SignupLink href="https://platform.openai.com/api-keys" />
              ) : null}
            >
              <Dropdown
                value={values.agentic_model ?? ''}
                onChange={setModel}
                placeholder="Choose a model"
                options={AGENTIC_OPENAI_MODELS.map((m) => ({
                  id: m.id, label: m.label, hint: m.hint,
                }))}
              />
            </FieldLabel>
          )}

          {!isLocal && !effectiveReuse && !chatIsOpenAI && (
            <FieldLabel text="OpenAI API key">
              <SecretInput
                value={values.agentic_api_key ?? ''}
                onChange={setKey}
                placeholder="sk-…"
                visible={showKey}
                onToggleVisible={() => setShowKey((v) => !v)}
                autoComplete="off"
              />
            </FieldLabel>
          )}
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// Qwen3 section — provider branch UI for Qwen3-TTS.
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

  // Stage progress — figure out which phases have completed already.
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

      {/* Pre-flight gate warnings — render under the header when the
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
              {' '}only {status?.free_vram_gb} GB available — close UE
              / other GPU apps and re-check.
            </span>
          )}
        </div>
      )}

      {/* Stage list during install. Each phase gets a row; the active
          one shows the bar + detail line, finished ones get a check,
          pending ones stay dimmed. ~5 rows max — fits without scroll. */}
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
          // 12 / 0.05em uppercase reads as a deliberate label, not as
          // "almost-disappeared microcopy". 11 was chic but disappeared
          // into the frosted panel for users not sitting six inches
          // from the screen.
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          letterSpacing: '0.05em',
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
          // Keep system font in both states — masked dots look clean
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

function SignupLink({ href }: { href: string }) {
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.electronAPI?.authOpenExternal?.(href);
  };
  return (
    <a
      href={href}
      onClick={open}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'color 0.15s var(--ease-out-quart)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
    >
      Get key
      <ExternalLink size={10} strokeWidth={2} aria-hidden />
    </a>
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
   *  selected). Still clickable — the user can pre-set it. */
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
