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

  // Pull the user's saved {provider, model, key, elevenlabs_key} so
  // soul routes the request to the backend they configured in
  // onboarding AND uses their own ElevenLabs key for TTS. Soul's
  // /chat route is BYOK-strict in shipping mode (no env-key fallback),
  // so the keys gathered here are required end-to-end — the wizard
  // gates Finish on them.
  try {
    const keys = await fetchApiKeys();
    if (keys.llm_model) body.llm_model = keys.llm_model;
    // Only send the LLM key for providers that actually need one
    // (cloud); Ollama bypasses this and soul uses its local daemon.
    if (keys.llm_api_key && keys.llm_provider !== 'ollama') {
      body.llm_api_key = keys.llm_api_key;
    }
    if (keys.elevenlabs_api_key) {
      body.elevenlabs_api_key = keys.elevenlabs_api_key;
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
