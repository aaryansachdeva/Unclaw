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
  | 'groq'        // Groq Cloud — qwen3-32b, gpt-oss-20b, llama-3.3-70b
  | 'openai'      // OpenAI Cloud — gpt-4o-mini default, gpt-5.4 family
  | 'ollama'      // Local Ollama daemon — any locally-pulled model
  | 'deepseek'    // DeepSeek API (OpenAI-compatible) — deepseek-chat, -reasoner
  | 'xai'         // xAI Grok (OpenAI-compatible) — grok-2-latest, grok-beta
  | 'anthropic'   // Anthropic Claude (OpenAI-compat shim) — claude-3.x family
  | 'gemini'      // Google Gemini (OpenAI-compat shim) — gemini-2.x family
  | 'claude-code' // Anthropic Claude via Pro/Max subscription (CLI OAuth, keyless)
  | 'gemini-cli'  // Google Gemini free tier / Pro via `gemini` CLI (OAuth, keyless)
  | 'codex';      // OpenAI Codex CLI via ChatGPT Plus / Pro subscription (OAuth, keyless)

/** Which backend runs the agentic / escalation loop. Aliased to LLMProviderId
 *  so any provider the user has a working chat key for can also drive
 *  escalation. The actual tool-loop dispatch in soul currently supports
 *  `openai` (Responses API) and `ollama` (native tool calls) fully; other
 *  providers validate the key but escalation falls back to the chat path
 *  without tools. UI surfaces all options; pick what your provider supports. */
export type AgenticProvider = LLMProviderId;

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

/** Per-family configuration mirror of soul's `_FAMILY_INFO`. UI-only —
 *  soul is the runtime source of truth. Lookup is longest-substring
 *  first so `qwen3.6` matches before `qwen3`, `llama3.3` before
 *  `llama3`, etc. Unset flags default to `false` via `??`. */
type LocalFamilyInfo = {
  /** "Optimized" badge — family validated end-to-end (tool calling +
   *  thinking + size floor) on the 2026-05-13 sweep. */
  optimized?: boolean;
  /** Family supports `<think>` / chain-of-thought. Gates the wizard's
   *  thinking-effort dropdown. */
  thinks?: boolean;
  /** Family accepts image input. Gates the wizard's "Vision" chip and
   *  the chat input bar's image-attach button. */
  vision?: boolean;
  /** Name-parsed minimum-size floor (B) for reliable tool calls.
   *  Sub-floor variants drop out of the local-agentic picker. */
  toolMinB: number;
};

