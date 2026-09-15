// Does the selected chat model accept image input? Asked of soul, which asks
// the model or provider itself (Ollama capabilities, xAI modalities, CLI
// pass-through, or a one-time 1x1 PNG probe) and caches the answer on disk.
// No model table on this side any more (2026-09-15): the renderer only ever
// needs the answer for the model the user has selected right now.

import { getSoulBaseUrl } from './soulBase';

export type VisionCapability = 'yes' | 'no' | 'unknown';

const cache = new Map<string, VisionCapability>();

/** Resolve the capability for one model. `unknown` means soul could not
 *  reach the provider or had no key to ask with; it is not cached so the
 *  next call asks again. */
export async function fetchVisionCapability(
  model: string | null | undefined,
  apiKey?: string | null,
  opts: { force?: boolean } = {},
): Promise<VisionCapability> {
  const tag = (model ?? '').trim().toLowerCase();
  if (!tag) return 'no';
  if (!opts.force) {
    const hit = cache.get(tag);
    if (hit) return hit;
  }
  try {
    const res = await fetch(`${getSoulBaseUrl()}/llm/vision_capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm_model: tag, llm_api_key: apiKey || undefined, force: !!opts.force }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return 'unknown';
    const j = (await res.json()) as { vision?: boolean | null };
    const cap: VisionCapability = j.vision === true ? 'yes' : j.vision === false ? 'no' : 'unknown';
    if (cap !== 'unknown') cache.set(tag, cap);
    return cap;
  } catch {
    return 'unknown';
  }
}

export function forgetVisionCapability(model?: string | null): void {
  if (model) cache.delete(model.trim().toLowerCase());
  else cache.clear();
}
