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


// ============================================================================
// Model-capability registry — fetched from soul's /capabilities on load
// ============================================================================
//
// Both sides need the same per-model decisions: does it support
// thinking? can it tool-call? at what parameter size? Soul exposes
// `GET /capabilities` as the single source of truth (see
// MODEL_CAPABILITIES in soul/server.py). We fetch it once at startup,
// cache it in module scope, and use it for every UI gating decision.
//
// A small fallback table mirrors the soul-side default so the renderer
// can still function before the fetch resolves (or if the user's soul
// is older than this catalog).

const SOUL_URL = 'http://127.0.0.1:8765';

export type ThinkingProtocol =
  | 'bool'           // Ollama think:bool — Qwen3, DeepSeek-R1, Phi-4-r, Magistral
  | 'levels'         // Ollama think:"low"|"medium"|"high" — gpt-oss only
  | 'template_only'  // Template control tokens, no JSON field — Gemma 4
  | 'responses_api'  // OpenAI Responses API reasoning.effort — gpt-5/o1/o3
  | 'groq_effort'    // Groq reasoning_effort + reasoning_format=hidden
  | 'groq_hidden'    // Groq reasoning_format=hidden only (no effort knob)
  | 'none';

export interface ModelCapability {
  family_pattern: string;
  thinking_protocol: ThinkingProtocol;
  tool_call_min_b: number | null;
  qwen3_tools_guard: boolean;
  groq_extras: string | null;
}

// Mirror of soul's MODEL_CAPABILITIES at the time of writing — used
// only as a fallback when the /capabilities fetch fails or hasn't
// resolved yet. Keep this in rough sync with soul/server.py; the
// runtime fetch is the source of truth.
const FALLBACK_CAPABILITIES: ModelCapability[] = [
  { family_pattern: 'qwen3.5',  thinking_protocol: 'bool',   tool_call_min_b: 1.0,  qwen3_tools_guard: true,  groq_extras: null },
  { family_pattern: 'qwen3',    thinking_protocol: 'bool',   tool_call_min_b: 1.0,  qwen3_tools_guard: true,  groq_extras: 'groq_hidden' },
  { family_pattern: 'deepseek-r1',         thinking_protocol: 'bool', tool_call_min_b: 1.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'deepseek-v3.1',       thinking_protocol: 'bool', tool_call_min_b: 1.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'phi4-reasoning',      thinking_protocol: 'bool', tool_call_min_b: 1.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'phi4-mini-reasoning', thinking_protocol: 'bool', tool_call_min_b: 0.5, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'magistral',           thinking_protocol: 'bool', tool_call_min_b: 7.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'gpt-oss',             thinking_protocol: 'levels', tool_call_min_b: 1.0, qwen3_tools_guard: false, groq_extras: 'groq_effort' },
  { family_pattern: 'gemma4',              thinking_protocol: 'template_only', tool_call_min_b: 4.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'gemma3',              thinking_protocol: 'none', tool_call_min_b: 4.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'llama-3.3',           thinking_protocol: 'none', tool_call_min_b: 70.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'llama3',              thinking_protocol: 'none', tool_call_min_b: 1.0, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'gpt-5',  thinking_protocol: 'responses_api', tool_call_min_b: null, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'o1',     thinking_protocol: 'responses_api', tool_call_min_b: null, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'o3',     thinking_protocol: 'responses_api', tool_call_min_b: null, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'gpt-4o', thinking_protocol: 'none',          tool_call_min_b: null, qwen3_tools_guard: false, groq_extras: null },
  { family_pattern: 'kimi',   thinking_protocol: 'groq_hidden',   tool_call_min_b: null, qwen3_tools_guard: false, groq_extras: 'groq_hidden' },
];

let _capabilitiesCache: ModelCapability[] = FALLBACK_CAPABILITIES;
let _capabilitiesFetched = false;

/** Fetch /capabilities from soul. Idempotent — only the first call
 *  hits the wire; subsequent calls resolve immediately from the
 *  cache. Best-effort: on fetch failure we keep using the fallback
 *  table baked into this file. Call at app startup. */
