// Single-call client for the soul.exe server's /chat endpoint.
// Soul runs the entire pipeline (Groq LLM → ElevenLabs TTS → lipsync → T2F)
// and broadcasts the result to all /ws subscribers (Unreal pulls
// /result/{id} automatically). Replaces the older Cerebras-LLM +
// ElevenLabs-from-browser + /upload-lipsync chain in services/ai.ts +
// services/tts.ts + services/lipsync.ts for the default chat path.

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
  /** Server fields we don't strongly type. */
  [key: string]: unknown;
}

/**
 * POST the user's message to soul.exe /chat. Returns the full result
 * (id, mood, response, timings, etc.) once the server pipeline finishes.
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
