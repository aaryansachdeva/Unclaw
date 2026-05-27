// Direct Text2Face probe. POSTs to soul's /t2f endpoint with a mood
// prompt and returns the resulting job. Bypasses the LLM, TTS, and
// LipSync paths entirely — the only thing that plays back is the
// streamed face animation.
//
// Powers the `/express <emotion>` slash command in the input bar:
//   /express surprise → expressFace('surprise') → UE plays a face
//   that interprets "surprise" via the Text2Face model.

import { getSoulBaseUrl } from './soulBase';

export interface ExpressResult {
  /** Job id — UE polls /result/{id} for the cached face frames. */
  id: string;
  /** The prompt echoed back. */
  mood: string;
  /** Frame count of the animation. */
  n_frames: number;
  /** Total animation duration in seconds. */
  duration: number;
  /** Static behavior label — "t2f-only" so downstream knows there
   *  was no LLM-picked behavior preset. */
  behavior: string;
  /** Wall-clock for sanity / debugging. */
  generation_ms?: number;
}

/** Fire the /t2f probe. The optional knobs default to soul's
 *  T2FOnlyBody field defaults. We only pass `prompt` from the
 *  slash command; advanced overrides aren't needed for the
 *  conversational use case. */
export async function expressFace(prompt: string): Promise<ExpressResult> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error('expressFace: prompt is required');
  const r = await fetch(`${getSoulBaseUrl()}/t2f`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: trimmed }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => r.statusText);
    throw new Error(`/t2f ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()) as ExpressResult;
}
