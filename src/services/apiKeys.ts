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

/** Which backend runs the agentic / escalation loop. `'openai'` (default)
 *  uses the Responses API + gpt-5.4 family. `'ollama'` uses a local
 *  Chat-Completions tool loop on the SAME model the user picked for
 *  chat — no separate model dropdown, no OpenAI key required. The wizard
 *  only surfaces the local option when chat is a tools-capable Ollama
 *  model (see modelSupportsTools). */
export type AgenticProvider = 'openai' | 'ollama';

/** Per-tier thinking lever. Resolved per-family on the soul side:
 *  - 'none'   → omit `think` field; for Gemma 4 also omit the system-
 *               prompt `<|think|>` token. For gpt-oss (no real off)
 *               falls through to 'low'.
 *  - 'low'/'medium'/'high' → enable thinking. Levels apply natively
 *               to gpt-oss; for Qwen / DeepSeek they coerce to
 *               `think: true`; for Gemma 4 they prepend `<|think|>`.
 *  Chat default = 'none' (snappy conversational); agentic default =
 *  'medium' (escalation is the reasoning path). */
export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high';

/** Per-family configuration mirror — kept in sync with soul's
 *  `_FAMILY_INFO`. We use this for the wizard's "Optimized" badge
 *  and the thinking-dropdown gating. Source of truth is the soul
 *  Python; the renderer just needs enough to drive UI.
 *
 *  Keys are substrings of the (case-folded, prefix-stripped) model
 *  tag. Lookup walks longest-first so 'qwen3.6' matches before 'qwen3',
 *  'llama3.3' before 'llama3', etc. */
type LocalFamilyInfo = {
  /** Show "Optimized" badge — we've validated tool calling + thinking
   *  on this family with per-family helpers (native-token fallback
   *  parsers etc.). */
  optimized: boolean;
  /** Family supports a `<think>` block / chain-of-thought. Drives the
   *  thinking-effort dropdown's visibility. */
  thinks: boolean;
  /** Family accepts image input. Drives the image-attach button in
   *  chat UI and the "Vision" badge on the wizard's model dropdown.
   *  Mirrors soul's `_FAMILY_INFO.vision` flag. */
  vision: boolean;
  /** Effective tool-call minimum size in B (name-parsed). Sub-floor
   *  variants drop the local-agentic picker. */
  toolMinB: number;
};

const _LOCAL_FAMILIES: ReadonlyArray<readonly [string, LocalFamilyInfo]> = [
  // Qwen — dedicated vision variants first so the substring lookup
  // matches them before the text-only siblings.
  ['qwen3-vl',    { optimized: true,  thinks: true,  vision: true,  toolMinB: 1.0 }],
  ['qwen2.5-vl',  { optimized: false, thinks: false, vision: true,  toolMinB: 3.0 }],
  ['qwen3.6',     { optimized: true,  thinks: true,  vision: false, toolMinB: 1.0 }],
  // Floor dropped 8.0 → 2.0 after 2026-05-13 sweep — qwen3.5:2b nails
  // tool calling at every thinking level. vision=false: Ollama's
  // GGUF + mmproj split blocks qwen3.5 vision; use qwen3-vl instead.
  ['qwen3.5',     { optimized: true,  thinks: true,  vision: false, toolMinB: 2.0 }],
  ['qwen3-coder', { optimized: true,  thinks: true,  vision: false, toolMinB: 8.0 }],
  ['qwen3',       { optimized: true,  thinks: true,  vision: false, toolMinB: 4.0 }],
  ['qwen2.5',     { optimized: false, thinks: false, vision: false, toolMinB: 7.0 }],
  // Gemma — every Gemma 4 size is multimodal per Google; Gemma 3 4B+
  // is multimodal. The family-wide flag is True; runtime size floor
  // / Ollama capability check handles edge cases.
  ['gemma4',      { optimized: true,  thinks: true,  vision: true,  toolMinB: 4.0 }],
  ['gemma3',      { optimized: true,  thinks: false, vision: true,  toolMinB: 4.0 }],
  // Llama — order matters: vision variants + 'llama3-groq' before
  // generic 'llama3' so the more-specific match wins.
  ['llama3.2-vision', { optimized: true, thinks: false, vision: true, toolMinB: 11.0 }],
  ['llama4',      { optimized: true,  thinks: false, vision: true,  toolMinB: 16.0 }],
  ['llama3.3',    { optimized: true,  thinks: false, vision: false, toolMinB: 70.0 }],
  ['llama3.2',    { optimized: false, thinks: false, vision: false, toolMinB: 3.0 }],
  ['llama3.1',    { optimized: true,  thinks: false, vision: false, toolMinB: 70.0 }],
  // Groq's tool-use fine-tune of Llama 3 8B — Hermes JSON tool_calls.
  // Validated end-to-end on chat + escalation per 2026-05-13 sweep.
  ['llama3-groq', { optimized: true,  thinks: false, vision: false, toolMinB: 8.0 }],
  // Plain Llama 3.0 base. Conservative 8B floor.
  ['llama3',      { optimized: false, thinks: false, vision: false, toolMinB: 8.0 }],
  // OpenAI gpt-oss (local)
  ['gpt-oss',     { optimized: false, thinks: true,  vision: false, toolMinB: 1.0 }],
  // DeepSeek
  ['deepseek-r1', { optimized: false, thinks: true,  vision: false, toolMinB: 7.0 }],
  ['deepseek-v3', { optimized: false, thinks: true,  vision: false, toolMinB: 7.0 }],
  // Phi
  ['phi4-mini',   { optimized: false, thinks: true,  vision: false, toolMinB: 1.0 }],
  ['phi4',        { optimized: false, thinks: false, vision: false, toolMinB: 7.0 }],
  // Mistral / Magistral
  ['magistral',   { optimized: false, thinks: true,  vision: false, toolMinB: 7.0 }],
  ['mistral',     { optimized: false, thinks: false, vision: false, toolMinB: 7.0 }],
  // Dedicated vision-language models on Ollama with no text-only sibling.
  ['llava',       { optimized: false, thinks: false, vision: true,  toolMinB: 7.0 }],
  ['bakllava',    { optimized: false, thinks: false, vision: true,  toolMinB: 7.0 }],
  ['moondream',   { optimized: false, thinks: false, vision: true,  toolMinB: 1.0 }],
  // Cohere
  ['command-r',   { optimized: false, thinks: false, vision: false, toolMinB: 7.0 }],
];

