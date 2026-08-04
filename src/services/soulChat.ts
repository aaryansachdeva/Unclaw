// Single-call client for the soul.exe server's /chat endpoint.
// Soul runs the entire pipeline (LLM → ElevenLabs TTS → lipsync → T2F)
// and broadcasts the result to all /ws subscribers (Unreal pulls
// /result/{id} automatically). Replaces the older Cerebras-LLM +
// ElevenLabs-from-browser + /upload-lipsync chain in services/ai.ts +
// services/tts.ts + services/lipsync.ts for the default chat path.
//
// BYOK plumbing: the Electron app reads the user's saved api key from
// safeStorage (via fetchApiKeys) and passes it along on each request.
// Soul accepts `llm_api_key` per-call, so cloud providers can run
// against the user's own key without touching server-side env vars.

import { fetchApiKeys, type ApiKeysProfile } from './apiKeys';

/** Resolve the voice_id to send for the active TTS provider. By default each
 *  agent uses its own per-character voice (`voices[provider]`); the global
 *  per-provider voice only applies when its "override voice" toggle is on, in
 *  which case it wins across all agents. Returns null when nothing applies
 *  (soul falls back to its env default). Shared by both the streaming and
 *  non-streaming paths so the precedence lives in exactly one place. */
function resolveVoiceId(
  keys: ApiKeysProfile,
  voices: { elevenlabs?: string; supertonic?: string; kokoro?: string; qwen3?: string } | undefined,
): string | null {
  const p = keys.tts_provider;
  const perChar = voices?.[p as keyof NonNullable<typeof voices>] ?? null;
  const globalVoice =
    p === 'elevenlabs' ? keys.elevenlabs_voice
    : p === 'kokoro' ? keys.kokoro_voice
    : p === 'supertonic' ? keys.supertonic_voice
    : null;
  const overrideOn =
    p === 'elevenlabs' ? keys.elevenlabs_voice_override
    : p === 'kokoro' ? keys.kokoro_voice_override
    : p === 'supertonic' ? keys.supertonic_voice_override
    : false;
  return overrideOn ? (globalVoice || perChar) : perChar;
}

import { getSoulBaseUrl } from './soulBase';

export interface SoulChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SoulChatOptions {
  history?: SoulChatHistoryTurn[];
  voiceId?: string;
  /** Per-character voice ids keyed by TTS provider. The active provider (from
   *  the user's saved settings) picks one; it wins over the global per-provider
   *  voice setting, so each agent speaks in its own voice. Falls back to the
   *  global setting when a character has no voice for the active provider. */
  voices?: { elevenlabs?: string; supertonic?: string; kokoro?: string; qwen3?: string };
  lipsyncModel?: 'v6' | 'v6mini' | 'v4';
  /** Persona text + any user-profile facts to PREPEND to soul's
   *  built-in SYSTEM_PROMPT. Replaces the LLM's default voice with
   *  Grace/Mark/etc. without touching the server's structured-output
   *  formatting rules. */
  systemExtension?: string;
  /** One or more screenshots attached to this turn. Each entry is a
   *  base64-encoded PNG with NO data-URL prefix. Soul auto-routes
   *  any image-bearing request to the vision-capable escalation
   *  model (gpt-5.4-nano); the 20b is text-only and gets skipped.
   *  An empty/omitted array sends no images. */
  images?: string[];
}

/** Function-call result emitted when the LLM picks one of soul's tools.
 *  See `_GROQ_TOOLS` in soul_exe_server.py for the canonical list. */
export interface SoulChatAction {
  /** Tool name. Action tools: 'give_a_kiss' | 'do_dance' | 'say_hello' |
   *  'react_as_star_wars_fan'. Reminder tools: 'create_event_reminder' |
   *  'update_reminder' | 'delete_reminder' | 'mark_reminder_complete'. */
  name: string;
  /** Decoded JSON arguments. Always includes a `response` string used as
   *  the spoken reply; reminder tools include id / fields too. */
  args: Record<string, unknown>;
  /** Present on `create_event_reminder`: the freshly inserted record. */
  reminder?: { id: string; title: string; when_iso: string; notes: string };
  /** Present on update / delete / complete tools. */
  reminder_id?: string;
}

