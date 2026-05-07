// BYOK ("bring your own keys") storage. Keys persist on the user's
// machine via Electron `safeStorage` (Windows DPAPI / macOS Keychain /
// Linux gnome-keyring) at <userData>/apiKeys.bin — encrypted at rest,
// never leaves the device, never sent anywhere except directly to the
// chosen provider on chat requests.
//
// Catalog scope (intentionally tight): three small-model chat providers
// match what soul natively dispatches. Adding a provider here also
// requires soul-side support in `_select_provider` + an allowlist entry.

export type LLMProviderId =
  | 'groq'      // Groq Cloud — qwen3-32b, gpt-oss-20b, llama-3.3-70b
  | 'openai'    // OpenAI Cloud — gpt-4o-mini default, gpt-5.4 family
  | 'ollama';   // Local Ollama daemon — any locally-pulled model


export interface ProviderModel {
  /** Wire id used in API calls. For ollama, this is the prefixed form
   *  ('ollama:gemma3:4b-it-qat') so soul can dispatch directly. */
  id: string;
  /** What the user sees in the dropdown. */
  label: string;
  /** Optional one-word qualifier rendered after the label, e.g. "fast". */
  hint?: string;
}


export interface ProviderInfo {
  id: LLMProviderId;
  label: string;
  /** Where users can grab a key for this provider. Empty for Ollama
   *  (local install link). */
  signupUrl: string;
  /** Whether this provider needs an API key. Ollama runs locally and
   *  doesn't, so we hide the key field for it. */
  requiresApiKey: boolean;
  /** When true, the model dropdown is populated at runtime from soul's
   *  GET /providers endpoint (live /api/tags scan) instead of from the
   *  static `models` array below. Used for Ollama since the user's set
   *  of locally-installed models isn't knowable until soul asks. */
  dynamicModels?: boolean;
  /** Static fallback model list for cloud providers. Order = recommended
   *  first. For dynamic-models providers (Ollama), this can be empty. */
  models: ProviderModel[];
}


/** Static catalog. Cloud providers list a curated handful of models;
 *  Ollama's list is fetched live from soul. Adding to this list also
 *  needs a matching `_select_provider` branch in soul/server.py. */
