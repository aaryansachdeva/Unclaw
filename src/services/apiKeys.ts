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

/** Reasoning depth lever sent to soul on every /chat request. Soul
 *  translates per-family:
 *    * Ollama `think` — bool for Qwen3/DeepSeek-R1/Phi-4-reasoning/
 *      Magistral/Gemma 4; level string ("low"|"medium"|"high") for
 *      gpt-oss; absent for Gemma 3 / Llama (no-op).
 *    * Groq `reasoning_effort` for gpt-oss; `reasoning_format=hidden`
 *      for qwen3/kimi.
 *    * OpenAI escalation `reasoning.effort` (Responses API).
 *  'none' = thinking off (or as off as the family allows — gpt-oss
 *  can't be fully turned off and falls back to "low" upstream). */
export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high';

/** Which provider runs the agentic / escalation loop when
 *  `agentic_enabled` is true.
 *    * 'openai' (default) — soul's existing OpenAI Responses-API
 *      loop with full MCP toolset + web search.
 *    * 'ollama' — soul runs the same loop locally against the user's
 *      Ollama chat model, requiring no cloud key. Only valid when the
 *      chat model is itself an Ollama tool-capable model. */
export type AgenticProvider = 'openai' | 'ollama';


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


/** Heuristic family check: does this model id advertise a reasoning /
 *  thinking mode? Used to gate the thinking-effort dropdown so users
 *  don't see a no-op control on Gemma 3 / Llama / plain chat models.
 *
 *  Conservative — pattern-matches against the prefixed wire form
 *  (e.g. 'ollama:qwen3:8b', 'openai:gpt-5.4-mini', 'openai/gpt-oss-20b').
 *  Soul also feature-detects via Ollama's /api/show capabilities
 *  before sending `think`; this client-side check is just for UI
 *  gating. */
export function modelSupportsThinking(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const m = modelId.toLowerCase();
  // gpt-oss (level string on Ollama; reasoning_effort on Groq).
  if (m.includes('gpt-oss')) return true;
  // OpenAI cloud reasoning family. gpt-5.4-* honors reasoning.effort
  // on the Responses API (escalation), gpt-4o-* does not.
  if (m.startsWith('openai:gpt-5')) return true;
  // Bool-thinking Ollama families.
  if (m.includes('qwen3') && !m.includes('qwen3.5')) return true;
  if (m.includes('deepseek-r1') || m.includes('deepseek-v3.1')) return true;
  if (m.includes('phi4-reasoning') || m.includes('phi4-mini-reasoning')) return true;
  if (m.includes('magistral')) return true;
  if (m.includes('gemma4')) return true;
  return false;
}


/** Heuristic family check: does this model id support native tool
 *  calling? Used to gate the local-agentic toggle so users on a
 *  non-tool model see a clear "your model can't do this" hint
 *  instead of an enabled toggle that 502s on first agentic request.
 *
 *  Cloud providers all support tools through Chat Completions /
 *  Responses APIs. For Ollama, this is a name-pattern guess; soul
 *  re-checks via /api/show capabilities at request time and falls
 *  back to a structured-text path if the model lies. */
export function modelSupportsTools(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const m = modelId.toLowerCase();
  // Cloud (OpenAI native function calling, Groq OpenAI-compat).
  if (m.startsWith('openai:')) return true;
  if (m.includes('gpt-oss')) return true;
  if (m.includes('qwen/qwen3')) return true;
  if (m.includes('llama-3')) return true;
  // Ollama families with verified tool support. Small models (< 1B
  // params) advertise the `tools` capability but fail mid-call —
  // soul has `_OLLAMA_TOOLS_MIN_PARAM_B = 1.0` as a runtime gate that
  // would fall back to the structured-text path for sub-1B models.
  // Mirror that gate here so the wizard doesn't surface agentic for
  // a model soul will silently downgrade.
  if (m.startsWith('ollama:')) {
    const isSubOneBillion =
      m.includes(':0.6b') || m.includes(':0.8b') ||
      m.includes(':0.9b') || m.includes(':1b');
    if (m.includes('qwen3') && !isSubOneBillion) return true;
    if (m.includes('gemma3') && !m.includes(':1b')) return true;
    if (m.includes('gemma4')) return true;
    if (m.includes('deepseek-r1') && !isSubOneBillion) return true;
    if (m.includes('phi4-reasoning') || m.includes('phi4-mini-reasoning')) return true;
    if (m.includes('magistral')) return true;
    if (m.includes('llama3.1') || m.includes('llama3.2') || m.includes('llama3.3')) return true;
  }
  return false;
}