export interface SoulChatResult {
  /** Job id soul.exe stored under. UE auto-pulls /result/{id} via /ws broadcast. */
  id: string;
  /** Mood line the LLM produced (drives Text2Face). */
  mood: string;
  /** The plain-text reply the LLM spoke aloud. */
  response: string;
  /** Behavior preset (e.g. "calm", "excited"). */
  behavior?: string;
  /** Timing breakdown (handy for status displays). */
  llm_ms?: number;
  tts_ms?: number;
  lipsync_ms?: number;
  t2f_ms?: number;
  generation_ms?: number;
  /** Total face frames generated. */
  n_frames?: number;
  duration?: number;
  /** Set when the LLM invoked one of the registered function-calling tools.
   *  The client uses this to emit a UE animation event (kiss/dance/hello)
   *  or to refresh the reminders panel after a CRUD tool. */
  action?: SoulChatAction;
  /** Set when 20b chose to escalate to gpt-5-mini + Playwright MCP. The
   *  current /chat result is the transition reply (already voiced); the
   *  client should poll /escalation/{id}/next for follow-up narrations
   *  and the final response. See services/escalation.ts. */
  escalation?: { id: string; reason: string };
  /** Body-animation directives from soul's body director (captured
   *  mode): conviction-gated talk loops, idle rotation, and explicit
   *  LLM body tokens. The client forwards each to UE's text2body
   *  AnimBP via emitUIInteraction. */
  body?: SoulBodyDirective[];
  /** Server fields we don't strongly type. */
  [key: string]: unknown;
}

/**
 * POST the user's message to soul.exe /chat. Returns the full result
 * (id, mood, response, timings, etc.) once the server pipeline finishes.
 *
 * BYOK behavior: reads the persisted ApiKeysProfile via safeStorage and,
 * when the user has chosen a cloud provider with a key set, passes
 * `{llm_model, llm_api_key}` along so soul dispatches to the user's
 * provider/model with their key. When no BYOK config is set (or the
 * user picked Ollama, which doesn't need a key), soul falls back to
 * its env-var configuration just like it always has.
 */