const _LOCAL_FAMILIES: ReadonlyArray<readonly [string, LocalFamilyInfo]> = [
  // Qwen — `-vl` variants matched first so vision flag wins.
  ['qwen3-vl',    { optimized: true, thinks: true, vision: true, toolMinB: 1.0 }],
  ['qwen2.5-vl',  {                                vision: true, toolMinB: 3.0 }],
  ['qwen3.6',     { optimized: true, thinks: true,               toolMinB: 1.0 }],
  // qwen3.5: floor 2.0 + vision verified by 2026-05-13 sweep.
  ['qwen3.5',     { optimized: true, thinks: true, vision: true, toolMinB: 2.0 }],
  ['qwen3-coder', { optimized: true, thinks: true,               toolMinB: 8.0 }],
  ['qwen3',       { optimized: true, thinks: true,               toolMinB: 4.0 }],
  ['qwen2.5',     {                                              toolMinB: 7.0 }],
  // Gemma — entire Gemma 4 line multimodal; Gemma 3 multimodal at 4B+.
  ['gemma4',      { optimized: true, thinks: true, vision: true, toolMinB: 4.0 }],
  ['gemma3',      { optimized: true,               vision: true, toolMinB: 4.0 }],
  // Llama — vision variants + `llama3-groq` before generic `llama3`.
  ['llama3.2-vision', { optimized: true,           vision: true, toolMinB: 11.0 }],
  ['llama4',      { optimized: true,               vision: true, toolMinB: 16.0 }],
  ['llama3.3',    { optimized: true,                             toolMinB: 70.0 }],
  ['llama3.2',    {                                              toolMinB: 3.0 }],
  ['llama3.1',    { optimized: true,                             toolMinB: 70.0 }],
  ['llama3-groq', { optimized: true,                             toolMinB: 8.0 }],
  ['llama3',      {                                              toolMinB: 8.0 }],
  // gpt-oss (local) / DeepSeek / Phi / Mistral / Magistral / Cohere.
  ['gpt-oss',     {                  thinks: true,               toolMinB: 1.0 }],
  ['deepseek-r1', {                  thinks: true,               toolMinB: 7.0 }],
  ['deepseek-v3', {                  thinks: true,               toolMinB: 7.0 }],
  ['phi4-mini',   {                  thinks: true,               toolMinB: 1.0 }],
  ['phi4',        {                                              toolMinB: 7.0 }],
  ['magistral',   {                  thinks: true,               toolMinB: 7.0 }],
  ['mistral',     {                                              toolMinB: 7.0 }],
  ['command-r',   {                                              toolMinB: 7.0 }],
  // Vision-language families with no text-only sibling tag.
  ['llava',       {                                vision: true, toolMinB: 7.0 }],
  ['bakllava',    {                                vision: true, toolMinB: 7.0 }],
  ['moondream',   {                                vision: true, toolMinB: 1.0 }],
];

/** Cloud models with vision support — substring match of the
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

/** Resolve the local family for an Ollama-prefixed model id. Returns
 *  null for cloud / unknown / non-Ollama ids. */
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

/** Parameter count parsed from the tag's size suffix. `qwen3:8b` → 8,
 *  `gemma4:e4b` → 4, `llama3.3:70b-instruct-q4_0` → 70. Null when no
 *  parseable suffix — caller may fall back to runtime caps. */
function _parseSizeB(modelId: string | null | undefined): number | null {
  if (!modelId) return null;
  const m = modelId.toLowerCase().match(/:e?(\d+(?:\.\d+)?)b\b/);
  return m ? parseFloat(m[1]) : null;
}

/** Does this model support the agentic tool-calling loop?
 *  Cloud (OpenAI / Groq) is permissive — any wire-prefixed id passes.
 *  Ollama requires a known family AND size ≥ family floor. */
export function modelSupportsTools(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  if (modelId.startsWith('openai:') || modelId.startsWith('openai/')) return true;
  if (modelId.includes('/') && !modelId.startsWith('ollama:')) return true;
  if (!modelId.startsWith('ollama:')) return false;
  const family = _identifyLocalFamily(modelId);
  if (!family) return false;
  const size = _parseSizeB(modelId);
  return size === null ? true : size >= family.toolMinB;
}

/** Family supports a `<think>` block. Drives the wizard's
 *  thinking-effort dropdown. Local Ollama only — cloud reasoning is
 *  handled separately by the escalation backend. */
export function modelSupportsThinking(modelId: string | null | undefined): boolean {
  if (!modelId || !modelId.startsWith('ollama:')) return false;
  return !!_identifyLocalFamily(modelId)?.thinks;
}

/** Family has a soul-side validated implementation. Drives the
 *  "Optimized" chip. Sub-floor variants don't qualify. */
export function isOptimizedLocalModel(modelId: string | null | undefined): boolean {
  if (!modelId || !modelId.startsWith('ollama:')) return false;
  const family = _identifyLocalFamily(modelId);
  if (!family?.optimized) return false;
  const size = _parseSizeB(modelId);
  return size === null || size >= family.toolMinB;
}

/** Does this model accept image input? Cloud via
 *  `_CLOUD_VISION_PATTERNS`; local via the family `vision` flag.
 *  Gates the chat input bar's image-attach button and the wizard's
 *  "Vision" chip. Soul's `_supports_vision` is the runtime authority. */