/** Cloud models with vision support — matched by substring of the
 *  wire-prefixed model id. Mirrors soul's `_CLOUD_VISION_PATTERNS`. */
const _CLOUD_VISION_PATTERNS: ReadonlyArray<string> = [
  'openai:gpt-4o',
  'openai:gpt-5',
  'llama-3.2-11b-vision',
  'llama-3.2-90b-vision',
  'meta-llama/llama-4',
  'llama-4-scout',
  'llama-4-maverick',
];

/** Find the matching local family for an Ollama-prefixed model id. */
function _identifyLocalFamily(modelId: string | null | undefined): LocalFamilyInfo | null {
  if (!modelId) return null;
  let tag = modelId.toLowerCase();
  if (tag.startsWith('ollama:')) tag = tag.slice('ollama:'.length);
  if (tag.startsWith('openai:') || tag.startsWith('openai/') || tag.includes('/')) {
    return null;
  }
  const base = tag.split(':')[0];
  for (const [key, info] of _LOCAL_FAMILIES) {
    if (base.includes(key)) return info;
  }
  return null;
}

/** Parse parameter count (B) from the model tag's size suffix.
 *  qwen3:8b → 8, gemma4:e4b → 4, llama3.3:70b-instruct-q4_0 → 70,
 *  bare `mistral` → null (caller may fall back to runtime cap). */
function _parseSizeB(modelId: string | null | undefined): number | null {
  if (!modelId) return null;
  const m = modelId.toLowerCase().match(/:e?(\d+(?:\.\d+)?)b\b/);
  return m ? parseFloat(m[1]) : null;
}

/** Does this model support the agentic tool-calling loop?
 *
 *  Cloud (OpenAI / Groq) — yes; their function-calling is universal.
 *
 *  Ollama — must match a known local family AND meet the family's
 *  size floor (name-parsed). Gemma 4 e2b (2B effective) doesn't pass
 *  the gemma4 floor of 4B even though Ollama's MoE-total /api/show
 *  says 5.1B — name-parsed wins because that's the active-expert
 *  count, which is what predicts tool-call quality.
 *
 *  This is intentionally a small, hand-curated allow-list. Adding a
 *  new Ollama family is a one-line append to `_LOCAL_FAMILIES`. */
export function modelSupportsTools(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  // Cloud — OpenAI prefixed, Groq prefixed (or Groq's bare `<vendor>/<model>` form).
  if (modelId.startsWith('openai:') || modelId.startsWith('openai/')) return true;
  if (modelId.includes('/') && !modelId.startsWith('ollama:')) return true;
  if (!modelId.startsWith('ollama:')) return false;
  const family = _identifyLocalFamily(modelId);
  if (!family) return false;
  const size = _parseSizeB(modelId);
  // No size suffix → trust the family (Ollama runtime will gate again).
  if (size === null) return true;
  return size >= family.toolMinB;
}

/** Does this model support thinking / reasoning? Drives the
 *  thinking-effort dropdown's visibility. Cloud OpenAI reasoning
 *  models (gpt-5.4 / o1 / o3) are handled separately by the
 *  escalation backend, so this returns false for them — the chat
 *  thinking lever only governs the LOCAL chat path. */