export async function chatViaSoul(
  message: string,
  opts: SoulChatOptions = {},
): Promise<SoulChatResult> {
  const body: Record<string, unknown> = { message };
  if (opts.history) body.history = opts.history;
  if (opts.voiceId) body.voice_id = opts.voiceId;
  if (opts.lipsyncModel) body.lipsync_model = opts.lipsyncModel;
  if (opts.systemExtension) body.system_extension = opts.systemExtension;
  if (opts.images && opts.images.length > 0) body.images = opts.images;

  // Pull the user's saved {provider, model, key, tts_provider...} so
  // soul routes the request to the backends they configured in
  // onboarding. Soul's /chat route is BYOK-strict in shipping mode
  // (no env-key fallback), so the values gathered here are required
  // end-to-end — the wizard gates Finish on them.
  try {
    const keys = await fetchApiKeys();
    if (keys.llm_model) body.llm_model = keys.llm_model;
    // Only send the LLM key for providers that actually need one
    // (cloud); Ollama bypasses this and soul uses its local daemon.
    if (keys.llm_api_key && keys.llm_provider !== 'ollama') {
      body.llm_api_key = keys.llm_api_key;
    }
    // TTS routing. Default is ElevenLabs (cloud BYOK); when the user
    // picked Kokoro we send the provider tag + (optionally) the
    // custom endpoint URL so soul forwards instead of running locally.
    body.tts_provider = keys.tts_provider;
    if (keys.tts_provider === 'elevenlabs' && keys.elevenlabs_api_key) {
      body.elevenlabs_api_key = keys.elevenlabs_api_key;
    }
    if (keys.tts_provider === 'kokoro' && keys.kokoro_mode === 'custom' && keys.kokoro_endpoint) {
      body.kokoro_endpoint = keys.kokoro_endpoint;
    }
    // Voice: explicit opts.voiceId wins; otherwise per-character voice (or the
    // global override voice when that provider's toggle is on). See
    // resolveVoiceId. Without any, soul falls back to its env default.
    if (!opts.voiceId) {
      const voice = resolveVoiceId(keys, opts.voices);
      if (voice) body.voice_id = voice;
    }
    // Agentic / escalation BYOK. Soul reads these on /chat and routes
    // to either _run_escalation (cloud) or _run_escalation_local based
    // on agentic_provider. The local path uses the chat-tier Ollama
    // model for both chat AND agentic, so agentic_model / agentic_api_key
    // are unused there — we omit them to keep wire payloads small.
    body.agentic_enabled = keys.agentic_enabled;
    body.agentic_provider = keys.agentic_provider;
    if (keys.agentic_enabled && keys.agentic_provider !== 'ollama') {
      const reuseChat = keys.agentic_use_same_as_chat
        && keys.llm_provider === 'openai'
        && !!keys.llm_api_key;
      body.agentic_model = reuseChat ? keys.llm_model : keys.agentic_model;
      body.agentic_api_key = reuseChat ? keys.llm_api_key : keys.agentic_api_key;
    }
    // Per-tier thinking effort. Soul translates per-family — gpt-oss
    // takes level strings natively, Qwen 3.x takes bool, Gemma 4 takes
    // a system-prompt token, Llama families omit. Sending both fields
    // is always safe; soul ignores them for families that don't think.
    body.chat_thinking_effort = keys.chat_thinking_effort;
    body.agentic_thinking_effort = keys.agentic_thinking_effort;
    // Gemini grounded-search BYOK. Only forwarded when the user opted
    // in via the wizard. Without this, the escalation web_search tool
    // would silently bill the dev's quota (or fail outright on a
    // shipped build with no env key).
    if (keys.grounding_search_enabled && keys.gemini_search_api_key) {
      body.gemini_search_api_key = keys.gemini_search_api_key;
    }
  } catch (err) {
    console.warn('[soulChat] failed to read api keys', err);
  }

  const res = await fetch(`${getSoulBaseUrl()}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Generous ceiling: /chat runs the full LLM + TTS + lipsync pipeline. This
    // only guards against a wedged soul never settling (which would freeze the
    // send button forever), not normal slow turns.
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`soul /chat ${res.status}: ${errText.slice(0, 200)}`);
  }
  return (await res.json()) as SoulChatResult;
}


// ---------------------------------------------------------------------
// Passthrough speak
// ---------------------------------------------------------------------
//
// In passthrough mode UnClaw does no inference of its own; a user's
// external coding agent (Claude Code, Codex, ...) sends text to voice via
// soul's /passthrough/speak, which soul pushes to us over
// /passthrough/ws. We then render it here: soul's /speak endpoint runs
// the SAME TTS + lipsync + expression pipeline as /chat but with NO LLM
// (the text is spoken verbatim). We supply our onboarding voice / TTS
// provider / BYOK keys exactly like chatViaSoul, so soul never needs a
// stored default. The returned job is dispatched to UE by the caller
// (emitUIInteraction), identical to a normal chat turn.

/** Render `text` verbatim through soul's /speak (no LLM). mood/behavior
 *  are optional expression hints; actionName optionally fires a gesture
 *  (e.g. 'give_a_kiss', 'do_dance', 'celebrate'). Resolves the user's
 *  saved voice + TTS provider + BYOK key the same way chatViaSoul does. */
export async function speakViaSoul(
  text: string,
  opts: {
    mood?: string;
    behavior?: string;
    actionName?: string;
    voiceId?: string;
    voices?: SoulChatOptions['voices'];
    lipsyncModel?: SoulChatOptions['lipsyncModel'];
  } = {},
): Promise<SoulChatResult> {
  const body: Record<string, unknown> = { message: text };
  if (opts.mood) body.mood = opts.mood;
  if (opts.behavior) body.behavior = opts.behavior;
  if (opts.actionName) body.action_name = opts.actionName;
  if (opts.voiceId) body.voice_id = opts.voiceId;
  if (opts.lipsyncModel) body.lipsync_model = opts.lipsyncModel;

  // Voice + TTS provider + BYOK, same resolution as chatViaSoul. No LLM
  // fields — /speak skips inference entirely.
  try {
    const keys = await fetchApiKeys();
    body.tts_provider = keys.tts_provider;
    if (keys.tts_provider === 'elevenlabs' && keys.elevenlabs_api_key) {
      body.elevenlabs_api_key = keys.elevenlabs_api_key;
    }
    if (keys.tts_provider === 'kokoro' && keys.kokoro_mode === 'custom' && keys.kokoro_endpoint) {
      body.kokoro_endpoint = keys.kokoro_endpoint;
    }
    if (!opts.voiceId) {
      const voice = resolveVoiceId(keys, opts.voices);
      if (voice) body.voice_id = voice;
    }
  } catch (err) {
    console.warn('[speak] failed to read api keys', err);
  }

  const res = await fetch(`${getSoulBaseUrl()}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`soul /speak ${res.status}: ${errText.slice(0, 200)}`);
  }
  return (await res.json()) as SoulChatResult;
}


// ---------------------------------------------------------------------
// Idle driver
// ---------------------------------------------------------------------
//
// Soul's `/idle` endpoint runs a tiny LLM call (mood/behavior token) +
// Text2Face only — no TTS, no LipSync. UnClaw periodically pings it to
// produce ambient micro-expressions while the user isn't talking.
//
// BYOK: idle uses the SAME llm_model + llm_api_key the user picked for
// chat. There's no separate idle config. Soul refuses /idle without an
// explicit llm_model in the body — onboarding owns the choice, no
// server-side default. We pull from `apiKeys` per call so a wizard
// edit propagates without an app restart.