export async function loadCapabilitiesFromSoul(): Promise<void> {
  if (_capabilitiesFetched) return;
  _capabilitiesFetched = true;
  try {
    const r = await fetch(`${SOUL_URL}/capabilities`);
    if (!r.ok) return;
    const data = await r.json() as { families?: ModelCapability[] };
    if (Array.isArray(data.families) && data.families.length > 0) {
      _capabilitiesCache = data.families;
    }
  } catch {
    // Soul not running / older soul without the endpoint — fallback
    // table stays in effect. Wizard still works.
  }
}

/** Lookup the first-matching capability row for a model id. Mirrors
 *  soul's _model_capability(). Returns null when no row matches. */
function _capabilityFor(modelId: string | null | undefined): ModelCapability | null {
  if (!modelId) return null;
  const m = modelId.toLowerCase();
  for (const row of _capabilitiesCache) {
    if (m.includes(row.family_pattern)) return row;
  }
  return null;
}

/** Parse "0.8b" / "2b" / "8b" / "70b" / "e2b" out of an Ollama model
 *  id. Returns parameter count in billions, or null when no tag-like
 *  suffix is found. Used to gate tools by the family's min_b. */
function _parseModelSizeB(modelId: string): number | null {
  // Strip provider prefix.
  const stripped = modelId.replace(/^ollama:/, '').replace(/^openai:/, '');
  // Match the FIRST size-like token: e?<number>b. e.g. "qwen3:8b" →
  // 8, "gemma4:e2b" → 2, "phi4-mini-reasoning:0.5b" → 0.5.
  const m = stripped.match(/[:\-]e?(\d+(?:\.\d+)?)b\b/i);
  return m ? parseFloat(m[1]) : null;
}

/** Does this model id advertise a reasoning / thinking mode that the
 *  WIZARD can offer a user-facing control for? Hides the dropdown
 *  for protocols we can't actually drive from the JSON request body
 *  (template_only) or for non-reasoning families. */
export function modelSupportsThinking(modelId: string | null | undefined): boolean {
  const cap = _capabilityFor(modelId);
  if (!cap) return false;
  // Show the dropdown for any protocol where the JSON field actually
  // does something. template_only (Gemma 4) is excluded — the model
  // honors thinking via control tokens in the system prompt, but we
  // don't currently inject those, and sending JSON think corrupts
  // the output. Add a separate UI affordance when we wire template
  // tokens in.
  return cap.thinking_protocol === 'bool'
      || cap.thinking_protocol === 'levels'
      || cap.thinking_protocol === 'responses_api'
      || cap.thinking_protocol === 'groq_effort';
}

/** Does this family support native tool calling? Used to gate the
 *  local-agentic toggle. For Ollama models we ALSO check that the
 *  declared size meets the family's tool_call_min_b — soul mirrors
 *  this check at runtime via /api/show. */
export function modelSupportsTools(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const cap = _capabilityFor(modelId);
  if (!cap) return false;
  // Non-Ollama (cloud) entries with tool_call_min_b=null = cloud
  // providers where tool support is universal (handled per-request
  // by the provider's chat-completions / Responses APIs).
  if (cap.tool_call_min_b === null) return true;
  // Ollama families: enforce the size floor where parseable.
  const sizeB = _parseModelSizeB(modelId);
  if (sizeB === null) return true;  // size unknown → assume capable
  return sizeB >= cap.tool_call_min_b;
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
  /** Reasoning depth lever for the LLM on the CHAT tier (the
   *  conversational model the user hears reply to them). Defaults to
   *  'none' so the chat path stays fast by default; users opt in to
   *  deeper thinking for harder questions. Models that don't
   *  advertise thinking treat this as a no-op. See [[ThinkingEffort]]
   *  above for the per-family translation soul performs. */
  thinking_effort: ThinkingEffort;
  /** Reasoning depth lever for the AGENTIC tier (the escalation
   *  loop that runs tool-use for harder questions). Independent
   *  from `thinking_effort` so users can keep chat snappy and let
   *  agentic take its time. Ollama keeps the model in VRAM across
   *  requests regardless of per-request `think` value, so switching
   *  between tiers costs nothing. Falls back to `thinking_effort`
   *  server-side when null/empty. */
  agentic_thinking_effort: ThinkingEffort;
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
  // Agentic tier defaults to 'medium' — it's the reasoning path,
  // takes its time. User can flip it lower for cheap quick-wins or
  // higher for hard agentic problems.
  agentic_thinking_effort:  'medium',
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
