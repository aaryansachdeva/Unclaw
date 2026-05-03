// Step 4 — fully optional. BYOK fields: provider + model dropdowns,
// LLM key, ElevenLabs key, and a cosmetic sync-across-devices toggle.
//
// Scaffolding only — saved via Electron safeStorage. The renderer
// continues to use whatever keys soul has in its .env until the chat
// path is wired through to read these. The toggle stores its position
// alongside the keys but doesn't actually do anything yet; the UI
// promises encryption (which safeStorage already provides at rest;
// future cloud sync would add E2E on top).

import { useMemo, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Lock, Search, ExternalLink } from 'lucide-react';
import { StepHeader } from './StepHeader';
import {
  LLM_PROVIDERS,
  getProvider,
  type ApiKeysProfile,
  type LLMProviderId,
} from '../../services/apiKeys';

interface Props {
  values: ApiKeysProfile;
  onChange: (next: ApiKeysProfile) => void;
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

export function ConnectionsStep({ values, onChange }: Props) {
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showElevenKey, setShowElevenKey] = useState(false);

  const provider = getProvider(values.llm_provider);
  // Models filtered by the active provider. When no provider is picked
  // yet, the model dropdown is disabled and shows a quiet placeholder.
  const models = useMemo(() => provider?.models ?? [], [provider]);

  const setProvider = (id: LLMProviderId | '') => {
    if (!id) {
      onChange({ ...values, llm_provider: null, llm_model: null });
      return;
    }
    const next = getProvider(id);
    // Snap the model to the first one in the new provider's list — keeps
    // the pair consistent and avoids "model belongs to old provider"
    // states across re-renders.
    onChange({
      ...values,
      llm_provider: id,
      llm_model: next?.models[0]?.id ?? null,
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

  const setSync = (sync: boolean) => {
    onChange({ ...values, sync_across_devices: sync });
  };

  const setGrounding = (enabled: boolean) => {
    onChange({ ...values, grounding_search_enabled: enabled });
  };

  const groundingActive = values.llm_provider === 'gemini';

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      <div style={{ width: 180, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader
          title="Bring your own keys."
          subtitle="Optional. Stored encrypted on this device — wire your own model and voice if you want."
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
            <SelectField
              value={values.llm_provider ?? ''}
              onChange={(v) => setProvider(v as LLMProviderId | '')}
              placeholder="Choose…"
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id} style={{ background: 'var(--bg-elevated)' }}>
                  {p.label}
                </option>
              ))}
            </SelectField>
          </FieldLabel>

          <FieldLabel text="Model" style={{ flex: 1.2 }}>
            <SelectField
              value={values.llm_model ?? ''}
              onChange={setModel}
              disabled={!provider}
              placeholder={provider ? 'Choose a model' : 'Pick a provider first'}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id} style={{ background: 'var(--bg-elevated)' }}>
                  {m.hint ? `${m.label} — ${m.hint}` : m.label}
                </option>
              ))}
            </SelectField>
          </FieldLabel>
        </div>

        <FieldLabel text={provider ? `${provider.label} API key` : 'LLM API key'}>
          <SecretInput
            value={values.llm_api_key ?? ''}
            onChange={setLlmKey}
            placeholder={provider ? `Paste your ${provider.label} key` : 'sk-…'}
            visible={showLlmKey}
            onToggleVisible={() => setShowLlmKey((v) => !v)}
            autoComplete="off"
          />
        </FieldLabel>

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

        <Toggle
          value={values.grounding_search_enabled}
          onChange={setGrounding}
          icon={<Search size={11} strokeWidth={2} aria-hidden style={{ opacity: 0.7 }} />}
          title="Google Search grounding"
          helper={
            groundingActive
              ? 'Lets Gemini cite live web results. Free up to 500 grounded requests/day.'
              : 'Gemini-only — pick Gemini above to enable. Adds live web citations to answers.'
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
      </div>
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
          fontSize: 11,
          color: 'var(--text-secondary)',
          letterSpacing: '0.06em',
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

function SelectField({
  value,
  onChange,
  children,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        onFocus={(e) => !disabled && applyFocus(e.target)}
        onBlur={(e) => applyBlur(e.target)}
        style={{
          ...FIELD_BASE,
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          paddingRight: 32,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          color: value ? 'var(--text-primary)' : 'var(--text-ghost)',
        }}
      >
        <option value="" style={{ background: 'var(--bg-elevated)' }}>
          {placeholder ?? 'Choose…'}
        </option>
        {children}
      </select>
      <ChevronDown
        size={14}
        strokeWidth={1.8}
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          right: 12,
          transform: 'translateY(-50%)',
          color: 'var(--text-ghost)',
          pointerEvents: 'none',
          opacity: disabled ? 0.4 : 1,
        }}
      />
    </div>
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
        fontSize: 10.5,
        letterSpacing: '0.06em',
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
            fontSize: 11,
            color: 'var(--text-secondary)',
            letterSpacing: '0.005em',
            lineHeight: 1.4,
          }}
        >
          {helper}
        </span>
      </span>
    </button>
  );
}