/** One body-animation directive for the UE text2body AnimBP. `event`
 *  is the UIInteraction EventType; exactly one of the *Num fields is
 *  set (plus talkTime for doTalking). `clip` is informational.
 *  Short idle VISITS additionally carry revertAfterS/revertIdleNum:
 *  the renderer schedules a doIdle back to the home loop after that
 *  many seconds (idle is the one state UE never exits on its own). */
export interface SoulBodyDirective {
  event: 'doIdle' | 'doTalking' | 'doAction' | 'doGesture';
  idleNum?: number;
  talkNum?: number;
  talkTime?: number;
  actionNum?: number;
  gestureNum?: number;
  clip?: string;
  revertAfterS?: number;
  revertIdleNum?: number;
  revertClip?: string;
}

export interface SoulIdleResult {
  type: 'idle' | 'idle_skipped';
  body?: SoulBodyDirective[];
  id?: string;
  mood?: string;
  behavior?: string;
  flavor?: string;
  duration?: number;
  fps?: number;
  n_frames?: number;
  generation_ms?: number;
  reason?: string;
  [k: string]: unknown;
}

/** POST /idle with the user's llm_model + key. Soft-fails (returns
 *  null) on any transport / 4xx error so the caller's polling loop
 *  doesn't break — idle is fire-and-forget. */
