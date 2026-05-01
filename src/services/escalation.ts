// Polling client for soul.exe's escalation queue.
//
// When 20b decides a request needs gpt-5-mini + Playwright MCP, soul's
// /chat response carries an `escalation: {id}` marker on the (already
// dispatched) transition reply. The client then polls /escalation/{id}/next
// every ~1.2s to drain follow-ups: any narration lines voiced through TTS
// while the bigger model works, and finally the agentic loop's answer.
//
// Each poll returns one queued result at a time (FIFO) plus a `more` flag
// that stays true until the background task finishes AND the queue is empty.
// We stop polling when the server says `more === false` AND the latest poll
// returned `result === null`.

import { SoulChatResult } from './soulChat';

const SOUL_URL = 'http://127.0.0.1:8765';

export interface EscalationStep {
  /** Same shape as a /chat result. Null when the server has nothing
   *  ready yet (still working) — the caller should keep polling. */
  result: SoulChatResult | null;
  /** True when the escalation task is still running OR there are
   *  more queued items to drain. False = polling can stop. */
  more: boolean;
  /** Short human-readable label of what gpt-5-mini is currently doing
   *  ("thinking", "navigating", "looking at the page", etc.). The UI
   *  shows this above the dock so the user has a live signal of what's
   *  happening between voiced narrations. */
  status?: string;
}

/** Single poll. Returns null on network errors so the caller can keep
 *  trying without crashing the loop. */
export async function pollNextEscalation(
  jobId: string,
): Promise<EscalationStep | null> {
  try {
    const r = await fetch(
      `${SOUL_URL}/escalation/${encodeURIComponent(jobId)}/next`,
    );
    if (!r.ok) return null;
    return (await r.json()) as EscalationStep;
  } catch {
    return null;
  }
}
