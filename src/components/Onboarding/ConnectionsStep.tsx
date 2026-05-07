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

import { useEffect, useMemo, useState } from 'react';
import {
  Eye, EyeOff, Lock, Search, ExternalLink,
  AlertCircle, CheckCircle2, ShieldCheck, Loader2,
} from 'lucide-react';
import { StepHeader } from './StepHeader';
import { Dropdown } from './Dropdown';
import {
  LLM_PROVIDERS,
  getProvider,
  missingRequiredKeyFields,
  validateKeys,
  type ApiKeysProfile,
  type KeyValidationResult,
  type LLMProviderId,
} from '../../services/apiKeys';
import { fetchOllamaModels, type SoulProviderModel } from '../../services/providers';

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
}: Props) {
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
      onChange({ ...values, llm_provider: null, llm_model: null });
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
    onChange({
      ...values,
      llm_provider: id,
      llm_model: nextModel,
      // Wipe the old key when switching to a no-key provider — leaving
      // it on disk would be surprising.
      llm_api_key: next?.requiresApiKey ? values.llm_api_key : null,
    });
  };

  const setModel = (modelId: string) => {
    onChange({ ...values, llm_model: modelId || null });
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

  const setSync = (sync: boolean) => {
    onChange({ ...values, sync_across_devices: sync });
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
  const missing = missingRequiredKeyFields(values);

  // Reset check-result + invalidate the Wizard's "validated" flag any
  // time a key-relevant field changes. Without this, the user could
  // pass Check, then change a key, then Finish with stale validation.
  useEffect(() => {
    setCheck((prev) =>
      prev.state === 'idle' && prev.result === null
        ? prev
        : { state: 'idle', result: null, networkError: null });
    if (validated) onValidatedChange(false);
    // We intentionally watch the four key-bearing fields directly, not
    // the whole `values` object — sync_across_devices toggles, vibe
    // sliders elsewhere, etc. don't invalidate keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values.llm_provider,
    values.llm_model,
    values.llm_api_key,
    values.elevenlabs_api_key,
  ]);

  const handleCheckKeys = async () => {
    setCheck({ state: 'checking', result: null, networkError: null });
    try {
      const result = await validateKeys(values);
      setCheck({ state: 'done', result, networkError: null });
      onValidatedChange(result.ok);
      // Per-key validation failure (provider rejected a key) — Wizard
      // dispatches the pre-gen "something's off" audio line so Grace
      // tells the user out loud. Network/transport failures (catch
      // branch below) skip the cue since the issue is soul/network,
      // not the user's key.
      if (!result.ok) onCheckFailed?.();
    } catch (err) {
      // Soul is down, network is dead, etc. Surface a single error
      // string above the per-row icons so the user understands the
      // transport failure isn't about their key.
      const message = err instanceof Error ? err.message : 'check failed';
      setCheck({ state: 'done', result: null, networkError: message });
      onValidatedChange(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      <div style={{ width: 180, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader
          title="Bring your own keys."
          subtitle="Pick a chat provider and add your ElevenLabs voice key. Stored encrypted on this device."
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
                        : 'No Ollama models found — run `ollama pull <name>`')
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

        <FieldLabel
          text="ElevenLabs API key (voice)"
          trailing={
            <SignupLink href="https://elevenlabs.io/app/settings/api-keys" />
          }
        >
          <SecretInput
            value={values.elevenlabs_api_key ?? ''}
            onChange={setElevenKey}
            placeholder="sk_…"
            visible={showElevenKey}
            onToggleVisible={() => setShowElevenKey((v) => !v)}
            autoComplete="off"
          />
        </FieldLabel>

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

        <Toggle
          value={values.sync_across_devices}
          onChange={setSync}
          icon={<Lock size={11} strokeWidth={2} aria-hidden style={{ opacity: 0.7 }} />}
          title="Sync across devices"
          helper="Encrypted before it leaves this device. You can change this later."
        />

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
        {missing.length > 0 ? (
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
          />
        )}
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
}: {
  check: {
    state: 'idle' | 'checking' | 'done';
    result: KeyValidationResult | null;
    networkError: string | null;
  };
  providerLabel: string;
  onCheck: () => void | Promise<void>;
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
            ? 'Keys verified'
            : check.state === 'done'
              ? 'Couldn’t verify all keys'
              : 'Verify your keys to finish'}
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
            ? 'Checking…'
            : check.state === 'done'
              ? 'Check again'
              : 'Check keys'}
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

      {/* Per-key result rows. Only rendered after a check completes. */}
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
          <KeyResultRow
            label={providerLabel}
            outcome={result.llm}
          />
          <KeyResultRow
            label="ElevenLabs"
            outcome={result.elevenlabs}
          />
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