export async function fireIdle(opts: {
  duration_s?: number;
  t2f_guidance?: number;
  t2f_smooth?: number;
  fade_in_ms?: number;
  fade_out_ms?: number;
  blink_rate?: number;
  gaze_activity?: number;
} = {}): Promise<SoulIdleResult | null> {
  const keys = await fetchApiKeys();
  if (!keys.llm_model) return null;     // no model picked yet → skip
  const body: Record<string, unknown> = {
    duration_s:   opts.duration_s   ?? 3.5 + Math.random() * 1.5,
    t2f_guidance: opts.t2f_guidance ?? 1.2,
    t2f_smooth:   opts.t2f_smooth   ?? 5,
    fade_in_ms:   opts.fade_in_ms   ?? 50,
    fade_out_ms:  opts.fade_out_ms  ?? 250,
    blink_rate:   opts.blink_rate   ?? 0,
    gaze_activity: opts.gaze_activity ?? 0,
    llm_model: keys.llm_model,
  };
  // Cloud providers need the key; Ollama runs locally so skip.
  if (keys.llm_api_key && keys.llm_provider !== 'ollama') {
    body.llm_api_key = keys.llm_api_key;
  }
  try {
    const res = await fetch(`${getSoulBaseUrl()}/idle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.warn(`[idle] soul /idle ${res.status}`);
      return null;
    }
    return (await res.json()) as SoulIdleResult;
  } catch (err) {
    console.warn('[idle] /idle fetch failed', err);
    return null;
  }
}


/** Where soul's body-idle rotation currently is, WITHOUT advancing it.
 *  Called on stream (re)connect: a renderer refresh/crash resets the
 *  session to the default loop while soul still holds the real state;
 *  re-dispatching this directive puts the body back where it was. */
export async function fetchCurrentBodyIdle(): Promise<SoulBodyDirective[] | null> {
  try {
    const res = await fetch(`${getSoulBaseUrl()}/body/idle`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { body?: SoulBodyDirective[] };
    return data.body?.length ? data.body : null;
  } catch {
    return null;
  }
}


/** Testing helper: ask soul's body director for a fresh random body-idle
 *  loop NOW. Returns the doIdle directive(s) for the caller to dispatch
 *  over the pixel-streaming data channel, or null on any failure. */
export async function randomizeBodyIdle(): Promise<SoulBodyDirective[] | null> {
  try {
    const res = await fetch(`${getSoulBaseUrl()}/body/randomize_idle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { body?: SoulBodyDirective[] };
    return data.body?.length ? data.body : null;
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------------
// Streaming chat (Kokoro local only)
// ---------------------------------------------------------------------
//
// Soul's `/chat_stream_audio` runs LLM once, then streams sentence-sized
// chunks via NDJSON. Each chunk is shaped like a slimmer SoulChatResult
// covering one slice of the reply. App.tsx schedules each chunk for
// dispatch to UE based on cumulative audio duration so playback is
// gapless even when chunks arrive in bursts.

export interface SoulChatChunk extends SoulChatResult {
  /** Position in the streamed reply. Last chunk has is_final=true and
   *  no audio/frames — just the cumulative timing summary. */
  chunk_idx: number;
  is_final: boolean;
  /** Where this chunk begins relative to the start of the full reply.
   *  The renderer adds firstChunkArrivedAt to compute wall-clock dispatch
   *  time. */
  start_offset_s?: number;
  total_duration?: number;
  total_n_frames?: number;
  n_chunks?: number;
  /** Set on the final chunk when soul detected an LLM-driven escalation
   *  request. The streaming endpoint can't host the escalation flow yet,
   *  so callers fall back to chatViaSoul() with the same message. */
  _escalation_request?: boolean;
}

/** Runs the streaming chat pipeline. Yields each chunk as soul emits
 *  it (via `for await ... of`). Honors AbortSignal so a fresh user
 *  turn / voice barge-in can cancel an in-flight stream cleanly.
 *
 *  tts_provider must be `kokoro` or `qwen3` — soul rejects the endpoint
 *  for cloud / custom-endpoint providers. Caller (App.tsx's
 *  `useStreaming` gate) is responsible for routing those to chatViaSoul. */
export async function* streamChatViaSoul(
  message: string,
  opts: SoulChatOptions & { signal?: AbortSignal } = {},
): AsyncGenerator<SoulChatChunk, void, void> {
  const body: Record<string, unknown> = { message };
  if (opts.history) body.history = opts.history;
  if (opts.voiceId) body.voice_id = opts.voiceId;
  if (opts.lipsyncModel) body.lipsync_model = opts.lipsyncModel;
  if (opts.systemExtension) body.system_extension = opts.systemExtension;
  if (opts.images && opts.images.length > 0) body.images = opts.images;

  try {
    const keys = await fetchApiKeys();
    if (keys.llm_model) body.llm_model = keys.llm_model;
    if (keys.llm_api_key && keys.llm_provider !== 'ollama') {
      body.llm_api_key = keys.llm_api_key;
    }
    // Forward whichever local provider the user picked. Soul's
    // /chat_stream_audio admits {kokoro, supertonic}; the App.tsx
    // caller restricts streaming to local providers before calling
    // us, so anything else here is a bug upstream.
    body.tts_provider = keys.tts_provider;
    // Same voice resolution as the non-streaming path (per-character by
    // default, global override when toggled). opts.voiceId already won above.
    if (!opts.voiceId) {
      const voice = resolveVoiceId(keys, opts.voices);
      if (voice) body.voice_id = voice;
    }
    // Agentic BYOK threading — same logic as chatViaSoul. Soul reads
    // these on the streaming endpoint too so escalation kicked off
    // mid-stream uses the wizard's backend pick.
    body.agentic_enabled = keys.agentic_enabled;
    body.agentic_provider = keys.agentic_provider;
    if (keys.agentic_enabled && keys.agentic_provider !== 'ollama') {
      const reuseChat = keys.agentic_use_same_as_chat
        && keys.llm_provider === 'openai'
        && !!keys.llm_api_key;
      body.agentic_model = reuseChat ? keys.llm_model : keys.agentic_model;
      body.agentic_api_key = reuseChat ? keys.llm_api_key : keys.agentic_api_key;
    }
    // Per-tier thinking effort — same as chatViaSoul.
    body.chat_thinking_effort = keys.chat_thinking_effort;
    body.agentic_thinking_effort = keys.agentic_thinking_effort;
    // Gemini grounded-search BYOK. Only forwarded when the user opted
    // in via the wizard. Without this, the escalation web_search tool
    // would silently bill the dev's quota (or fail outright on a
    // shipped build with no env key).
    if (keys.grounding_search_enabled && keys.gemini_search_api_key) {
      body.gemini_search_api_key = keys.gemini_search_api_key;
    }
  } catch (err) {
    console.warn('[soulChat] failed to read api keys (streaming)', err);
    body.tts_provider = 'kokoro';
  }

  const res = await fetch(`${getSoulBaseUrl()}/chat_stream_audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`soul /chat_stream_audio ${res.status}: ${errText.slice(0, 200)}`);
  }

  // NDJSON parsing — chunks may arrive split mid-line, so we accumulate
  // and split on '\n'. The trailing fragment after the last newline is
  // an in-progress chunk; we hold it until more bytes arrive.
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            yield JSON.parse(line) as SoulChatChunk;
          } catch (err) {
            console.warn('[soulChat] bad NDJSON line', err, line.slice(0, 200));
          }
        }
        nl = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) {
      try {
        yield JSON.parse(tail) as SoulChatChunk;
      } catch (err) {
        console.warn('[soulChat] bad NDJSON tail', err, tail.slice(0, 200));
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
