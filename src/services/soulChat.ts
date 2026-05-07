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

import { fetchApiKeys } from './apiKeys';

const SOUL_URL = 'http://127.0.0.1:8765';

export interface SoulChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SoulChatOptions {
  history?: SoulChatHistoryTurn[];
  voiceId?: string;
  ttsProvider?: 'elevenlabs' | 'xai';
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
  if (opts.ttsProvider) body.tts_provider = opts.ttsProvider;
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
    if (keys.tts_provider === 'kokoro') {
      if (keys.kokoro_voice) body.voice_id = keys.kokoro_voice;
      if (keys.kokoro_mode === 'custom' && keys.kokoro_endpoint) {
        body.kokoro_endpoint = keys.kokoro_endpoint;
      }
    }
    if (keys.tts_provider === 'qwen3' && keys.qwen3_voice) {
      body.voice_id = keys.qwen3_voice;
    }
    // Agentic / escalation BYOK. Soul reads these on /chat and uses
    // them per-request in _run_escalation (the wizard's pick of model
    // and key takes effect, env-defaults only kick in for non-BYOK
    // legacy callers). When agentic_use_same_as_chat is on AND chat
    // is OpenAI, we pass the chat key as the agentic key.
    body.agentic_enabled = keys.agentic_enabled;
    if (keys.agentic_enabled) {
      const reuseChat = keys.agentic_use_same_as_chat
        && keys.llm_provider === 'openai'
        && !!keys.llm_api_key;
      body.agentic_model = reuseChat ? keys.llm_model : keys.agentic_model;
      body.agentic_api_key = reuseChat ? keys.llm_api_key : keys.agentic_api_key;
    }
  } catch (err) {
    console.warn('[soulChat] failed to read api keys', err);
  }

  const res = await fetch(`${SOUL_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`soul /chat ${res.status}: ${errText.slice(0, 200)}`);
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

export interface SoulIdleResult {
  type: 'idle' | 'idle_skipped';
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
    const res = await fetch(`${SOUL_URL}/idle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    // /chat_stream_audio gates on tts_provider in {kokoro, qwen3};
    // the App.tsx caller restricts streaming to those two before
    // calling us, so anything else here is a bug upstream.
    body.tts_provider = keys.tts_provider;
    if (keys.tts_provider === 'kokoro' && keys.kokoro_voice) {
      body.voice_id = keys.kokoro_voice;
    }
    if (keys.tts_provider === 'qwen3' && keys.qwen3_voice) {
      body.voice_id = keys.qwen3_voice;
    }
    // Agentic BYOK threading — same logic as chatViaSoul. Soul reads
    // these on the streaming endpoint too so escalation kicked off
    // mid-stream uses the wizard's pick (model + key).
    body.agentic_enabled = keys.agentic_enabled;
    if (keys.agentic_enabled) {
      const reuseChat = keys.agentic_use_same_as_chat
        && keys.llm_provider === 'openai'
        && !!keys.llm_api_key;
      body.agentic_model = reuseChat ? keys.llm_model : keys.agentic_model;
      body.agentic_api_key = reuseChat ? keys.llm_api_key : keys.agentic_api_key;
    }
  } catch (err) {
    console.warn('[soulChat] failed to read api keys (streaming)', err);
    body.tts_provider = 'kokoro';
  }

  const res = await fetch(`${SOUL_URL}/chat_stream_audio`, {
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
