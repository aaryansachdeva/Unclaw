// Settings panel — full-screen overlay accessible from the Titlebar
// profile dropdown. Lets the user reconfigure everything they set up
// during onboarding (LLM provider, TTS, agentic, graphics quality)
// without going back through the wizard.
//
// Design language: frosted-slate glass at panel intensity, warm-red
// accent used sparingly (save button at-rest, restart badge), no
// editorial typography — Plus Jakarta Sans throughout. Same vocab as
// CustomizationOverlay so it feels like a continuation of the app.
//
// State model: panel owns a LOCAL draft of the profile while open.
// Save commits the draft to safeStorage (apiKeysSet) + PATCHes
// /settings on the soul side. Cancel/Esc just closes — never persists.
// Mirrors the onboarding wizard's "edit-then-confirm" pattern instead
// of live-saving each field (which would race against the chat path).
//
// Graphics: writes graphics_quality alongside the other fields, but
// the actual UE CVar plumbing is on the soul side (unreal_runtime.py
// reads the field at next UE launch). UI surfaces a "Restart character
// to apply" toast when the value changes — soul will pick up the new
// preset on the next UE spawn.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, AlertCircle, Loader2 } from 'lucide-react';
import {
  DEFAULT_API_KEYS,
  LLM_PROVIDERS,
  fetchApiKeys,
  getProvider,
  saveApiKeys,
  validateKeys,
  type ApiKeysProfile,
  type GraphicsQuality,
  type KeyValidationResult,
  type LLMProviderId,
  type TtsProviderId,
} from '../services/apiKeys';
// Note: no separate /settings PATCH needed. Soul reads the encrypted
// ApiKeysProfile via byok.py on each /chat request — saveApiKeys (which
// writes through Electron's safeStorage) is all the persistence the chat
// pipeline reads from. Onboarding uses the same single-call pattern.

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Fires after a successful save so App can refresh any cached settings. */
  onSaved?: (next: ApiKeysProfile) => void;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'saving' }
  | { kind: 'saved'; graphicsChanged: boolean }
  | { kind: 'error'; message: string };

