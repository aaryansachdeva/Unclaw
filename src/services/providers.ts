// Thin client for soul's GET /providers endpoint.
//
// Soul reports per-provider availability + model lists. Ollama's model
// list is auto-discovered live from the daemon's /api/tags, so newly-
// pulled models appear without restarting either soul or the Electron
// app. The onboarding wizard hits this on mount + every time the user
// opens the provider dropdown so the list stays fresh.

const SOUL_URL = 'http://127.0.0.1:8765';

/** A model entry as returned by soul's /providers. Cloud providers report
 *  `id` + `label` only; Ollama also includes size/param/quant for the
 *  dropdown's hint column. */
export interface SoulProviderModel {
  id: string;
  label?: string;
  /** Ollama-only: bare model tag without the 'ollama:' prefix. */
  tag?: string;
  /** Ollama-only: file size on disk (GB). */
  size_gb?: number;
  /** Ollama-only: e.g. '4.3B', '873.44M'. */
  param_size?: string;
  /** Ollama-only: e.g. 'Q4_0', 'Q8_0'. */
  quantization?: string;
}

export interface SoulProvider {
  id: 'groq' | 'openai' | 'ollama';
  label: string;
  /** True when soul thinks this provider is reachable right now —
   *  cloud: API key set; ollama: daemon responding. */
  available: boolean;
  needs_api_key: boolean;
  signup_url: string;
  base_url?: string;
  models: SoulProviderModel[];
  default_model: string | null;
}

export interface SoulProvidersResponse {
  providers: SoulProvider[];
  active: {
    llm_model: string | null;
    llm_model_idle: string | null;
    active_provider: 'groq' | 'openai' | 'ollama';
  };
}


/** Hit GET /providers. Returns null if soul is unreachable so callers
 *  can show a "soul offline" state instead of throwing. */
export async function fetchSoulProviders(): Promise<SoulProvidersResponse | null> {
  try {
    const res = await fetch(`${SOUL_URL}/providers`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as SoulProvidersResponse;
  } catch (err) {
    console.warn('[providers] fetch failed', err);
    return null;
  }
}


/** Convenience: just the Ollama models, sorted by size (smallest first
 *  so the most-likely-to-be-fast option surfaces at the top). */
export async function fetchOllamaModels(): Promise<SoulProviderModel[]> {
  const data = await fetchSoulProviders();
  if (!data) return [];
  const ollama = data.providers.find((p) => p.id === 'ollama');
  if (!ollama) return [];
  return [...ollama.models].sort(
    (a, b) => (a.size_gb ?? 0) - (b.size_gb ?? 0),
  );
}