export const LLM_PROVIDERS: ProviderInfo[] = [
  {
    id: 'groq',
    label: 'Groq',
    signupUrl: 'https://console.groq.com/keys',
    requiresApiKey: true,
    models: [
      { id: 'openai/gpt-oss-20b',       label: 'GPT-OSS 20B',     hint: 'fast' },
      { id: 'qwen/qwen3-32b',           label: 'Qwen 3 32B' },
      { id: 'llama-3.3-70b-versatile',  label: 'Llama 3.3 70B',   hint: 'smart' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    signupUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    models: [
      { id: 'openai:gpt-4o-mini',  label: 'GPT-4o mini',   hint: 'fast' },
      { id: 'openai:gpt-4o',       label: 'GPT-4o',        hint: 'smart' },
      { id: 'openai:gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'openai:gpt-5.4-nano', label: 'GPT-5.4 Nano',  hint: 'fastest' },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    signupUrl: 'https://ollama.com/download',
    requiresApiKey: false,
    dynamicModels: true,
    // Populated at runtime from soul's GET /providers — keep this empty
    // so callers know to hit the live endpoint. The wizard surfaces a
    // loading state until the first response arrives.
    models: [],
  },
];

/** Set of provider ids the catalog currently supports. Used by
 *  fetchApiKeys to defensively reset stale `llm_provider` values
 *  (e.g. saved when Claude/Grok/Cerebras/Gemini were chat options). */
const VALID_PROVIDER_IDS: ReadonlySet<string> = new Set(
  LLM_PROVIDERS.map((p) => p.id),
);


export function getProvider(id: LLMProviderId | null | undefined): ProviderInfo | null {
  if (!id) return null;
  return LLM_PROVIDERS.find((p) => p.id === id) ?? null;
}


export interface ApiKeysProfile {
  /** Selected LLM provider for chat, or null if the user hasn't set one. */
  llm_provider: LLMProviderId | null;
  /** Selected model id within that provider. Keep them as a pair so the
   *  app never has to guess "which model goes with this key". For Ollama,
   *  this is the prefixed form 'ollama:<tag>'. */
  llm_model: string | null;
  /** Chat provider's API key (raw — encrypted at rest by safeStorage).
   *  Null when the chosen provider doesn't need one (Ollama). */
  llm_api_key: string | null;
  /** Optional override of Ollama's daemon URL. Falls back to soul's
   *  default (http://localhost:11434) when null/empty — set this only
   *  if the user runs Ollama on a different host or non-default port. */
  ollama_base_url: string | null;
  /** ElevenLabs API key for TTS. */
  elevenlabs_api_key: string | null;
  /** Gemini API key — used ONLY for Google Search grounding (a separate
   *  feature from the chat provider). When `grounding_search_enabled` is
   *  true and this key is set, escalation calls can include
   *  `tools: [{google_search: {}}]` to cite live web sources. The chat
   *  provider stays whatever the user picked (Groq / OpenAI / Ollama). */
  gemini_search_api_key: string | null;
  /** When true (and gemini_search_api_key is set), grounded search is
   *  active for queries that need live data. Free tier: 500/day. */
  grounding_search_enabled: boolean;
  /** Cosmetic toggle — when true, the UI tells the user keys will be
   *  synced (encrypted) across their devices. No actual sync yet. */
  sync_across_devices: boolean;
}


export const DEFAULT_API_KEYS: ApiKeysProfile = {
  llm_provider:             null,
  llm_model:                null,
  llm_api_key:              null,
  ollama_base_url:          null,
  elevenlabs_api_key:       null,
  gemini_search_api_key:    null,
  grounding_search_enabled: false,
  sync_across_devices:      false,
};


/** Defensively coerce a parsed blob into the current ApiKeysProfile shape.
 *  Old saved data may carry deprecated chat provider ids (claude, grok,
 *  cerebras, gemini) — we null those out so the wizard re-prompts the
 *  user instead of trying to dispatch to a backend soul doesn't support. */
function migrateApiKeys(parsed: Partial<ApiKeysProfile>): ApiKeysProfile {
  const merged: ApiKeysProfile = { ...DEFAULT_API_KEYS, ...parsed };
  if (merged.llm_provider && !VALID_PROVIDER_IDS.has(merged.llm_provider)) {
    // Stale provider — drop the {provider, model, key} triple together
    // so the user gets prompted to pick from the new catalog.
    merged.llm_provider = null;
    merged.llm_model = null;
    merged.llm_api_key = null;
  }
  return merged;
}


/** Read the persisted blob via the Electron preload. Returns the
 *  default profile when nothing has been saved or the JSON is corrupt. */
export async function fetchApiKeys(): Promise<ApiKeysProfile> {
  const api = window.electronAPI;
  if (!api?.apiKeysGet) return { ...DEFAULT_API_KEYS };
  try {
    const raw = await api.apiKeysGet();
    if (!raw) return { ...DEFAULT_API_KEYS };
    const parsed = JSON.parse(raw) as Partial<ApiKeysProfile>;
    return migrateApiKeys(parsed);
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


/** Required-field check for the onboarding wizard's Finish gate AND
 *  any pre-flight check before calling soul's /chat. Soul refuses to
 *  fall back to env keys for the user-facing chat path, so missing any
 *  of these means the next chat will 400. Surface them inline in the
 *  Connections step instead of letting the user discover them on send.
 *
 *  Rules:
 *    * llm_provider must be set
 *    * llm_model must be set
 *    * llm_api_key required when the provider isn't Ollama
 *    * elevenlabs_api_key always required (no free TTS path today)
 *
 *  Returns the list of missing-field labels (UI-readable). Empty list
 *  means the keys are good to go. */
export function missingRequiredKeyFields(profile: ApiKeysProfile): string[] {
  const missing: string[] = [];
  const provider = getProvider(profile.llm_provider);
  if (!provider) {
    missing.push('LLM provider');
  } else {
    if (!profile.llm_model) missing.push('Model');
    if (provider.requiresApiKey && !profile.llm_api_key) {
      missing.push(`${provider.label} API key`);
    }
  }
  if (!profile.elevenlabs_api_key) missing.push('ElevenLabs API key');
  return missing;
}


// =============================================================================
// Pre-flight key validation (onboarding's Check Keys button)
// =============================================================================
//
// Hits soul's POST /validate_keys, which probes the user's chosen LLM
// provider and ElevenLabs via cheap read-only endpoints (Groq's /models,
// OpenAI's /models, Ollama's /api/tags, ElevenLabs's /v1/user) IN
// PARALLEL and returns per-key results. Surfaces a typo as a precise
// error during onboarding instead of as a 502 on first chat.

const SOUL_URL = 'http://127.0.0.1:8765';

export interface KeyValidationOutcome {
  ok: boolean;
  /** Human-readable error when ok=false. Safe to show inline. */
  error?: string;
}

export interface KeyValidationResult {
  /** True iff both `llm.ok` and `elevenlabs.ok` are true. */
  ok: boolean;
  llm: KeyValidationOutcome;
  elevenlabs: KeyValidationOutcome;
}

/** Soul probes each provider's API with the supplied keys in parallel.
 *  Network failures (soul down, etc.) reject; per-key validation
 *  failures (wrong key, etc.) resolve with `ok: false` + an error. */
export async function validateKeys(
  profile: ApiKeysProfile,
): Promise<KeyValidationResult> {
  const res = await fetch(`${SOUL_URL}/validate_keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      llm_provider:        profile.llm_provider,
      llm_model:           profile.llm_model,
      llm_api_key:         profile.llm_api_key,
      elevenlabs_api_key:  profile.elevenlabs_api_key,
    }),
  });
  if (!res.ok) {
    throw new Error(`soul /validate_keys ${res.status}`);
  }
  return (await res.json()) as KeyValidationResult;
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
