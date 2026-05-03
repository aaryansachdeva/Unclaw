// BYOK ("bring your own keys") scaffolding. Persisted locally via
// Electron safeStorage; nothing is wired into soul yet so the user's
// existing .env keys remain the active path during testing. The
// "sync across devices" toggle is purely cosmetic for now — it goes
// onto the saved blob so the toggle position survives reload, but
// nothing actually syncs.

export type LLMProviderId =
  | 'groq'
  | 'openai'
  | 'claude'
  | 'grok'
  | 'cerebras'
  | 'gemini';

export interface ProviderModel {
  /** Wire id used in API calls. */
  id: string;
  /** What the user sees in the dropdown. */
  label: string;
  /** Optional one-word qualifier rendered after the label, e.g. "fast". */
  hint?: string;
}

export interface ProviderInfo {
  id: LLMProviderId;
  label: string;
  /** Where users can grab a key for this provider. */
  signupUrl: string;
  /** Two or three default models per provider. The wizard surfaces all
   *  of them in the model dropdown, filtered by the active provider.
   *  Order = recommended first. */
  models: ProviderModel[];
}

/** Full catalog. Add models here, not in the wizard component, so the
 *  list stays in one place. */
export const LLM_PROVIDERS: ProviderInfo[] = [
  {
    id: 'groq',
    label: 'Groq',
    signupUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'openai/gpt-oss-20b',       label: 'GPT-OSS 20B',     hint: 'fast' },
      { id: 'llama-3.3-70b-versatile',  label: 'Llama 3.3 70B',   hint: 'smart' },
      { id: 'qwen/qwen3-32b',           label: 'Qwen 3 32B' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    signupUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5.4-mini',  label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4',       label: 'GPT-5.4',       hint: 'smart' },
      { id: 'gpt-5.4-nano',  label: 'GPT-5.4 Nano',  hint: 'fastest' },
    ],
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  hint: 'fast' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   hint: 'smartest' },
    ],
  },
  {
    id: 'grok',
    label: 'Grok (xAI)',
    signupUrl: 'https://console.x.ai/team/keys',
    models: [
      { id: 'grok-4-mini', label: 'Grok 4 Mini' },
      { id: 'grok-4',      label: 'Grok 4' },
      { id: 'grok-code',   label: 'Grok Code',  hint: 'coding' },
    ],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    signupUrl: 'https://cloud.cerebras.ai/platform',
    models: [
      { id: 'llama-3.3-70b',                  label: 'Llama 3.3 70B' },
      { id: 'llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout' },
      { id: 'qwen-3-32b',                     label: 'Qwen 3 32B' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    signupUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        hint: 'smart' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', hint: 'fastest' },
    ],
  },
];

export function getProvider(id: LLMProviderId | null | undefined): ProviderInfo | null {
  if (!id) return null;
  return LLM_PROVIDERS.find((p) => p.id === id) ?? null;
}

export interface ApiKeysProfile {
  /** Selected LLM provider, or null if the user hasn't set one yet. */
  llm_provider: LLMProviderId | null;
  /** Selected model id within that provider. Keep them as a pair so the
   *  app never has to guess "which model goes with this key". */
  llm_model: string | null;
  /** Provider API key (raw — encrypted at rest by safeStorage). */
  llm_api_key: string | null;
  /** ElevenLabs API key for TTS. */
  elevenlabs_api_key: string | null;
  /** When true and the active provider is Gemini, chat requests are
   *  sent with `tools: [{google_search: {}}]` so the model can cite
   *  live web sources. Gemini-only on the model side; no-op when any
   *  other provider is selected. Free tier: 500 grounded requests/day. */
  grounding_search_enabled: boolean;
  /** Cosmetic toggle — when true, the UI tells the user keys will be
   *  synced (encrypted) across their devices. No actual sync yet. */
  sync_across_devices: boolean;
}

export const DEFAULT_API_KEYS: ApiKeysProfile = {
  llm_provider:             null,
  llm_model:                null,
  llm_api_key:              null,
  elevenlabs_api_key:       null,
  grounding_search_enabled: false,
  sync_across_devices:      false,
};

/** Read the persisted blob via the Electron preload. Returns the
 *  default profile when nothing has been saved or the JSON is corrupt. */
export async function fetchApiKeys(): Promise<ApiKeysProfile> {
  const api = window.electronAPI;
  if (!api?.apiKeysGet) return { ...DEFAULT_API_KEYS };
  try {
    const raw = await api.apiKeysGet();
    if (!raw) return { ...DEFAULT_API_KEYS };
    const parsed = JSON.parse(raw) as Partial<ApiKeysProfile>;
    return { ...DEFAULT_API_KEYS, ...parsed };
  } catch (err) {
    console.warn('[apiKeys] fetch failed, using defaults', err);
    return { ...DEFAULT_API_KEYS };
  }
}

/** JSON-encode and persist. Caller treats the boolean as best-effort —
 *  a false return means safeStorage failed and the keys were not saved. */
export async function saveApiKeys(profile: ApiKeysProfile): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.apiKeysSet) return false;
  try {
    return await api.apiKeysSet(JSON.stringify(profile));
  } catch (err) {
    console.warn('[apiKeys] save failed', err);
    return false;
  }
}

export async function clearApiKeys(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.apiKeysClear) return false;
  try {
    return await api.apiKeysClear();
  } catch (err) {
    console.warn('[apiKeys] clear failed', err);
    return false;
  }
}