export function modelSupportsVision(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const tag = modelId.toLowerCase();
  if (_CLOUD_VISION_PATTERNS.some((pat) => tag.includes(pat.toLowerCase()))) return true;
  if (!modelId.startsWith('ollama:')) return false;
  return !!_identifyLocalFamily(modelId)?.vision;
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


/** Provider catalog. Cloud providers list NO baked models — the dropdown
 *  populates from the live `/v1/models` response returned by soul's
 *  `/validate_keys` once the user enters a working key. This eliminates the
 *  stale-models problem and the dual-source maintenance burden.
 *
 *  Ollama is the one exception: its list comes from soul's
 *  `GET /providers` (live `/api/tags` scan against the local daemon).
 *
 *  Adding a new provider here also requires a matching `_select_provider`
 *  branch in soul/server.py. */
export const LLM_PROVIDERS: ProviderInfo[] = [
  {
    id: 'groq',
    label: 'Groq',
    signupUrl: 'https://console.groq.com/keys',
    requiresApiKey: true,
    models: [],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    signupUrl: 'https://platform.openai.com/api-keys',
    requiresApiKey: true,
    models: [],
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
  // OpenAI-compatible providers — all share soul's `_openai_compatible_chat`.
  {
    id: 'deepseek',
    label: 'DeepSeek',
    signupUrl: 'https://platform.deepseek.com/api_keys',
    requiresApiKey: true,
    models: [],
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    signupUrl: 'https://console.x.ai/',
    requiresApiKey: true,
    models: [],
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    requiresApiKey: true,
    models: [],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    signupUrl: 'https://aistudio.google.com/apikey',
    requiresApiKey: true,
    models: [],
  },
  // Claude Code subscription auth — keyless. User authenticates once via
  // `claude setup-token` in their terminal; soul probes the local CLI for
  // install + OAuth state via /validate_keys (no key in the request body).
  // Billing routes through the user's Agent SDK credit pool, not the API.
  {
    id: 'claude-code',
    label: 'Claude Code CLI',
    signupUrl: 'https://www.anthropic.com/pricing',
    requiresApiKey: false,
    models: [],
  },
  // Gemini CLI — keyless. User runs `gemini` once and signs in with a
  // Google account. Free tier (60 req/min, 1000/day) on personal
  // accounts, or Pro/Ultra subscription quota. Built-in google_web_search
  // is on by default — no Gemini API key needed for grounded answers.
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    signupUrl: 'https://geminicli.com/',
    requiresApiKey: false,
    models: [],
  },
  // OpenAI Codex CLI — keyless. User runs `codex login` once and signs
  // in with their ChatGPT account. GPT-5.x family routed through their
  // ChatGPT Plus / Pro subscription credit.
  {
    id: 'codex',
    label: 'Codex CLI (ChatGPT subscription)',
    signupUrl: 'https://openai.com/chatgpt/pricing/',
    requiresApiKey: false,
    models: [],
  },
];


/** Defense-in-depth chat-model filter. Soul's per-provider validators
 *  already filter using each provider's native capability metadata
 *  where available:
 *    * Gemini  → `supportedGenerationMethods.includes('generateContent')`
 *    * Anthropic → `type === 'model'` (all are chat by API contract)
 *  For OpenAI and Groq, the /v1/models endpoint has no machine-readable
 *  type field, so we rely on name-pattern allowlists.
 *
 *  This function runs AFTER the server-side filter. For providers with
 *  rich capability metadata it's a near-no-op; for OpenAI/Groq it's the
 *  primary filter. Returns IDs in input order.
 */
export function filterChatModels(
  provider: LLMProviderId,
  rawIds: readonly string[],
): string[] {
  const isChat = (id: string): boolean => {
    const lower = id.toLowerCase();
    switch (provider) {
      case 'openai': {
        // OpenAI publishes no type/modality field on /v1/models. We
        // maintain an explicit non-chat denylist of every published
        // non-conversational family + a positive allowlist for known
        // chat prefixes. Drop a release? Append to one of the two.
        const nonChat = [
          'embedding',         // text-embedding-3-*, text-embedding-ada-*
          'whisper',           // whisper-1, whisper-large-*
          'tts-',              // tts-1, tts-1-hd
          'dall-e',            // dall-e-2, dall-e-3
          'gpt-image',         // gpt-image-1
          'image-',            // future image variants
          'omni-moderation',   // omni-moderation-latest
          'moderation',        // text-moderation-stable / -latest
          'davinci', 'babbage', 'ada', 'curie',  // GPT-3 base series
          'computer-use',      // gpt-4o-mini-tts and other -use suffixed
          'realtime',          // gpt-4o-realtime-preview, audio
          'audio-preview',     // gpt-4o-audio-preview
          'transcribe',        // gpt-4o-mini-transcribe
          'search-preview',    // gpt-4o-search-preview (web-search-only variant)
          'codex',             // codex-*, legacy code completion
        ];
        if (nonChat.some((r) => lower.includes(r))) return false;
        // Positive allowlist of chat-capable prefixes.
        return lower.startsWith('gpt-')         // gpt-3.5/4/4o/4.1/5/5.4/...
          || /^o\d/.test(lower)                  // o1, o3, o4-mini
          || lower.startsWith('chatgpt-');       // chatgpt-4o-latest
      }

      case 'anthropic':
        // Anthropic's /v1/models lists only chat-capable Claude models
        // (the API contract excludes non-Messages models). Belt-and-
        // suspenders: require the `claude-` prefix.
        return lower.startsWith('claude-');

      case 'claude-code':
        // Subscription auth — soul returns the alias catalog
        // (sonnet / opus / haiku) which the CLI resolves to the latest
        // model in each family on the user's plan tier. All chat.
        return true;

      case 'gemini-cli':
      case 'codex':
        // Both return curated chat-capable model lists from soul's
        // keyless detector. No name filter needed.
        return true;

      case 'gemini': {
        // Server-side filter (supportedGenerationMethods) already
        // restricts to chat. This is belt-and-suspenders for the
        // edge case where soul returns an unfiltered legacy response.
        if (lower.includes('embedding') || lower.includes('aqa')) return false;
        if (lower.includes('imagen') || lower.includes('image-generation')) return false;
        if (lower.includes('text-bison') || lower.includes('chat-bison')) return false; // PaLM legacy
        if (lower.includes('tts')) return false;
        return lower.startsWith('gemini-') || lower.startsWith('learnlm-');
      }

      case 'groq': {
        // Groq hosts a curated mix of OSS models. /v1/models has no
        // type field, so we filter by family name + reject non-chat.
        const nonChat = [
          'whisper',           // whisper-large-v3, whisper-large-v3-turbo
          'distil-whisper',    // distil-whisper-large-v3-en
          'tts',               // playai-tts, playai-tts-arabic
          'guard',             // llama-guard-3-8b (safety classifier)
          'embedding',         // future embeddings if Groq adds them
        ];
        if (nonChat.some((r) => lower.includes(r))) return false;
        // Anything else hosted on Groq is text-chat (Qwen, Llama,
        // Mixtral, Gemma, DeepSeek, GPT-OSS, Kimi, etc.).
        return true;
      }

      case 'deepseek':
        // DeepSeek's /v1/models lists `deepseek-chat` and
        // `deepseek-reasoner`. Both chat. Future additions following
        // the same `deepseek-` prefix pass through.
        return lower.startsWith('deepseek-');

      case 'xai':
        // xAI's lineup is the Grok family. /v1/models lists
        // `grok-2-latest`, `grok-2-1212`, `grok-vision-beta`, etc.
        return lower.startsWith('grok-');

      case 'ollama':
        // Local Ollama tags vary wildly. Anything the user pulled
        // is fair game.
        return true;
    }
  };
  return rawIds.filter(isChat);
}

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
 *  - supertonic: local ONNX TTS (~400 MB model + lazy-fetched custom
 *                voice JSONs from R2). Streaming + Grace clone shipped.
 *  - qwen3: DISABLED for now while its runtime API stabilizes. The
 *           value is kept in the union so legacy serialized profiles
 *           still typecheck; the wizard no longer offers it as an
 *           option and soul rejects it on /chat. */
export type TtsProviderId =
  | 'elevenlabs'
  | 'kokoro'
  | 'supertonic'
  | 'qwen3';

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
  /** Selected Supertonic voice id. Built-in voices are `M1`-`M5` /
   *  `F1`-`F5`; custom voices are filename stems matching a JSON in
   *  `<soul_data>/supertonic/voices/<name>.json` (typically exported
   *  from Supertonic's Voice Builder web tool, e.g. `grace`). Only
   *  consulted when `tts_provider === 'supertonic'`. Defaults to `F1`. */
  supertonic_voice: string | null;
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
  /** UE graphics quality preset. Surfaces in Settings as Low/Med/High
   *  dropdown. Soul reads this and patches `sg.ResolutionQuality` in
   *  GameUserSettings.ini + merges extra CVars into ExecCmds when next
   *  launching UE. Change requires character restart (the UI shows a
   *  "Restart character" toast).
   *
   *  Resolution dimension is INDEPENDENT — the UE backbuffer dynamically
   *  matches the streamed <video> element's pixel size (browser sends
   *  Resolution.Width/Height on resize via ResizeObserver in
   *  usePixelStreaming.ts). The tier only controls the internal render
   *  percentage applied to that dynamic backbuffer.
   *
   *  - low (default): sg.ResolutionQuality=50 — half the backbuffer
   *    internal render then upscale. Cheap. Fits M1+ on battery.
   *  - medium: 75 + r.SSS.Quality 2 + bumped WebRTC bitrate band.
   *  - high:   100 + r.SSS.Quality 3 + r.Shadow.MaxResolution 2048 +
   *    further-bumped bitrate.
   *
   *  See soul/unreal_runtime.py:_GRAPHICS_PRESETS for the table. */
  graphics_quality: GraphicsQuality;
}