export function modelSupportsThinking(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  if (!modelId.startsWith('ollama:')) return false;
  const family = _identifyLocalFamily(modelId);
  return !!family?.thinks;
}

/** Does this model have a per-family validated implementation in soul
 *  (native-token fallback parser if needed, per-family thinking
 *  protocol, size floor tuned)? Drives the "Optimized" badge in the
 *  wizard's model dropdown. */
export function isOptimizedLocalModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  if (!modelId.startsWith('ollama:')) return false;
  const family = _identifyLocalFamily(modelId);
  if (!family?.optimized) return false;
  // Below the family's tool floor it's NOT really optimized for
  // tool-calling use cases — don't mislead the user.
  const size = _parseSizeB(modelId);
  if (size !== null && size < family.toolMinB) return false;
  return true;
}

/** Does this model accept image input?
 *
 *  Cloud: substring match against the curated list of OpenAI and Groq
 *  vision-capable model ids.
 *  Local: per-family `vision` flag from `_LOCAL_FAMILIES`.
 *
 *  Drives the chat UI's image-attach button (hidden when the active
 *  chat model can't see images) and the wizard's image-capable badge.
 *  Soul's `_supports_vision` is the runtime authority — this is just
 *  a UI-side gate. */
export function modelSupportsVision(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const tag = modelId.toLowerCase();
  // Cloud
  for (const pat of _CLOUD_VISION_PATTERNS) {
    if (tag.includes(pat.toLowerCase())) return true;
  }
  // Groq's bare `<vendor>/<model>` form for non-Ollama models
  if (modelId.includes('/') && !modelId.startsWith('ollama:')) {
    // Already handled via the patterns above for Llama 4; nothing else
    // currently. Fall through.
  }
  // Local
  if (!modelId.startsWith('ollama:')) return false;
  const family = _identifyLocalFamily(modelId);
  return !!family?.vision;
}


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
   *  fast-escalation regex no-ops; soul never spins up the agentic
   *  loop. When true, escalation is live; the backend is chosen by
   *  `agentic_provider`. */
  agentic_enabled: boolean;
  /** Which backend runs the agentic loop. `'openai'` (default) uses
   *  OpenAI's Responses API; `'ollama'` uses a local Chat-Completions
   *  loop on the SAME model the user picked for chat — no OpenAI key
   *  needed. The wizard only exposes `'ollama'` when chat is a
   *  tools-capable Ollama model. */
  agentic_provider: AgenticProvider;
  /** When true AND `llm_provider === 'openai'`, escalation reuses
   *  the conversational model + key. Only meaningful on the OpenAI
   *  agentic path; ignored when `agentic_provider === 'ollama'`. */
  agentic_use_same_as_chat: boolean;
  /** OpenAI model id used for the agentic loop (e.g. 'gpt-5.4-mini').
   *  Required when `agentic_provider === 'openai'` AND
   *  `agentic_enabled` is true unless `agentic_use_same_as_chat` is
   *  on AND chat is already OpenAI. Ignored on the local path. */
  agentic_model: string | null;
  /** OpenAI API key for the agentic loop. Required when
   *  `agentic_provider === 'openai'` AND `agentic_enabled` is true
   *  unless `agentic_use_same_as_chat` is on AND chat is OpenAI.
   *  Ignored on the local path (no key needed). */
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
  /** Per-tier thinking effort. Chat default 'none' for snappy
   *  conversational; agentic default 'medium' since escalation is the
   *  reasoning path. Only consulted for models that support thinking
   *  (see `modelSupportsThinking`); hidden in the wizard otherwise. */
  chat_thinking_effort: ThinkingEffort;
  agentic_thinking_effort: ThinkingEffort;
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
  agentic_provider:         'openai',
  agentic_use_same_as_chat: false,
  agentic_model:            null,
  agentic_api_key:          null,
  gemini_search_api_key:    null,
  grounding_search_enabled: false,
  chat_thinking_effort:     'none',
  agentic_thinking_effort:  'medium',
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
  // Agentic gates: only enforced when the user opted in. On the local
  // path (`agentic_provider === 'ollama'`) the chat-tier Ollama model
  // doubles as the agentic model, so no extra model / key is required
  // — only that chat itself is on a tools-capable Ollama model.
  if (profile.agentic_enabled) {
    if (profile.agentic_provider === 'ollama') {
      if (profile.llm_provider !== 'ollama' || !modelSupportsTools(profile.llm_model)) {
        missing.push('Tools-capable Ollama chat model');
      }
    } else {
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
      // Agentic probe. Soul picks the right backend from
      // `agentic_provider`: 'openai' probes the OpenAI key (cheap GET
      // /v1/models); 'ollama' is a no-op (chat-side Ollama probe
      // already covered reachability).
      // When `agentic_use_same_as_chat` is on AND chat is OpenAI,
      // the chat key is reused as the agentic key.
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