/** TTS provider the user picked.
 *  - elevenlabs: cloud / BYOK API key
 *  - kokoro: local 82M open-weight model (~325 MB), soul in-process
 *  - qwen3: local 0.6B model in an isolated subprocess venv (~5 GB
 *           total install: torch+transformers deps + HF model + voice). */
export type TtsProviderId = 'elevenlabs' | 'kokoro' | 'qwen3';

/** Sub-mode when `tts_provider === 'kokoro'`. `recommended` = soul
 *  downloads + runs Kokoro locally; `custom` = user has Kokoro
 *  running elsewhere (kokoro-fastapi, etc.) and provides the URL. */
export type KokoroMode = 'recommended' | 'custom';


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
  /** Selected TTS provider. Defaults to ElevenLabs (cloud) for new
   *  users; can switch to Kokoro (local, open-weight) any time. */
  tts_provider: TtsProviderId;
  /** ElevenLabs API key for TTS. Required only when
   *  `tts_provider === 'elevenlabs'`. */
  elevenlabs_api_key: string | null;
  /** ElevenLabs voice id. Defaults to Grace (the persona-canonical
   *  cloned voice). Power users can override with their own voice id
   *  from the ElevenLabs voice library. Only consulted when
   *  `tts_provider === 'elevenlabs'`. Without this the request would
   *  fall back to soul's default (Rachel) which sounds nothing like
   *  Grace and reads as "wrong voice" to the user. */
  elevenlabs_voice: string | null;
  /** Kokoro sub-mode. Only consulted when `tts_provider === 'kokoro'`. */
  kokoro_mode: KokoroMode;
  /** Custom Kokoro endpoint URL (e.g. http://localhost:8880 for a
   *  local kokoro-fastapi). Only used when
   *  `tts_provider === 'kokoro' && kokoro_mode === 'custom'`. */
  kokoro_endpoint: string | null;
  /** Selected Kokoro voice id (e.g. 'af_heart'). Soul passes this to
   *  whichever Kokoro path runs (local or remote). Falls back to
   *  af_heart if null. */
  kokoro_voice: string | null;
  /** Selected Qwen3-TTS voice id (e.g. 'grace_qwen3'). Only consulted
   *  when `tts_provider === 'qwen3'`. Defaults to the Grace clone soul
   *  downloads during install. */
  qwen3_voice: string | null;
  /** Agentic features toggle. When false (default), the 20b's
   *  `escalate` action is suppressed in the system prompt and the
   *  fast-escalation regex no-ops; soul never spins up the OpenAI
   *  Responses-API loop. When true, escalation is live and uses the
   *  user-supplied agentic_model + agentic_api_key (or the chat
   *  provider's key if `agentic_use_same_as_chat` is on AND chat
   *  provider is OpenAI). */
  agentic_enabled: boolean;
  /** When true AND `llm_provider === 'openai'`, escalation reuses
   *  the conversational model + key. When the chat provider isn't
   *  OpenAI this flag has no effect (soul still needs an OpenAI key
   *  for escalation since gpt-5.4-mini-class is the only supported
   *  agentic backend in v1). */
  agentic_use_same_as_chat: boolean;
  /** OpenAI model id used for the agentic loop (e.g. 'gpt-5.4-mini').
   *  Required when `agentic_enabled` is true unless
   *  `agentic_use_same_as_chat` is on AND chat is already OpenAI. */
  agentic_model: string | null;
  /** OpenAI API key for the agentic loop. Required when
   *  `agentic_enabled` is true unless `agentic_use_same_as_chat` is
   *  on AND chat is already OpenAI (in which case llm_api_key is
   *  reused). */
  agentic_api_key: string | null;
  /** Gemini API key — used ONLY for Google Search grounding (a separate
   *  feature from the chat provider). When `grounding_search_enabled` is
   *  true and this key is set, escalation calls can include
   *  `tools: [{google_search: {}}]` to cite live web sources. The chat
   *  provider stays whatever the user picked (Groq / OpenAI / Ollama). */
  gemini_search_api_key: string | null;
  /** When true (and gemini_search_api_key is set), grounded search is
   *  active for queries that need live data. Free tier: 500/day. */
  grounding_search_enabled: boolean;
  /** Reasoning depth lever for the LLM. Defaults to 'none' so the
   *  chat path stays fast by default; users opt in to deeper thinking
   *  for harder questions. Models that don't advertise thinking
   *  treat this as a no-op. See [[ThinkingEffort]] above for the
   *  per-family translation soul performs. */
  thinking_effort: ThinkingEffort;
  /** Backend that runs the agentic loop. Defaults to 'openai' for
   *  back-compat with the existing wizard. When the chat provider is
   *  Ollama AND the model supports tools, the wizard flips this to
   *  'ollama' so escalation runs locally with no cloud key. */
  agentic_provider: AgenticProvider;
}