export function SettingsPanel({ open, onClose, onSaved }: SettingsPanelProps) {
  const [draft, setDraft] = useState<ApiKeysProfile>(DEFAULT_API_KEYS);
  const [original, setOriginal] = useState<ApiKeysProfile>(DEFAULT_API_KEYS);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [validation, setValidation] = useState<KeyValidationResult | null>(null);

  // Hydrate on open. Reset every time the panel opens so reopening
  // after a discard doesn't keep the stale draft around.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaveState({ kind: 'idle' });
    setValidation(null);
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
    key: K,
    value: ApiKeysProfile[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    // Clear stale validation banner whenever the user starts editing.
    setValidation(null);
    if (saveState.kind === 'saved' || saveState.kind === 'error') {
      setSaveState({ kind: 'idle' });
    }
  }, [saveState]);

  // When provider changes, clear the now-stale model + key so the user
  // explicitly picks them for the new provider (mirrors ConnectionsStep
  // behavior — never silently inherit credentials across providers).
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

  const handleSave = useCallback(async () => {
    setSaveState({ kind: 'validating' });
    setValidation(null);

    // Validate keys before persisting. Same /validate_keys endpoint as
    // onboarding — pass the full draft profile and soul figures out which
    // probes to run from the provider fields.
    try {
      const result = await validateKeys(draft);
      setValidation(result);

      // Only block save when LLM or TTS fails. Agentic failure is a soft
      // warning — user might be saving an in-progress config knowingly.
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
      setSaveState({
        kind: 'error',
        message: `validation failed: ${(err as Error).message}`,
      });
      return;
    }

    // Persist encrypted via safeStorage. No separate /settings PATCH —
    // soul reads byok on each /chat (same flow onboarding uses).
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
      setSaveState({
        kind: 'error',
        message: `save failed: ${(err as Error).message}`,
      });
    }
  }, [draft, graphicsChanged, onSaved]);

  // Provider catalog lookup for the LLM model dropdown.
  const llmProviderInfo = getProvider(draft.llm_provider);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(8, 10, 14, 0.62)',
            backdropFilter: 'blur(28px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.5)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '48px 24px',
            overflowY: 'auto',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            style={{
              width: 'min(560px, 100%)',
              borderRadius: 14,
              background: 'var(--glass-bg-panel, rgba(40, 48, 65, 0.72))',
              backdropFilter: 'blur(40px) saturate(1.7)',
              WebkitBackdropFilter: 'blur(40px) saturate(1.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
              color: 'var(--text-primary, #f0f1f5)',
              fontFamily: 'inherit',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.01em' }}>Settings</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #9aa0ad)', marginTop: 2 }}>
                  Configure LLM, voice, agentic, and graphics — saved encrypted.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close settings"
                onClick={onClose}
                style={iconBtnStyle}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {loading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
                <Loader2 size={20} className="animate-spin" />
                <div style={{ marginTop: 8, fontSize: 12 }}>Loading…</div>
              </div>
            ) : (
              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
                {/* ============================== LLM ============================== */}
                <Section title="Chat (LLM)" hint="Which model talks to you.">
                  <Field label="Provider">
                    <select
                      value={draft.llm_provider ?? ''}
                      onChange={(e) => setProvider((e.target.value || null) as LLMProviderId | null)}
                      style={selectStyle}
                    >
                      <option value="">— pick a provider —</option>
                      {LLM_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </Field>

                  {llmProviderInfo && !llmProviderInfo.dynamicModels && (
                    <Field label="Model">
                      <select
                        value={draft.llm_model ?? ''}
                        onChange={(e) => update('llm_model', e.target.value || null)}
                        style={selectStyle}
                      >
                        <option value="">— pick a model —</option>
                        {llmProviderInfo.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}{m.hint ? ` (${m.hint})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {llmProviderInfo && llmProviderInfo.dynamicModels && (
                    <Field label="Model (Ollama)">
                      <input
                        type="text"
                        placeholder="e.g. ollama:gemma3:4b-it-qat"
                        value={draft.llm_model ?? ''}
                        onChange={(e) => update('llm_model', e.target.value || null)}
                        style={inputStyle}
                      />
                    </Field>
                  )}

                  {llmProviderInfo && llmProviderInfo.requiresApiKey && (
                    <Field
                      label="API key"
                      hint={
                        <a
                          href={llmProviderInfo.signupUrl}
                          onClick={(e) => {
                            e.preventDefault();
                            window.electronAPI?.authOpenExternal?.(llmProviderInfo.signupUrl);
                          }}
                          style={linkStyle}
                        >Get a key</a>
                      }
                    >
                      <input
                        type="password"
                        placeholder="paste your key"
                        value={draft.llm_api_key ?? ''}
                        onChange={(e) => update('llm_api_key', e.target.value || null)}
                        style={inputStyle}
                      />
                    </Field>
                  )}
                </Section>

                {/* ============================== TTS ============================== */}
                <Section title="Voice (TTS)" hint="How the character sounds.">
                  <Field label="Provider">
                    <select
                      value={draft.tts_provider}
                      onChange={(e) => update('tts_provider', e.target.value as TtsProviderId)}
                      style={selectStyle}
                    >
                      <option value="elevenlabs">ElevenLabs (cloud)</option>
                      <option value="kokoro">Kokoro (local, open-weight)</option>
                      <option value="qwen3">Qwen3-TTS (local, larger)</option>
                    </select>
                  </Field>

                  {draft.tts_provider === 'elevenlabs' && (
                    <>
                      <Field label="ElevenLabs API key" hint={
                        <a href="https://elevenlabs.io/app/settings/api-keys"
                           onClick={(e) => { e.preventDefault(); window.electronAPI?.authOpenExternal?.('https://elevenlabs.io/app/settings/api-keys'); }}
                           style={linkStyle}>Get a key</a>
                      }>
                        <input
                          type="password"
                          placeholder="paste your key"
                          value={draft.elevenlabs_api_key ?? ''}
                          onChange={(e) => update('elevenlabs_api_key', e.target.value || null)}
                          style={inputStyle}
                        />
                      </Field>
                      <Field label="Voice ID" hint="Defaults to the Grace clone.">
                        <input
                          type="text"
                          placeholder="zmcVlqmyk3Jpn5AVYcAL"
                          value={draft.elevenlabs_voice ?? ''}
                          onChange={(e) => update('elevenlabs_voice', e.target.value || null)}
                          style={inputStyle}
                        />
                      </Field>
                    </>
                  )}

                  {draft.tts_provider === 'kokoro' && (
                    <Field label="Voice">
                      <input
                        type="text"
                        placeholder="grace_kokoro"
                        value={draft.kokoro_voice ?? ''}
                        onChange={(e) => update('kokoro_voice', e.target.value || null)}
                        style={inputStyle}
                      />
                    </Field>
                  )}

                  {draft.tts_provider === 'qwen3' && (
                    <Field label="Voice">
                      <input
                        type="text"
                        placeholder="grace_qwen3"
                        value={draft.qwen3_voice ?? ''}
                        onChange={(e) => update('qwen3_voice', e.target.value || null)}
                        style={inputStyle}
                      />
                    </Field>
                  )}
                </Section>

                {/* ============================== Agentic ============================== */}
                <Section title="Agentic" hint="Lets the character escalate to a smarter model for tools, search, code.">
                  <Field label={null}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={draft.agentic_enabled}
                        onChange={(e) => update('agentic_enabled', e.target.checked)}
                      />
                      <span>Enable agentic escalation</span>
                    </label>
                  </Field>
                  {draft.agentic_enabled && (
                    <>
                      <Field label="Backend">
                        <select
                          value={draft.agentic_provider}
                          onChange={(e) => update('agentic_provider', e.target.value as 'openai' | 'ollama')}
                          style={selectStyle}
                        >
                          <option value="openai">OpenAI (cloud, smarter)</option>
                          <option value="ollama">Ollama (local, free, reuses chat model)</option>
                        </select>
                      </Field>
                      {draft.agentic_provider === 'openai' && (
                        <>
                          <Field label="OpenAI key" hint={
                            <a href="https://platform.openai.com/api-keys"
                               onClick={(e) => { e.preventDefault(); window.electronAPI?.authOpenExternal?.('https://platform.openai.com/api-keys'); }}
                               style={linkStyle}>Get a key</a>
                          }>
                            <input
                              type="password"
                              placeholder="sk-…"
                              value={draft.agentic_api_key ?? ''}
                              onChange={(e) => update('agentic_api_key', e.target.value || null)}
                              style={inputStyle}
                            />
                          </Field>
                          <Field label="Agentic model">
                            <input
                              type="text"
                              placeholder="gpt-5.4-mini"
                              value={draft.agentic_model ?? ''}
                              onChange={(e) => update('agentic_model', e.target.value || null)}
                              style={inputStyle}
                            />
                          </Field>
                        </>
                      )}
                    </>
                  )}
                </Section>

                {/* ============================== Graphics ============================== */}
                <Section title="Graphics" hint="Character render quality. Higher = better visuals, more battery.">
                  <Field
                    label="Quality"
                    hint={
                      graphicsChanged ? (
                        <span style={{ color: 'var(--accent, #c44444)' }}>
                          Restart the character to apply
                        </span>
                      ) : undefined
                    }
                  >
                    <select
                      value={draft.graphics_quality}
                      onChange={(e) => update('graphics_quality', e.target.value as GraphicsQuality)}
                      style={selectStyle}
                    >
                      <option value="low">Low (default — fits most laptops on battery)</option>
                      <option value="medium">Medium (richer shadows, more skin detail)</option>
                      <option value="high">High (max detail — desktop GPUs recommended)</option>
                    </select>
                  </Field>
                </Section>

                {/* ============================== Status row ============================== */}
                {saveState.kind === 'error' && (
                  <div style={errorStyle}>
                    <AlertCircle size={14} />
                    <span>{saveState.message}</span>
                  </div>
                )}
                {saveState.kind === 'saved' && (
                  <div style={successStyle}>
                    <Check size={14} />
                    <span>Saved.{saveState.graphicsChanged ? ' Restart the character to apply new graphics.' : ''}</span>
                  </div>
                )}
                {validation && (validation.llm.ok || validation.tts.ok) && saveState.kind === 'idle' && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Validation: LLM {validation.llm.ok ? '✓' : '✗'} · TTS {validation.tts.ok ? '✓' : '✗'}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            {!loading && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
                padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
              }}>
                <button type="button" onClick={onClose} style={btnGhostStyle}>
                  {dirty ? 'Discard' : 'Close'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || saveState.kind === 'validating' || saveState.kind === 'saving'}
                  style={{
                    ...btnPrimaryStyle,
                    opacity: dirty && saveState.kind !== 'validating' && saveState.kind !== 'saving' ? 1 : 0.5,
                    cursor: dirty && saveState.kind !== 'validating' && saveState.kind !== 'saving' ? 'pointer' : 'not-allowed',
                  }}
                >
                  {saveState.kind === 'validating' ? 'Validating…'
                    : saveState.kind === 'saving' ? 'Saving…'
                    : 'Save'}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// Layout primitives — kept local so the panel has no design-token deps that
// might drift from the rest of the app. Reuses CSS variables that exist
// throughout Unclaw (--glass-bg-panel, --text-primary, --accent).
// =============================================================================

function Section({
  title, hint, children,
}: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '0.01em' }}>{title}</div>
        {hint && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary, #9aa0ad)', marginTop: 2 }}>{hint}</div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string | null; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      {(label || hint) && (
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 4,
        }}>
          {label && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</span>}
          {hint && <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 6,
  color: 'var(--text-primary, #f0f1f5)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  cursor: 'pointer',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--accent, #c44444)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary, #9aa0ad)',
  borderRadius: 6,
};

const btnGhostStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.10)',
  borderRadius: 6,
  color: 'var(--text-primary, #f0f1f5)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: '8px 18px',
  background: 'var(--accent, #c44444)',
  border: '1px solid var(--accent, #c44444)',
  borderRadius: 6,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
};

const errorStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px',
  background: 'rgba(196, 68, 68, 0.10)',
  border: '1px solid rgba(196, 68, 68, 0.30)',
  borderRadius: 6,
  color: 'var(--accent, #c44444)',
  fontSize: 11.5,
};

const successStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 10px',
  background: 'rgba(107, 214, 107, 0.10)',
  border: '1px solid rgba(107, 214, 107, 0.30)',
  borderRadius: 6,
  color: '#b5e8b5',
  fontSize: 11.5,
};