/** UE-side graphics preset. See ApiKeysProfile.graphics_quality. */
export type GraphicsQuality = 'low' | 'medium' | 'high';


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
  // Kokoro on Win/Linux; on Mac the MLX-Kokoro runtime can't load
  // the .pt tensor, so `grace_kokoro` silently falls back to a
  // bundled voice (`af_nicole`). Mac users who want the real Grace
  // clone should pick the Supertonic-3 provider instead — which
  // auto-fetches `grace_supertonic.json` and renders the actual
  // cloned voice on-device.
  kokoro_voice:             'grace_kokoro',
  qwen3_voice:              'grace_qwen3',
  // Supertonic-3 voice. Built-in `F1`-`F5` / `M1`-`M5`, or a custom
  // KVoiceWalk-style JSON keyed by filename stem. Default `grace`: the
  // Supertonic-trained Grace clone hosted at
  // files.fotonlabs.com/mac/voices/grace_supertonic.json. On first
  // synth, supertonic_runtime auto-fetches the ~290 KB JSON into
  // `<soul_data>/supertonic/voices/grace.json` (cached + version-pinned
  // alongside Kokoro's grace_kokoro.pt). Picking a different built-in
  // (F2, M3, etc.) bypasses the CDN entirely.
  supertonic_voice:         'grace',
  agentic_enabled:          false,
  agentic_provider:         'openai',
  agentic_use_same_as_chat: false,
  agentic_model:            null,
  agentic_api_key:          null,
  gemini_search_api_key:    null,
  grounding_search_enabled: false,
  chat_thinking_effort:     'none',
  agentic_thinking_effort:  'medium',
  graphics_quality:         'low',
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
  } else if (profile.tts_provider === 'supertonic') {
    // Supertonic auto-downloads its ~400 MB model + lazy-fetches the
    // selected custom voice JSON (e.g. `grace`) from R2 on first
    // synth. No key, no install panel, no field-level requirement.
  } else if (profile.tts_provider === 'qwen3') {
    // DISABLED: the wizard no longer offers Qwen3, but a legacy
    // serialized profile may still carry it. Treat as no required
    // field; /validate_keys will fail the run and surface the
    // disabled-provider error from soul.
  } else {
    if (!profile.elevenlabs_api_key) missing.push('ElevenLabs API key');
  }
  // Agentic gates: only enforced when the user opted in. Three paths:
  //   * Ollama local: chat-tier Ollama model doubles as the agentic
  //     model. Only requires that chat itself is on a tools-capable
  //     Ollama model.
  //   * Keyless CLI (claude-code / gemini-cli / codex): no API key,
  //     no required model (the CLI uses sensible defaults if blank,
  //     and the agentic_model dropdown populates live from the
  //     CLI's catalog post-auto-probe). The user just needs to be
  //     signed in to the local CLI, which the CliProviderStatusCard
  //     surfaces, but the wizard doesn't gate Finish on it.
  //   * Cloud API (openai / anthropic / gemini / deepseek): needs both
  //     a model id and the matching API key (or "use same as chat"
  //     when chat is OpenAI).
  if (profile.agentic_enabled) {
    const ap = profile.agentic_provider;
    const isKeylessCli = ap === 'claude-code' || ap === 'gemini-cli' || ap === 'codex';
    if (ap === 'ollama') {
      if (profile.llm_provider !== 'ollama' || !modelSupportsTools(profile.llm_model)) {
        missing.push('Tools-capable Ollama chat model');
      }
    } else if (isKeylessCli) {
      // Nothing to enforce at the field-validation layer. Sign-in
      // status surfaces via the CliProviderStatusCard, the wizard
      // lets the user finish either way (they can wake the sign-in
      // flow later from Settings if needed).
    } else {
      const reuseChat = profile.agentic_use_same_as_chat
        && profile.llm_provider === 'openai'
        && !!profile.llm_api_key;
      if (!profile.agentic_model && !reuseChat) {
        missing.push('Agentic model');
      }
      if (!reuseChat && !profile.agentic_api_key) {
        // Label reflects the picked backend so the "Required to
        // finish" panel doesn't say "OpenAI key" when the user
        // selected Anthropic / Gemini / DeepSeek.
        const providerLabel =
          ap === 'anthropic' ? 'Anthropic'
          : ap === 'gemini' ? 'Gemini'
          : ap === 'deepseek' ? 'DeepSeek'
          : 'OpenAI';
        missing.push(`${providerLabel} key for agentic`);
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

import { getSoulBaseUrl } from './soulBase';

export interface KeyValidationOutcome {
  ok: boolean;
  /** Human-readable error when ok=false. Safe to show inline. */
  error?: string;
  /** Live model list returned by the provider's /v1/models endpoint when
   *  the key validates. Populates the model dropdown without the user
   *  having to wait for a separate fetch. Empty / undefined on parse
   *  failure or for providers that don't expose a model list (Ollama,
   *  TTS). Frontend falls back to the baked LLM_PROVIDERS catalog when
   *  this is empty. */
  models?: string[];
  /** Claude Code subscription-auth specifics. `needs_setup_token` flags
   *  the "binary installed but not signed in" state so the settings card
   *  can show the `claude setup-token` instruction. `binary_path` +
   *  `version` are surfaced for the green-check ready state. */
  needs_setup_token?: boolean;
  binary_path?: string;
  version?: string;
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
  const res = await fetch(`${getSoulBaseUrl()}/validate_keys`, {
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