export const DEFAULT_API_KEYS: ApiKeysProfile = {
  llm_provider:             null,
  llm_model:                null,
  llm_api_key:              null,
  ollama_base_url:          null,
  tts_provider:             'elevenlabs',
  elevenlabs_api_key:       null,
  // Grace's cloned voice on ElevenLabs (the persona-canonical voice).
  // Power users can override with their own voice id; existing users
  // who saved a profile before this field existed get this default
  // via migrateApiKeys' spread-with-defaults pattern.
  elevenlabs_voice:         'zmcVlqmyk3Jpn5AVYcAL',
  kokoro_mode:              'recommended',
  kokoro_endpoint:          null,
  // Default to the KVoiceWalk-evolved Grace clone (`grace_kokoro.pt`),
  // which soul downloads from files.fotonlabs.com during install. New
  // users get persona-consistent voice out of the box if they pick
  // Kokoro; they can still flip to any of the bundled 54 voices.
  kokoro_voice:             'grace_kokoro',
  qwen3_voice:              'grace_qwen3',
  agentic_enabled:          false,
  agentic_use_same_as_chat: false,
  agentic_model:            null,
  agentic_api_key:          null,
  gemini_search_api_key:    null,
  grounding_search_enabled: false,
  thinking_effort:          'none',
  agentic_provider:         'openai',
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
 *  LLM rules:
 *    * llm_provider must be set
 *    * llm_model must be set
 *    * llm_api_key required when the provider isn't Ollama
 *
 *  TTS rules vary by provider:
 *    * elevenlabs → elevenlabs_api_key required
 *    * kokoro recommended → no field-level requirement here; install
 *        state is checked separately by ConnectionsStep via the
 *        /tts/kokoro/status endpoint (TS doesn't see disk state)
 *    * kokoro custom → kokoro_endpoint URL required
 *
 *  Returns the list of missing-field labels (UI-readable). Empty list
 *  means the field-level prereqs are met (Kokoro install state is
 *  validated at Check-keys time, not here). */
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
  if (profile.tts_provider === 'kokoro') {
    if (profile.kokoro_mode === 'custom' && !profile.kokoro_endpoint?.trim()) {
      missing.push('Kokoro endpoint URL');
    }
    // 'recommended' mode: install state lives on soul's disk; the
    // wizard's Check Keys step calls /validate_keys which probes that
    // state and surfaces "not installed" as a per-row failure with an
    // Install Kokoro button — no field-level entry needed here.
  } else if (profile.tts_provider === 'qwen3') {
    // Same shape as Kokoro recommended: install state checked at
    // Check-Keys time, install panel surfaces a hard failure when
    // the venv / model / voice aren't on disk yet. No field-level
    // requirement at this layer.
  } else {
    if (!profile.elevenlabs_api_key) missing.push('ElevenLabs API key');
  }
  // Agentic gates: only enforced when the user opted in.
  if (profile.agentic_enabled) {
    if (profile.agentic_provider === 'ollama') {
      // Local agentic: chat must be on a tools-capable Ollama model.
      // No agentic_model / agentic_api_key needed — the chat model is
      // the agentic model.
      if (profile.llm_provider !== 'ollama') {
        missing.push('Local agentic needs Ollama as the chat provider');
      } else if (!modelSupportsTools(profile.llm_model)) {
        missing.push('Local agentic needs a tools-capable Ollama model');
      }
    } else {
      // OpenAI agentic (existing behavior).
      const reuseChat = profile.agentic_use_same_as_chat
        && profile.llm_provider === 'openai'
        && !!profile.llm_api_key;
      if (!profile.agentic_model && !reuseChat) {
        missing.push('Agentic model');
      }
      if (!reuseChat && !profile.agentic_api_key) {
        missing.push('OpenAI key for agentic');
      }
    }
  }
  // Gemini grounded-search gate: only enforced when the user opted in.
  if (profile.grounding_search_enabled && !profile.gemini_search_api_key) {
    missing.push('Gemini API key for grounded search');
  }
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
  /** True iff every requested probe (`llm`, `tts`, optionally
   *  `agentic`) succeeded. */
  ok: boolean;
  llm: KeyValidationOutcome;
  /** Provider-agnostic TTS outcome (works for ElevenLabs / Kokoro /
   *  Qwen3). Carries a `provider` tag so the wizard can render the
   *  right label next to the row. */
  tts: KeyValidationOutcome & { provider: 'elevenlabs' | 'kokoro' | 'qwen3' };
  /** Legacy alias — pre-Kokoro versions of the wizard read this. New
   *  code should use `tts` instead. Soul still emits both for back-
   *  compat. */
  elevenlabs: KeyValidationOutcome;
  /** Optional — only present when `agentic_enabled` was true in the
   *  request. Probes the OpenAI key + model used for the escalation
   *  loop. Wizard renders a third row when this is set. */
  agentic?: KeyValidationOutcome;
  /** Optional — only present when `grounding_search_enabled` was true.
   *  Probes the Gemini key used for the escalation web_search tool. */
  gemini_search?: KeyValidationOutcome;
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
      tts_provider:        profile.tts_provider,
      // Only thread the endpoint when we're in custom mode; soul
      // treats empty/null as "use local install".
      kokoro_endpoint:
        profile.tts_provider === 'kokoro' && profile.kokoro_mode === 'custom'
          ? (profile.kokoro_endpoint || null)
          : null,
      // Agentic — soul probes the OpenAI key + model when enabled and
      // backend is cloud; for local-Ollama backend there's no probe
      // (the model itself is on localhost and either reachable or not,
      // which the LLM probe already covers). Forwarding the provider
      // tag tells soul which probe path to take — without it, soul
      // defaults to OpenAI and fails validation for local-agentic
      // users who have no cloud key.
      agentic_enabled:     profile.agentic_enabled,
      agentic_provider:    profile.agentic_provider,
      agentic_model:       profile.agentic_model,
      agentic_api_key:     profile.agentic_use_same_as_chat
                            && profile.llm_provider === 'openai'
                              ? profile.llm_api_key
                              : profile.agentic_api_key,
      // Gemini grounded-search — soul probes the key when enabled.
      grounding_search_enabled: profile.grounding_search_enabled,
      gemini_search_api_key:    profile.gemini_search_api_key,
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
