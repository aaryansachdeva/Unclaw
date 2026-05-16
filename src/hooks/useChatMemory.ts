import { useCallback, useEffect, useRef, useState } from 'react';

// One conversation turn. Roles match the OpenAI/Groq chat-completions
// schema so the array can be sent straight to soul.exe as `history`.
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Wall-clock when this turn happened. Useful for debugging + future
   *  features ("you said X two days ago"). Not sent to the LLM. */
  ts: number;
  /** Citations from any web_search calls during the escalation that
   *  produced this turn. Populated only on assistant turns; the chat
   *  pane renders them as small chips under the message. NOT included
   *  in `getHistory` — the LLM should never re-ingest URLs. */
  sources?: WebSource[];
  /** Raw base64 image strings (no data-URL prefix) the user attached
   *  to this turn. User turns only. The chat pane renders them as
   *  thumbnails in the bubble. SESSION-SCOPED: deliberately stripped
   *  before persisting to localStorage — base64 images would blow the
   *  ~5 MB quota within a few turns. So images show for the current
   *  session and the text alone survives a reload. */
  images?: string[];
}

export interface WebSource {
  uri: string;
  title: string;
}

const STORAGE_PREFIX = 'unclaw.chat.';

// Hard ceiling on how many turns we keep around. Older turns drop off
// the front when this is exceeded. 50 = ~25 exchanges; plenty for
// natural conversation while keeping localStorage and request payloads
// bounded. Adjust here if you want longer memory.
const MAX_TURNS = 50;

// How many recent turns we ship to the LLM by default. ~15 covers
// 7-8 exchanges, which is what feels "current" to most people.
const DEFAULT_HISTORY_WINDOW = 15;

function storageKey(personaId: string): string {
  return STORAGE_PREFIX + personaId;
}

function loadFromStorage(personaId: string): Turn[] {
  try {
    const raw = localStorage.getItem(storageKey(personaId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Turn[];
    if (!Array.isArray(parsed)) return [];
    // Defensive shape-check — drop anything malformed.
    return parsed.filter(
      t => t && (t.role === 'user' || t.role === 'assistant')
        && typeof t.content === 'string',
    );
  } catch (err) {
    console.warn('[chatMemory] load failed:', err);
    return [];
  }
}

function saveToStorage(personaId: string, turns: Turn[]): void {
  try {
    // Strip `images` before persisting — base64 image data would blow
    // localStorage's ~5 MB quota within a handful of turns. Image
    // display is session-scoped by design (see Turn.images doc).
    const lean = turns.map(t =>
      t.images ? { ...t, images: undefined } : t,
    );
    localStorage.setItem(storageKey(personaId), JSON.stringify(lean));
  } catch (err) {
    console.warn('[chatMemory] save failed:', err);
  }
}

export interface ChatMemoryAPI {
  /** Current turn array (newest at end). */
  turns: Turn[];
  /** Append a turn and persist. Returns the created turn (with its
   *  generated ts) so callers can correlate side data — e.g. attaching
   *  tool-usage labels to the assistant turn that just landed. Returns
   *  null when content was empty after trim. `sources` attaches web
   *  citations from an escalation web_search to an assistant turn. */
  add: (
    role: 'user' | 'assistant',
    content: string,
    sources?: WebSource[],
    images?: string[],
  ) => Turn | null;
  /**
   * Return the last `limit` turns in the schema soul/Groq expect:
   * `[{role, content}, ...]`. Used for the `history` field of /chat.
   */
  getHistory: (limit?: number) => Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Wipe persisted history for the current persona. */
  clear: () => void;
}

/**
 * Per-persona chat memory. Mounts → reads localStorage; every add/clear
 * → mirrors back. Switching `personaId` swaps to that persona's history
 * (so Grace and Mark remember independently).
 */
export function useChatMemory(personaId: string): ChatMemoryAPI {
  const [turns, setTurns] = useState<Turn[]>(() => loadFromStorage(personaId));

  // Keep a ref so callbacks don't see stale state when fired in quick
  // succession (e.g. user/assistant pair within one render tick).
  const turnsRef = useRef<Turn[]>(turns);
  turnsRef.current = turns;

  // Reload when persona changes.
  useEffect(() => {
    const next = loadFromStorage(personaId);
    setTurns(next);
    turnsRef.current = next;
  }, [personaId]);

  const add = useCallback<ChatMemoryAPI['add']>((role, content, sources, images) => {
    const trimmed = content.trim();
    const hasImages = !!images && images.length > 0;
    // Allow an image-only user turn (no text) — the user can stage
    // screenshots and send with an empty box. Bail only when there's
    // nothing at all.
    if (!trimmed && !hasImages) return null;
    const turn: Turn = { role, content: trimmed, ts: Date.now() };
    if (sources && sources.length > 0) turn.sources = sources;
    if (hasImages) turn.images = images;
    const next = [...turnsRef.current, turn].slice(-MAX_TURNS);
    turnsRef.current = next;
    setTurns(next);
    saveToStorage(personaId, next);
    return turn;
  }, [personaId]);

  const getHistory = useCallback<ChatMemoryAPI['getHistory']>((limit = DEFAULT_HISTORY_WINDOW) => {
    const slice = turnsRef.current.slice(-limit);
    return slice.map(t => ({ role: t.role, content: t.content }));
  }, []);

  const clear = useCallback<ChatMemoryAPI['clear']>(() => {
    turnsRef.current = [];
    setTurns([]);
    try { localStorage.removeItem(storageKey(personaId)); } catch {}
  }, [personaId]);

  return { turns, add, getHistory, clear };
}
